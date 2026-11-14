"""Camada genômica multiagravo (D-015): o vírus vem só do organismo declarado
e o sorotipo DENV só existe para dengue."""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from src.ingest.genbank import TERMOS, agravo_de

RAIZ = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("organismo,esperado", [
    ("dengue virus type 1", "dengue"), ("Dengue virus", "dengue"), ("dengue virus type 4", "dengue"),
    ("Chikungunya virus", "chikungunya"), ("Zika virus", "zika"),
    ("West Nile virus", None), (None, None), ("", None),
])
def test_agravo_de(organismo, esperado):
    assert agravo_de(organismo) == esperado


def test_termos_um_por_agravo():
    assert set(TERMOS) == {"dengue", "chikungunya", "zika"}
    assert TERMOS["dengue"] == '"Dengue virus"[Organism] AND Brazil[All Fields]'
    assert all(t.endswith("AND Brazil[All Fields]") for t in TERMOS.values())


def test_termos_iguais_na_edge_function_e_na_migracao():
    ts = (RAIZ / "supabase/functions/ingest-genbank/index.ts").read_text()
    sql = (RAIZ / "src/db/migrations/013_multiagravo.sql").read_text()
    for termo in TERMOS.values():
        assert termo in ts
        assert termo in sql


@pytest.mark.skipif(not os.getenv("VIGIGEN_PG_TESTE") or not shutil.which("psql"),
                    reason="defina VIGIGEN_PG_TESTE=<url de um Postgres descartável> para testar a migração")
def test_migracao_013_em_postgres_descartavel():
    url = os.environ["VIGIGEN_PG_TESTE"]
    for arq in ("tests/fixtures/sql/FIXTURE_esquema_minimo.sql", "tests/fixtures/sql/FIXTURE_teste_013.sql"):
        r = subprocess.run(["psql", url, "-q", "-v", "ON_ERROR_STOP=1", "-f", arq],
                           cwd=RAIZ, capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
    assert "OK: migração 013" in r.stderr
