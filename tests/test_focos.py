"""Testes do módulo de focos (R4, R5 e repartição).

Os testes de propriedade usam contagens FIXTURE_ montadas aqui, que não são
dados reais. O teste de integração usa a resposta crua real do InfoDengue
gravada em tests/fixtures/infodengue/ (procedência no .meta.json).
"""
import hashlib
import json
from pathlib import Path

import numpy as np

from src.indicators import focos
from src.indicators.focos import (ears_c2, faixa_por_territorio, r4_aumento_local, r5_aglomerado, repartir,
                                  robustez, vizinhos_mais_proximos)

FIX = Path(__file__).parent / "fixtures" / "infodengue"
FIXTURE_SEMANAS = list(range(202501, 202521))


def test_c2_piso_do_desvio():
    serie = [2] * 12 + [9]
    e = ears_c2(serie, 12)
    assert e["dp_base"] == 0 and e["dp_usado"] == focos.C2_DP_MIN
    assert e["c2"] == 7.0


def test_c2_sem_base_suficiente():
    assert ears_c2([1, 2, 3], 2) is None


def test_r4_dispara_e_respeita_minimo():
    series = {"FIXTURE_alto": [1] * 19 + [12], "FIXTURE_baixo": [0] * 19 + [4]}
    sinais = r4_aumento_local(series, FIXTURE_SEMANAS, 19)
    assert [s.territorios for s in sinais] == [["FIXTURE_alto"]]
    assert sinais[0].evidencia["semanas_base"] == [202511, 202517]


def test_vizinhos_comecam_pelo_proprio():
    coords = {"FIXTURE_a": (0.0, 0.0), "FIXTURE_b": (0.1, 0.0), "FIXTURE_c": (1.0, 0.0)}
    v = vizinhos_mais_proximos(coords, k=3)
    assert v["FIXTURE_a"] == ["FIXTURE_a", "FIXTURE_b", "FIXTURE_c"]
    assert v["FIXTURE_c"][0] == "FIXTURE_c"


def _grade(n=6):
    coords = {f"FIXTURE_{i}_{j}": (float(i), float(j)) for i in range(n) for j in range(n)}
    return list(coords), coords


def test_r5_sem_excesso_nao_sinaliza():
    terrs, coords = _grade()
    x = np.full((len(terrs), 20), 3)
    assert r5_aglomerado(x, terrs, FIXTURE_SEMANAS, vizinhos_mais_proximos(coords), replicas=99) == []


def test_r5_encontra_aglomerado_plantado():
    terrs, coords = _grade()
    rng = np.random.default_rng(1)
    x = rng.poisson(3, size=(len(terrs), 20))
    canto = [terrs.index(t) for t in ("FIXTURE_0_0", "FIXTURE_0_1", "FIXTURE_1_0")]
    x[canto, -2:] += 25
    sinais = r5_aglomerado(x, terrs, FIXTURE_SEMANAS, vizinhos_mais_proximos(coords),
                           rng=np.random.default_rng(2), replicas=199)
    assert sinais, "o aglomerado plantado deveria ser detectado"
    s = sinais[0]
    assert set(t for t in ("FIXTURE_0_0", "FIXTURE_0_1", "FIXTURE_1_0")) <= set(s.territorios)
    assert s.evidencia["p_valor"] <= 1 / focos.SCAN_RECORRENCIA_MIN
    assert s.evidencia["observado"] > s.evidencia["esperado"]


def test_r5_ignora_territorio_isolado():
    terrs, coords = _grade()
    x = np.full((len(terrs), 20), 3)
    x[terrs.index("FIXTURE_3_3"), -1] += 40
    sinais = r5_aglomerado(x, terrs, FIXTURE_SEMANAS, vizinhos_mais_proximos(coords),
                           rng=np.random.default_rng(3), replicas=99)
    assert all(len(s.territorios) >= focos.SCAN_MIN_TERRITORIOS for s in sinais)


def test_episodios_silencio():
    sem = list(range(202501, 202521))
    oc = [(202503, "FIXTURE_a"), (202504, "FIXTURE_a"), (202508, "FIXTURE_a"), (202514, "FIXTURE_a"),
          (202504, "FIXTURE_b")]
    eps = focos.episodios(oc, sem)
    a = [e for e in eps if e["territorio"] == "FIXTURE_a"]
    assert [(e["inicio"], e["fim"], e["semanas_com_sinal"]) for e in a] == [(202503, 202508, 3), (202514, 202514, 1)]
    assert len(eps) == 3


def test_llr_so_excesso():
    assert focos._llr(np.array([2.0]), np.array([5.0]), 100.0)[0] == 0
    assert focos._llr(np.array([10.0]), np.array([5.0]), 100.0)[0] > 0


def test_repartir_preserva_total():
    viz = {"FIXTURE_a": ["FIXTURE_a", "FIXTURE_b", "FIXTURE_c"], "FIXTURE_b": ["FIXTURE_b", "FIXTURE_a"]}
    desl = {"FIXTURE_a": {"FIXTURE_d": 0.4}}
    casos = {"FIXTURE_a": 10, "FIXTURE_b": 4}
    for f in focos.CENARIOS_RESIDENCIA:
        r = repartir(casos, viz, desl, f)
        assert abs(sum(r.values()) - 14) < 1e-9
    r = repartir(casos, viz, desl, 0.5)
    assert r["FIXTURE_d"] == 2.0          # 10 * 0.5 * 0.4
    assert r["FIXTURE_c"] == 1.5          # 10 * 0.5 * 0.6 / 2


def test_faixa_e_robustez():
    viz = {"FIXTURE_a": ["FIXTURE_a", "FIXTURE_b"], "FIXTURE_b": ["FIXTURE_b", "FIXTURE_a"]}
    fx = faixa_por_territorio({"FIXTURE_a": 10}, viz)
    assert fx["FIXTURE_a"] == {"min": 5.0, "max": 10.0, "cenarios": {"1.0": 10.0, "0.7": 7.0, "0.5": 5.0}}
    assert fx["FIXTURE_b"]["min"] == 0.0 and fx["FIXTURE_b"]["max"] == 5.0
    rb = robustez({1.0: {"FIXTURE_a"}, 0.7: {"FIXTURE_a", "FIXTURE_b"}, 0.5: {"FIXTURE_a"}})
    assert rb == {"FIXTURE_a": "robusto", "FIXTURE_b": "sinal_fraco"}


def test_integracao_resposta_real_infodengue():
    """R4 sobre a resposta crua real do InfoDengue para Natal (dengue, 2026)."""
    meta = json.loads((FIX / "FIXTURE_alertcity_2408102_dengue_2026.meta.json").read_text(encoding="utf-8"))
    corpo = (FIX / "FIXTURE_alertcity_2408102_dengue_2026.json").read_text(encoding="utf-8")
    assert hashlib.sha256(corpo.encode()).hexdigest() == meta["sha256"]
    linhas = sorted(json.loads(corpo), key=lambda r: r["SE"])
    semanas = [r["SE"] for r in linhas]
    serie = [float(r["casos_est"]) for r in linhas]
    assert semanas == sorted(set(semanas)) and len(semanas) >= 10
    for t in range(focos.C2_BASE_FIM, len(serie)):
        e = ears_c2(serie, t)
        assert e is not None and np.isfinite(e["c2"])
        sinais = r4_aumento_local({"2408102": serie}, semanas, t)
        assert bool(sinais) == (e["c2"] > focos.C2_LIMIAR and e["observado"] >= focos.C2_MIN_CASOS)


# ---------------------------------------------------------------------------
# Banco: migração 020 e gravação de alertas por episódio (Postgres descartável)
# ---------------------------------------------------------------------------
import os  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402

import pytest  # noqa: E402

RAIZ = Path(__file__).resolve().parents[1]
PG = os.getenv("VIGIGEN_PG_TESTE")
sem_pg = pytest.mark.skipif(not PG or not shutil.which("psql"),
                            reason="defina VIGIGEN_PG_TESTE=<url de um Postgres descartável>")


def _banco_novo(nome: str) -> str:
    sem_q, _, q = PG.partition("?")
    raiz = sem_q.rsplit("/", 1)[0]
    suf = f"?{q}" if q else ""
    for cmd in (f"drop database if exists {nome}", f"create database {nome}"):
        r = subprocess.run(["psql", f"{raiz}/postgres{suf}", "-qc", cmd], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
    return f"{raiz}/{nome}{suf}"


def _psql(url: str, arq: str) -> str:
    r = subprocess.run(["psql", url, "-q", "-v", "ON_ERROR_STOP=1", "-f", arq], cwd=RAIZ, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stderr


@sem_pg
def test_migracao_020():
    url = _banco_novo("vigigen_focos_020")
    _psql(url, "tests/fixtures/sql/FIXTURE_esquema_minimo.sql")
    assert "OK: migração 020" in _psql(url, "tests/fixtures/sql/FIXTURE_teste_020.sql")


@sem_pg
def test_focos_db_grava_so_abertura_de_episodio(tmp_path, monkeypatch):
    """Séries FIXTURE_ (não reais) num banco descartável com stubs de PostGIS."""
    import psycopg

    from src.indicators import focos_db
    url = _banco_novo("vigigen_focos_db")
    _psql(url, "tests/fixtures/sql/FIXTURE_esquema_minimo.sql")
    _psql(url, "tests/fixtures/sql/FIXTURE_teste_020.sql")
    with psycopg.connect(url, autocommit=True) as con:
        con.execute("""
            create schema if not exists extensions;
            alter table public.municipio add column geometria point;
            alter table public.caso_semanal add column casos_estimados numeric, add column bruto_id bigint;
            create function extensions.st_pointonsurface(p point) returns point language sql as 'select p';
            create function extensions.st_x(p point) returns float8 language sql as 'select p[0]';
            create function extensions.st_y(p point) returns float8 language sql as 'select p[1]';""")
        for i in range(4):
            con.execute("insert into public.municipio values (%s, %s, 'RN', point(%s, 0))",
                        (2499000 + i, f"FIXTURE_M{i}", float(i)))
        semanas = [202501 + k for k in range(52)] + [202601 + k for k in range(4)]
        for i in range(4):
            for k, s in enumerate(semanas):
                n = 3 + (40 if i == 0 and k == len(semanas) - 1 else 0)
                con.execute("insert into public.caso_semanal (geocodigo, doenca, semana_epidemiologica, casos, "
                            "casos_estimados) values (%s, 'dengue', %s, %s, %s)", (2499000 + i, s, n, n))
    monkeypatch.setenv("DATABASE_URL", url)
    r1 = focos_db.detectar(tmp_path / "r1.json", ["dengue", "chikungunya"])
    assert r1["agravos"]["chikungunya"]["status"] == "sem dado em caso_semanal"
    assert r1["agravos"]["dengue"]["alertas_gravados"] >= 1
    with psycopg.connect(url) as con:
        tipos = con.execute("select tipo, geocodigo, agravo from public.alerta").fetchall()
    assert ("R4_aumento_local", 2499000, "dengue") in tipos
    r2 = focos_db.detectar(tmp_path / "r2.json", ["dengue"])
    assert r2["agravos"]["dengue"]["alertas_gravados"] == 0, "rodar de novo não duplica"
