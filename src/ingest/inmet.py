"""INMET — dados históricos das estações automáticas (D-021).

Fonte: https://portal.inmet.gov.br/uploads/dadoshistoricos/<ano>.zip, um ZIP
por ano com um CSV por estação (latin-1, ';', vírgula decimal). Em 14/11/2026 o
de 2026 ia até 31/10/2026 e tinha 7 estações do RN: A304 Natal, A316 Caicó,
A317 Macau, A318 Mossoró, A340 Apodi, A367 Santa Cruz, A372 Ipanguaçu.

A rota apitempo.inmet.gov.br/estacao/{inicio}/{fim}/{codigo} respondeu 204 sem
corpo (sem token) e não é usada.

O ZIP é gravado cru em data/raw/inmet/ (regra 3). `carregar` grava cada CSV do
RN, inteiro e já em UTF-8, em public.bruto (fonte 'inmet') e chama
public.ingest_inmet (migração 018). Ela só roda com --banco e a URL do banco na
variável DATABASE_URL.
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile

from .comum import buscar

BASE = "https://portal.inmet.gov.br/uploads/dadoshistoricos"
_MEDICAO = re.compile(r"^\d{4}[-/]\d{2}[-/]\d{2};")


def ler_csv(conteudo: bytes) -> str:
    """Os CSVs do INMET vêm em latin-1."""
    return conteudo.decode("latin-1")


def linhas_de_medicao(texto: str) -> list[str]:
    return [l for l in texto.splitlines() if _MEDICAO.match(l)]


def baixar(ano: int, uf: str = "RN") -> dict:
    r = buscar("inmet", f"{BASE}/{ano}.zip", nome=f"dadoshistoricos_{ano}", extensao="zip", timeout=300)
    if r.status != 200:
        raise RuntimeError(f"INMET {ano}.zip: HTTP {r.status} (gravado em {r.caminho_bruto})")
    z = zipfile.ZipFile(io.BytesIO(r.corpo))
    arquivos = {}
    for nome in z.namelist():
        base = nome.rsplit("/", 1)[-1]
        if f"_{uf}_" in base.upper() and base.upper().endswith(".CSV"):
            conteudo = z.read(nome)
            arquivos[base] = {"texto": ler_csv(conteudo), "sha256": hashlib.sha256(conteudo).hexdigest()}
    if not arquivos:
        raise RuntimeError(f"INMET {ano}.zip: nenhuma estação de {uf} no arquivo")
    return {"url": r.url, "sha256_zip": hashlib.sha256(r.corpo).hexdigest(), "obtido_em": r.obtido_em,
            "arquivos": arquivos}


def carregar(dados: dict, dsn: str) -> dict:
    import psycopg

    horas = {}
    with psycopg.connect(dsn, autocommit=True) as c:
        for nome, a in sorted(dados["arquivos"].items()):
            b = c.execute("""insert into public.bruto (fonte, endpoint, parametros, status_http, sha256,
                                                     tamanho_bytes, corpo)
                             values ('inmet', %s, %s, 200, %s, %s, %s) returning id""",
                          (dados["url"], json.dumps({"arquivo": nome, "sha256_zip": dados["sha256_zip"],
                                                     "obtido_em": dados["obtido_em"]}),
                           a["sha256"], len(a["texto"].encode()), a["texto"])).fetchone()[0]
            horas[nome] = c.execute("select public.ingest_inmet(%s)", (b,)).fetchone()[0]
    return horas


def executar(ano: int, banco: bool = False) -> dict:
    import os

    dados = baixar(ano)
    res = {"fonte": "inmet", "url": dados["url"], "sha256_zip": dados["sha256_zip"],
           "estacoes": {n: len(linhas_de_medicao(a["texto"])) for n, a in dados["arquivos"].items()}}
    if banco:
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            raise RuntimeError("--banco pede a variável DATABASE_URL")
        res["horas_gravadas"] = carregar(dados, dsn)
    return res
