"""SINAN (agregado) e CNES pela API DEMAS (D-020), com respostas reais gravadas
em tests/fixtures/ pelo workflow `sondar-fontes`.

- a agregação conserva o total de notificações e não usa coluna pessoal;
- Python (CLI) e TypeScript (Edge Function) agregam igual;
- a migração 017 normaliza contagens e estabelecimentos num Postgres descartável.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from src.ingest.demas import CHAVE_SINAN, agregar_sinan, corpo_agregado

RAIZ = Path(__file__).resolve().parents[1]
FIX = RAIZ / "tests" / "fixtures"
SINAN = sorted(FIX.glob("FIXTURE_demas_*_natal_2026_p*.json"))
CNES = FIX / "FIXTURE_cnes_natal_tipo2_p0.json"

# Colunas pessoais que a API devolve (lidas da resposta real em 14/11/2026);
# nenhuma pode estar na chave nem nas fixtures.
PESSOAIS = {"nu_idade_n", "nu_idade", "cs_sexo", "cs_gestant", "cs_raca", "cs_escol_n", "cs_escolar",
            "ano_nasc", "id_ocupa_n", "dt_nasc", "dt_sin_pri", "dt_notific", "dt_invest", "dt_obito",
            "dt_encerra", "dt_digita", "id_unidade", "nu_notific"}


def _fixtures():
    if not SINAN:
        pytest.skip("fixtures do SINAN ainda não gravadas (rode o workflow sondar-fontes)")
    return [(p, json.loads(p.read_text(encoding="utf-8"))) for p in SINAN]


def test_chave_nao_tem_coluna_pessoal():
    assert not set(CHAVE_SINAN) & PESSOAIS


def test_fixtures_so_tem_colunas_da_chave():
    for p, f in _fixtures():
        assert f["registros"], f"{p.name} vazia"
        for r in f["registros"]:
            assert set(r) <= set(CHAVE_SINAN), p.name
        # a resposta original tinha colunas pessoais: é por isso que ela não é gravada
        assert set(f["_colunas_na_resposta"]) & PESSOAIS, p.name


def test_agregacao_conserva_o_total():
    for p, f in _fixtures():
        cont = agregar_sinan(f["registros"])
        assert sum(c["n"] for c in cont) == len(f["registros"]), p.name
        assert all(c["n"] > 0 for c in cont)
        assert len({tuple(c[k] for k in CHAVE_SINAN) for c in cont}) == len(cont)


def test_corpo_gravado_nao_tem_coluna_pessoal():
    for p, f in _fixtures():
        texto = json.dumps(corpo_agregado("dengue", f["registros"]))
        for col in PESSOAIS:
            assert f'"{col}"' not in texto, (p.name, col)


def test_vazio_vira_nulo():
    cont = agregar_sinan([{"nu_ano": "2026", "sorotipo": "nan"}, {"nu_ano": "2026", "sorotipo": None},
                          {"nu_ano": "2026", "sorotipo": ""}])
    assert cont == [{**{k: None for k in CHAVE_SINAN}, "nu_ano": "2026", "n": 3}]


@pytest.mark.skipif(not shutil.which("deno"), reason="deno não instalado")
def test_python_e_edge_function_agregam_igual():
    arqs = [str(p) for p, _ in _fixtures()]
    r = subprocess.run(["deno", "run", "--allow-read", "tests/deno/agregar_sinan.ts", *arqs],
                       cwd=RAIZ, capture_output=True, text=True, check=True)
    ts = json.loads(r.stdout)
    for arq in arqs:
        f = json.loads(Path(arq).read_text(encoding="utf-8"))
        assert ts[arq] == corpo_agregado("teste", f["registros"]), arq


# --- migração 017 num Postgres descartável ------------------------------------

PG = os.getenv("VIGIGEN_PG_TESTE")


@pytest.fixture()
def banco():
    if not PG:
        pytest.skip("defina VIGIGEN_PG_TESTE=<url de um Postgres descartável> para testar a migração")
    import psycopg

    sem_q, _, q = PG.partition("?")
    base, _, _ = sem_q.rpartition("/")
    nome = "vigigen_teste_017"
    with psycopg.connect(PG, autocommit=True) as c:
        c.execute(f"drop database if exists {nome}")
        c.execute(f"create database {nome}")
    url = f"{base}/{nome}" + (f"?{q}" if q else "")
    for arq in ("tests/fixtures/sql/FIXTURE_esquema_minimo.sql", "tests/fixtures/sql/FIXTURE_stub_017.sql",
                "src/db/migrations/017_fontes_demas.sql"):
        r = subprocess.run(["psql", url, "-q", "-v", "ON_ERROR_STOP=1", "-f", arq], cwd=RAIZ,
                           capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
    with psycopg.connect(url, autocommit=True) as c:
        yield c


def _bruto(c, fonte, corpo, params=None, status=200):
    return c.execute("""insert into public.bruto (fonte, endpoint, parametros, status_http, sha256, corpo)
                        values (%s, %s, %s, %s, %s, %s) returning id""",
                     (fonte, "https://apidadosabertos.saude.gov.br", json.dumps(params or {}), status,
                      "teste", corpo)).fetchone()[0]


def test_017_sinan_contagens_e_view(banco):
    c = banco
    agravos = sorted({p.name.split("_")[2] for p in SINAN})
    ex = c.execute("""insert into public.execucao_ingestao (fonte, parametros, status)
                      values ('sinan', %s, 'em_andamento') returning id""",
                   (json.dumps({"ano": 2026, "agravos": agravos}),)).fetchone()[0]
    total = 0
    for p, f in _fixtures():
        agravo = p.name.split("_")[2]
        b = _bruto(c, "sinan", json.dumps(corpo_agregado(agravo, f["registros"])))
        n = c.execute("select public.ingest_sinan(%s, %s)", (b, ex)).fetchone()[0]
        assert n == len(agregar_sinan(f["registros"]))
        assert c.execute("select public.ingest_sinan(%s, %s)", (b, ex)).fetchone()[0] == 0  # idempotente
        s = c.execute("select sum(n) from public.notificacao_sinan where bruto_id = %s", (b,)).fetchone()[0]
        assert s == len(f["registros"])
        total += len(f["registros"])
    # notificadas em Natal (id_municip = 240810) => geocódigo de notificação 2408102
    assert c.execute("""select count(*) from public.notificacao_sinan
                        where geocodigo_notificacao is distinct from 2408102""").fetchone()[0] == 0
    # residência fora do RN fica sem geocódigo; no RN, casa com o IBGE
    assert c.execute("""select count(*) from public.notificacao_sinan
                        where mun_residencia6 like '24%' and geocodigo_residencia is null""").fetchone()[0] == 0
    # execução em andamento não aparece; concluída aparece inteira
    assert c.execute("select count(*) from public.notificacao_sinan_vigente").fetchone()[0] == 0
    c.execute("update public.execucao_ingestao set status = 'ok' where id = %s", (ex,))
    assert c.execute("select sum(n) from public.notificacao_sinan_vigente").fetchone()[0] == total
    j = c.execute("select public.painel_sinan(2408102, %s)", (agravos[0],)).fetchone()[0]
    assert j["semanas"] and all(s["n"] > 0 for s in j["semanas"])


def test_017_bruto_aceita_fontes_novas_e_recusa_outras(banco):
    for f in ("sinan", "cnes", "inmet", "infodengue"):
        _bruto(banco, f, "{}")
    import psycopg

    with pytest.raises(psycopg.errors.CheckViolation):
        _bruto(banco, "fonte_inventada", "{}")


def test_017_cnes(banco):
    if not CNES.exists():
        pytest.skip("fixture do CNES ainda não gravada")
    c = banco
    f = json.loads(CNES.read_text(encoding="utf-8"))
    regs = f["resposta"]["estabelecimentos"]
    b = _bruto(c, "cnes", json.dumps(f["resposta"]))
    assert c.execute("select public.ingest_cnes(%s)", (b,)).fetchone()[0] == len(regs)
    linhas = c.execute("select codigo_cnes, geocodigo, nome, codigo_tipo_unidade from public.estabelecimento").fetchall()
    assert len(linhas) == len(regs)
    assert {g for _, g, _, _ in linhas} == {2408102}
    assert {t for *_, t in linhas} == {2}
    sem_cnpj = {int(r["codigo_cnes"]) for r in regs if not r.get("numero_cnpj") and not r.get("numero_cnpj_entidade")}
    assert all((nome is None) == (cnes in sem_cnpj) for cnes, _, nome, _ in linhas)
    assert c.execute("select public.ingest_cnes(%s)", (b,)).fetchone()[0] == len(regs)  # upsert, sem duplicar
    assert c.execute("select count(*) from public.estabelecimento").fetchone()[0] == len(regs)
