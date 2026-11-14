"""INMET (D-021): o CSV real da estação de Natal (A304), gravado em
tests/fixtures/ pelo workflow `sondar-fontes`, normalizado pela migração 018
num Postgres descartável."""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from src.ingest.inmet import ler_csv, linhas_de_medicao

RAIZ = Path(__file__).resolve().parents[1]
CSV = RAIZ / "tests" / "fixtures" / "FIXTURE_inmet_natal_2026_inicio.csv"
META = json.loads((RAIZ / "tests" / "fixtures" / "FIXTURE_inmet_natal_2026_inicio.meta.json").read_text(encoding="utf-8"))


def test_csv_real_tem_cabecalho_e_medicoes():
    texto = ler_csv(CSV.read_bytes())
    assert "ESTACAO:;NATAL" in texto and "CODIGO (WMO):;A304" in texto
    assert len(linhas_de_medicao(texto)) > 100


PG = os.getenv("VIGIGEN_PG_TESTE")


@pytest.fixture()
def banco():
    if not PG:
        pytest.skip("defina VIGIGEN_PG_TESTE=<url de um Postgres descartável> para testar a migração")
    import psycopg

    sem_q, _, q = PG.partition("?")
    base, _, _ = sem_q.rpartition("/")
    nome = "vigigen_teste_018"
    with psycopg.connect(PG, autocommit=True) as c:
        c.execute(f"drop database if exists {nome}")
        c.execute(f"create database {nome}")
    url = f"{base}/{nome}" + (f"?{q}" if q else "")
    for arq in ("tests/fixtures/sql/FIXTURE_esquema_minimo.sql", "tests/fixtures/sql/FIXTURE_stub_017.sql",
                "src/db/migrations/017_fontes_demas.sql", "src/db/migrations/018_clima_inmet.sql"):
        r = subprocess.run(["psql", url, "-q", "-v", "ON_ERROR_STOP=1", "-f", arq], cwd=RAIZ,
                           capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
    with psycopg.connect(url, autocommit=True) as c:
        yield c


def _bruto(c, texto):
    return c.execute("""insert into public.bruto (fonte, endpoint, parametros, status_http, sha256, corpo)
                        values ('inmet', %s, %s, 200, %s, %s) returning id""",
                     (META["_url"], json.dumps({"arquivo": META["_arquivo"]}), META["_sha256_arquivo"],
                      texto)).fetchone()[0]


def test_018_estacao_e_horas(banco):
    c = banco
    texto = ler_csv(CSV.read_bytes())
    medicoes = linhas_de_medicao(texto)
    b = _bruto(c, texto)
    assert c.execute("select public.ingest_inmet(%s)", (b,)).fetchone()[0] == len(medicoes)
    assert c.execute("select public.ingest_inmet(%s)", (b,)).fetchone()[0] == len(medicoes)  # upsert
    assert c.execute("select count(*) from public.clima_horario").fetchone()[0] == len(medicoes)
    e = c.execute("select codigo, nome, uf, geocodigo, latitude from public.estacao_meteorologica").fetchall()
    assert e == [("A304", "NATAL", "RN", 2408102, e[0][4])] and -6 < e[0][4] < -5
    # primeira medição do arquivo: 2026/01/01 0000 UTC, 26,8 °C, 81 %, chuva 0
    p = c.execute("""select data_hora_utc at time zone 'UTC', precipitacao_mm, temperatura_c, umidade_pct
                     from public.clima_horario order by 1 limit 1""").fetchone()
    assert (str(p[0]), float(p[1]), float(p[2]), float(p[3])) == ("2026-01-01 00:00:00", 0.0, 26.8, 81.0)
    # 1/1/2026 é quinta: a semana começa no domingo 28/12/2025
    s = c.execute("select semana_inicio, horas_chuva from public.clima_semanal order by 1").fetchall()
    assert str(s[0][0]) == "2025-12-28" and all(str(x[0]) >= "2025-12-28" for x in s)
    j = c.execute("select public.painel_clima(2408102)").fetchone()[0]
    assert j["estacoes"] == [{"codigo": "A304", "nome": "NATAL"}] and j["semanas"]


def test_018_recusa_bruto_que_nao_e_inmet(banco):
    import psycopg

    b = banco.execute("""insert into public.bruto (fonte, endpoint, status_http, corpo)
                         values ('cnes', 'x', 200, '{}') returning id""").fetchone()[0]
    with pytest.raises(psycopg.errors.RaiseException):
        banco.execute("select public.ingest_inmet(%s)", (b,))
