"""Migração 022 (botão Sincronizar): fila de sincronização manual.

Roda num Postgres descartável, como os testes da 013:
    VIGIGEN_PG_TESTE=postgresql://.../qualquer pytest tests/test_sincronizacao.py
"""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]


def test_painel_nao_monta_comando_de_disparo():
    """O navegador só chama funções do banco; endpoints e comandos ficam no cron.job."""
    for arq in ("web/src/dados/sincronizacao.ts", "web/src/componentes/Sincronizar.tsx"):
        txt = (RAIZ / arq).read_text()
        assert "functions/v1" not in txt
        assert "service_role" not in txt.lower()
        assert "app.disparar" not in txt


@pytest.mark.skipif(not os.getenv("VIGIGEN_PG_TESTE") or not shutil.which("psql"),
                    reason="defina VIGIGEN_PG_TESTE=<url de um Postgres descartável> para testar a migração")
def test_migracao_022_em_postgres_descartavel():
    url = os.environ["VIGIGEN_PG_TESTE"]
    banco = "vigigen_sincronizacao_teste"
    sem_q, _, q = url.partition("?")
    raiz = sem_q.rsplit("/", 1)[0]
    sufixo = f"?{q}" if q else ""
    admin, alvo = f"{raiz}/postgres{sufixo}", f"{raiz}/{banco}{sufixo}"
    for cmd in (f"drop database if exists {banco}", f"create database {banco}"):
        r = subprocess.run(["psql", admin, "-qc", cmd], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
    arquivos = ["tests/fixtures/sql/FIXTURE_esquema_minimo.sql", "tests/fixtures/sql/FIXTURE_stub_auth_admin.sql"] + [
        f"src/db/migrations/{m}.sql" for m in
        ("011_administracao", "012_genbank_diario", "013_multiagravo", "015_seguranca", "016_sla_painel")
    ] + ["tests/fixtures/sql/FIXTURE_teste_022.sql"]
    saida = ""
    for arq in arquivos:
        r = subprocess.run(["psql", alvo, "-q", "-v", "ON_ERROR_STOP=1", "-f", arq],
                           cwd=RAIZ, capture_output=True, text=True)
        assert r.returncode == 0, f"{arq}: {r.stderr}"
        saida += r.stderr
    assert "OK: migração 022" in saida
