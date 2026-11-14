"""Detecção de focos ligada ao banco (R4 e R5 sobre public.caso_semanal).

  python -m src.indicators.focos_db detectar data/interim/focos/relatorio.json [--agravos dengue,chikungunya] [--semanas 1]

Lê as séries semanais do InfoDengue já normalizadas no banco, roda R4 e R5
nas últimas `--semanas` semanas e grava em public.alerta só a ABERTURA de
cada episódio (status "novo"): se o mesmo município já teve alerta R4/R5 do
mesmo agravo nas 4 semanas anteriores, o sinal prolonga o episódio e não
gera alerta novo. Precisa de DATABASE_URL; nunca versionar a URL.

Sem dado, nada é calculado: semanas ausentes ficam registradas no relatório.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from src.indicators import focos


def conectar():
    import psycopg
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL não definido")
    return psycopg.connect(url)


def _versoes() -> dict:
    codigo = Path(focos.__file__).read_bytes()
    return {"python": platform.python_version(), "numpy": np.__version__,
            "focos_py_sha256": hashlib.sha256(codigo).hexdigest()}


def detectar(relatorio: Path, agravos: list[str], n_semanas: int = 1) -> dict:
    resumo: dict = {"executado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "versoes": _versoes(), "parametros": focos.PARAMETROS, "agravos": {}}
    with conectar() as con:
        municipios = con.execute("""
            select geocodigo::text, nome, extensions.st_x(c), extensions.st_y(c)
            from (select geocodigo, nome, extensions.st_pointonsurface(geometria) c
                  from public.municipio where geometria is not null) m order by geocodigo""").fetchall()
        coords = {g: (float(x), float(y)) for g, _, x, y in municipios}
        viz = focos.vizinhos_mais_proximos(coords)
        for agravo in agravos:
            linhas = con.execute("""
                select geocodigo::text, semana_epidemiologica,
                       round(coalesce(casos_estimados, casos))::int, max(bruto_id) over ()
                from public.caso_semanal where doenca = %s order by semana_epidemiologica""", (agravo,)).fetchall()
            if not linhas:
                resumo["agravos"][agravo] = {"status": "sem dado em caso_semanal"}
                continue
            semanas = sorted({s for _, s, _, _ in linhas})
            semanas = semanas[-(focos.SCAN_JANELA_ESTUDO + n_semanas - 1):]
            pos = {s: i for i, s in enumerate(semanas)}
            terrs = sorted(coords)
            ti = {t: i for i, t in enumerate(terrs)}
            x = np.full((len(terrs), len(semanas)), -1, dtype=np.int64)
            for g, s, v, _ in linhas:
                if s in pos and g in ti and v is not None:
                    x[ti[g], pos[s]] = v
            faltantes = int((x < 0).sum())
            if faltantes:
                # célula sem dado não vira zero: o agravo inteiro fica sem cálculo nesta rodada
                resumo["agravos"][agravo] = {"status": "série incompleta, nada calculado",
                                             "celulas_sem_dado": faltantes, "semanas": [semanas[0], semanas[-1]]}
                continue
            bruto_max = linhas[0][3]
            sinais: list[focos.Sinal] = []
            for k in range(n_semanas):
                t = len(semanas) - n_semanas + k
                sinais += focos.r4_aumento_local({g: x[ti[g]].tolist() for g in terrs}, semanas, t)
                ini = t + 1 - focos.SCAN_JANELA_ESTUDO
                if ini >= 0:
                    sinais += focos.r5_aglomerado(x[:, ini:t + 1], terrs, semanas[ini:t + 1], viz)
            gravados = prolongados = 0
            for s in sinais:
                for g in s.territorios:
                    ja = con.execute("""
                        select count(*) from public.alerta
                        where geocodigo = %s and agravo = %s and tipo in ('R4_aumento_local', 'R5_aglomerado')
                          and periodo_deteccao ~ '^[0-9]{6}$'
                          and periodo_deteccao::int < %s and periodo_deteccao::int >= %s""",
                        (int(g), agravo, s.semana,
                         semanas[max(0, semanas.index(s.semana) - focos.EPISODIO_SILENCIO)])).fetchone()[0]
                    mesma = con.execute("""
                        select count(*) from public.alerta where geocodigo = %s and agravo = %s
                          and tipo = %s and periodo_deteccao = %s""",
                        (int(g), agravo, s.regra, str(s.semana))).fetchone()[0]
                    if ja or mesma:
                        prolongados += 1
                        continue
                    ev = {**s.evidencia, "territorios": s.territorios, "fonte": "public.caso_semanal (InfoDengue)",
                          "serie": "casos_estimados (nowcast InfoDengue); casos notificados quando nulo",
                          "bruto_id_max": bruto_max, "versoes": resumo["versoes"]}
                    con.execute("""insert into public.alerta (geocodigo, tipo, periodo_deteccao, evidencia, agravo)
                                   values (%s, %s, %s, %s::jsonb, %s)""",
                                (int(g), s.regra, str(s.semana), json.dumps(ev, ensure_ascii=False), agravo))
                    gravados += 1
            resumo["agravos"][agravo] = {"status": "ok", "semanas_avaliadas": semanas[-n_semanas:],
                                         "sinais": len(sinais), "alertas_gravados": gravados,
                                         "sinais_que_prolongam_episodio": prolongados}
        con.execute("insert into public.auditoria (ator, acao, entidade, detalhe) values (%s, %s, %s, %s)",
                    ("pipeline:focos", "deteccao_focos", "alerta", json.dumps(resumo, ensure_ascii=False)))
    relatorio.parent.mkdir(parents=True, exist_ok=True)
    relatorio.write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8")
    return resumo


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("comando", choices=["detectar"])
    ap.add_argument("relatorio", type=Path)
    ap.add_argument("--agravos", default="dengue,chikungunya")
    ap.add_argument("--semanas", type=int, default=1)
    a = ap.parse_args()
    print(json.dumps(detectar(a.relatorio, a.agravos.split(","), a.semanas), ensure_ascii=False, indent=2))
