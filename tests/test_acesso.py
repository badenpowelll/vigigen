"""Acesso indevido entre organizações e limite da Edge Function `acesso`
(auditoria de 14/11/2026).

Num Postgres descartável (VIGIGEN_PG_TESTE): cria um banco, aplica o esquema
mínimo, 002 (RLS), 011, 012, 013, 015, 016 e 021 e roda
tests/test_acesso_indevido.sql e tests/fixtures/sql/FIXTURE_teste_021.sql.

Em homologação (DATABASE_URL, com todas as migrações): roda só
tests/test_acesso_indevido.sql, que desfaz tudo no fim. Ver docs/HOMOLOGACAO_015.md.
"""
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
CADEIA = ["tests/fixtures/sql/FIXTURE_esquema_minimo.sql", "tests/fixtures/sql/FIXTURE_stub_auth_admin.sql",
          "tests/fixtures/sql/FIXTURE_stub_acesso.sql"] + [
    f"src/db/migrations/{m}.sql" for m in
    ("002_rls", "011_administracao", "012_genbank_diario", "013_multiagravo", "015_seguranca",
     "016_sla_painel", "021_acesso_limite")] + ["tests/fixtures/sql/FIXTURE_stub_acesso.sql"]


def _psql(url, *args):
    return subprocess.run(["psql", url, "-q", *args], cwd=RAIZ, capture_output=True, text=True)


def _resultado(saida: str) -> dict:
    m = re.search(r"ACESSO_RESULTADO (\{.*\})", saida, re.S)
    assert m, saida
    return json.loads(m.group(1))


@pytest.fixture(scope="module")
def banco_local():
    url = os.getenv("VIGIGEN_PG_TESTE")
    if not url or not shutil.which("psql"):
        pytest.skip("defina VIGIGEN_PG_TESTE=<url de um Postgres descartável>")
    banco = "vigigen_acesso_teste"
    sem_q, _, q = url.partition("?")
    raiz = sem_q.rsplit("/", 1)[0]
    sufixo = f"?{q}" if q else ""
    admin, alvo = f"{raiz}/postgres{sufixo}", f"{raiz}/{banco}{sufixo}"
    for cmd in (f"drop database if exists {banco}", f"create database {banco}"):
        r = _psql(admin, "-c", cmd)
        assert r.returncode == 0, r.stderr
    for arq in CADEIA:
        r = _psql(alvo, "-v", "ON_ERROR_STOP=1", "-f", arq)
        assert r.returncode == 0, f"{arq}: {r.stderr}"
    return alvo


def test_acesso_indevido_local(banco_local):
    r = _resultado(_psql(banco_local, "-f", "tests/test_acesso_indevido.sql").stderr)
    assert r["ok"], r["falhas"]
    for nome in ("natal", "mossoro", "estado", "desativado", "sem_vinculo"):
        assert r["medido"][nome]["admin_negado"] is True
        assert r["medido"][nome]["perfil_de_outros"] == 0
    assert r["medido"]["natal"]["alerta_mossoro"] == 0
    assert r["medido"]["mossoro"]["alerta_natal"] == 0


def test_limite_da_funcao_acesso(banco_local):
    r = _psql(banco_local, "-v", "ON_ERROR_STOP=1", "-f", "tests/fixtures/sql/FIXTURE_teste_021.sql")
    assert r.returncode == 0, r.stderr
    assert "OK: migração 021" in r.stderr


@pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="DATABASE_URL (homologação) não definido")
def test_acesso_indevido_homologacao():
    r = _resultado(_psql(os.environ["DATABASE_URL"], "-f", "tests/test_acesso_indevido.sql").stderr)
    assert r["ok"], r["falhas"]


def test_edge_function_acesso_passa_pelo_limite():
    ts = (RAIZ / "supabase/functions/acesso/index.ts").read_text()
    pos_limite = ts.index('rpc("acesso_pode_tentar"')
    assert pos_limite < ts.index('rpc("liberar_convite"'), "o limite vem antes de conferir o código"
    assert "status: 429" in ts and "Retry-After" in ts
    for r in ('"ok"', '"recusado"', '"erro"'):
        assert f"resultado({r}" in ts, f"resultado {r} registrado"
