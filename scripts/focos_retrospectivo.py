"""Rodada retrospectiva de R4 e R5 sobre uma extração real de caso_semanal.

  python scripts/focos_retrospectivo.py data/interim/focos/extracao_<ts>.json [--replicas 999]

A extração vem do banco (public.caso_semanal + public.municipio), com o
carimbo `extraido_em`. A saída vai para data/processed/focos/ (não versionada)
com as versões de Python, NumPy, parâmetros e o commit do código (regra 5).
Cada semana é avaliada só com o que existia até ela (modo prospectivo); a
extração, porém, é a versão atual das séries, já com as revisões do InfoDengue.
"""
from __future__ import annotations

import argparse
import json
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.indicators import focos  # noqa: E402


def commit() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return "desconhecido"


def rodar(extracao: dict, doenca: str, replicas: int, seed: int) -> dict:
    semanas = [s for s, _ in extracao["semanas"]]
    datas = {s: d for s, d in extracao["semanas"]}
    serie = extracao["series"][doenca]["estimados"]
    terrs = sorted(serie)
    x = np.array([serie[t] for t in terrs], dtype=np.int64)
    coords = {str(m[0]): (float(m[2]), float(m[3])) for m in extracao["municipios"]}
    nomes = {str(m[0]): m[1] for m in extracao["municipios"]}
    viz = focos.vizinhos_mais_proximos({t: coords[t] for t in terrs})
    rng = np.random.default_rng(seed)

    r4, r5 = [], []
    for t in range(len(semanas)):
        for s in focos.r4_aumento_local({g: serie[g] for g in terrs}, semanas, t):
            r4.append({"semana": s.semana, "geocodigo": s.territorios[0], "municipio": nomes[s.territorios[0]],
                       **{k: v for k, v in s.evidencia.items() if k != "parametros"}})
        if t + 1 >= focos.SCAN_JANELA_ESTUDO:
            ini = t + 1 - focos.SCAN_JANELA_ESTUDO
            for s in focos.r5_aglomerado(x[:, ini:t + 1], terrs, semanas[ini:t + 1], viz, rng=rng, replicas=replicas):
                ev = {k: v for k, v in s.evidencia.items() if k != "parametros"}
                r5.append({"semana": s.semana, "geocodigos": s.territorios,
                           "municipios": [nomes[g] for g in s.territorios], **ev})

    estado = x.sum(axis=0)
    pos = {s: i for i, s in enumerate(semanas)}
    ocorr = [(a["semana"], a["geocodigo"]) for a in r4] + [(a["semana"], g) for a in r5 for g in a["geocodigos"]]
    eps = focos.episodios(ocorr, semanas)
    pop = {g: float(v) for g, v in extracao["populacao_2026"].items() if v}

    # Avaliação provisória (critério da tese, D-016): município-ano de referência é o que
    # atinge incidência anual >= 300/100 mil (alta incidência); o episódio detecta a
    # referência se começa entre 8 semanas antes do pico do município e o pico.
    anos = sorted({s // 100 for s in semanas})
    resumo, referencias = [], []
    for ano in anos:
        idx = [i for i, s in enumerate(semanas) if s // 100 == ano]
        eps_ano = [e for e in eps if e["inicio"] // 100 == ano]
        detect = antecs = 0
        refs_ano = 0
        baixa_inc_eps = 0
        for gi, g in enumerate(terrs):
            casos_ano = float(x[gi, idx].sum())
            inc = casos_ano / pop[g] * 1e5 if pop.get(g) else None
            eg = [e for e in eps_ano if e["territorio"] == g]
            if inc is not None and inc < 100:
                baixa_inc_eps += len(eg)
            if inc is None or inc < 300:
                continue
            refs_ano += 1
            pico = idx[int(np.argmax(x[gi, idx]))]
            antes = [e for e in eps if e["territorio"] == g and pico - 8 <= pos[e["inicio"]] <= pico]
            lead = (pico - pos[antes[0]["inicio"]]) if antes else None
            if antes:
                detect += 1
                antecs += lead
            referencias.append({"ano": ano, "geocodigo": g, "municipio": nomes[g], "incidencia_100k": round(inc, 1),
                                "semana_pico": semanas[pico], "casos_pico": int(x[gi, pico]),
                                "detectado": bool(antes), "semanas_antecedencia": lead})
        pico_e = idx[int(np.argmax(estado[idx]))]
        resumo.append({
            "ano": ano, "casos_estado": int(estado[idx].sum()), "semana_pico_estado": semanas[pico_e],
            "sinais_r4": sum(a["semana"] // 100 == ano for a in r4),
            "aglomerados_r5": sum(a["semana"] // 100 == ano for a in r5),
            "episodios": len(eps_ano), "episodios_em_municipio_ano_baixa_incidencia": baixa_inc_eps,
            "referencias_alta_incidencia": refs_ano, "referencias_detectadas": detect,
            "antecedencia_media_semanas": round(antecs / detect, 1) if detect else None,
            "ano_parcial": ano == semanas[-1] // 100,
        })
    return {"doenca": doenca, "r4": r4, "r5": r5, "episodios": eps, "referencias": referencias,
            "resumo_anual": resumo, "serie_estado": [[s, datas[s], int(v)] for s, v in zip(semanas, estado)]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("extracao", type=Path)
    ap.add_argument("--replicas", type=int, default=focos.SCAN_REPLICAS)
    ap.add_argument("--seed", type=int, default=20261114)
    ap.add_argument("--doencas", default="dengue,chikungunya")
    a = ap.parse_args()
    ext = json.loads(a.extracao.read_text(encoding="utf-8"))
    t0 = time.time()
    saida = {
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "extracao": {"arquivo": a.extracao.name, "extraido_em": ext["extraido_em"], "fonte": ext["fonte"]},
        "versoes": {"python": platform.python_version(), "numpy": np.__version__, "commit": commit()},
        "parametros": focos.PARAMETROS, "replicas": a.replicas, "seed": a.seed,
        "resultados": [rodar(ext, d, a.replicas, a.seed) for d in a.doencas.split(",")],
    }
    saida["duracao_s"] = round(time.time() - t0, 1)
    destino = Path("data/processed/focos")
    destino.mkdir(parents=True, exist_ok=True)
    p = destino / f"retrospectivo_{saida['gerado_em'][:19].replace(':', '').replace('-', '')}.json"
    p.write_text(json.dumps(saida, ensure_ascii=False, indent=1), encoding="utf-8")
    for r in saida["resultados"]:
        print(r["doenca"], "R4:", len(r["r4"]), "R5:", len(r["r5"]), "episódios:", len(r["episodios"]))
        for linha in r["resumo_anual"]:
            print("  ", linha)
    print(p, saida["duracao_s"], "s")


if __name__ == "__main__":
    main()
