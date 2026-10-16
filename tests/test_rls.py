"""Roda tests/test_rls.sql contra o banco e confere o resultado.

O SQL termina com RAISE EXCEPTION de propósito: assim tudo que ele cria
(usuários e organizações FIXTURE_) é desfeito. O resultado vem na mensagem.

Uso: DATABASE_URL=postgresql://... pytest tests/test_rls.py
"""
import json
import os
import pathlib
import re

import pytest

psycopg = pytest.importorskip("psycopg")

SQL = (pathlib.Path(__file__).parent / "test_rls.sql").read_text(encoding="utf-8")


@pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="DATABASE_URL não definido")
def test_isolamento_territorial():
    with psycopg.connect(os.environ["DATABASE_URL"]) as con:
        with pytest.raises(psycopg.errors.RaiseException) as exc:
            con.execute(SQL)
    m = re.search(r"RLS_RESULTADO (\{.*\})", str(exc.value), re.S)
    assert m, str(exc.value)
    r = json.loads(m.group(1))
    assert r["ok"], r["falhas"]
    assert r["medido"]["natal"]["caso_semanal_mossoro"] == 0
    assert r["medido"]["mossoro"]["caso_semanal_natal"] == 0
    assert r["medido"]["estado"]["caso_semanal_total_municipios"] == 167
