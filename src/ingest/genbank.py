"""NCBI GenBank — sequências de dengue, chikungunya e Zika via E-utilities
(esearch + efetch), um termo por agravo (D-018). Validados em 14/11/2026:

  dengue       "Dengue virus"[Organism] AND Brazil[All Fields]       7.203
  chikungunya  "Chikungunya virus"[Organism] AND Brazil[All Fields]  1.839
  zika         "Zika virus"[Organism] AND Brazil[All Fields]         519

O país migrou de /country para /geo_loc_name: os dois são lidos.
Limite: 3 req/s sem chave; 10 req/s com NCBI_API_KEY. tool=vigigen e
email=NCBI_EMAIL (variáveis de ambiente) são enviados quando definidos.

Taxon: Dengue virus = 12637 (NCBI Taxonomy). Sorotipos: DENV-1 11053,
DENV-2 11060, DENV-3 11069, DENV-4 11070 — conferir em
https://www.ncbi.nlm.nih.gov/Taxonomy antes de usar filtros por taxon.
"""
from __future__ import annotations

import json
import os
import re
import time
import xml.etree.ElementTree as ET

import pandas as pd

from .comum import PROCESSED, RAW, buscar

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
TERMOS = {
    "dengue": '"Dengue virus"[Organism] AND Brazil[All Fields]',
    "chikungunya": '"Chikungunya virus"[Organism] AND Brazil[All Fields]',
    "zika": '"Zika virus"[Organism] AND Brazil[All Fields]',
}
TERMO = TERMOS["dengue"]


def agravo_de(organismo: str | None) -> str | None:
    """Mesma regra de app.agravo_de (migração 013): só o organismo declarado."""
    o = (organismo or "").strip().lower()
    for prefixo, agravo in (("dengue virus", "dengue"), ("chikungunya virus", "chikungunya"),
                            ("zika virus", "zika")):
        if o.startswith(prefixo):
            return agravo
    return None
LOTE = 100

_SOROTIPO = re.compile(r"(?:dengue virus|denv)[ -]*(?:type[ -]*)?([1-4])\b", re.I)


def _comuns() -> dict:
    p = {"tool": "vigigen"}
    if os.getenv("NCBI_EMAIL"):
        p["email"] = os.environ["NCBI_EMAIL"]
    if os.getenv("NCBI_API_KEY"):
        p["api_key"] = os.environ["NCBI_API_KEY"]
    return p


def sorotipo(*textos: str | None) -> str | None:
    for t in textos:
        if not t:
            continue
        if re.fullmatch(r"\s*(?:type\s*)?([1-4])\s*", t, re.I):
            return f"DENV-{t.strip()[-1]}"
        m = _SOROTIPO.search(t) or re.search(r"serotype[ -]*([1-4])\b", t, re.I)
        if m:
            return f"DENV-{m.group(1)}"
    return None


def _quals(gbseq: ET.Element) -> dict:
    for feat in gbseq.iterfind("GBSeq_feature-table/GBFeature"):
        if feat.findtext("GBFeature_key") == "source":
            return {q.findtext("GBQualifier_name"): q.findtext("GBQualifier_value")
                    for q in feat.iterfind("GBFeature_quals/GBQualifier")}
    return {}


def executar(agravo: str = "dengue") -> dict:
    termo = TERMOS[agravo]
    intervalo = 0.12 if os.getenv("NCBI_API_KEY") else 0.4
    ids, retstart, count = [], 0, None
    while count is None or retstart < count:
        r = buscar("genbank", f"{EUTILS}/esearch.fcgi",
                   {"db": "nuccore", "retmode": "json", "retmax": 10000, "retstart": retstart,
                    "term": termo, **_comuns()}, nome=f"esearch_{agravo}_{retstart}")
        res = json.loads(r.corpo)["esearchresult"]
        count = int(res["count"])
        ids += res["idlist"]
        retstart += 10000
        time.sleep(intervalo)
    acesso = r.obtido_em
    if not ids:
        raise RuntimeError(f"esearch sem resultados para {termo!r}")

    linhas, fasta = [], []
    for i in range(0, len(ids), LOTE):
        lote = ids[i:i + LOTE]
        r = buscar("genbank", f"{EUTILS}/efetch.fcgi", metodo="POST",
                   data={"db": "nuccore", "rettype": "gb", "retmode": "xml",
                         "id": ",".join(lote), **_comuns()},
                   nome=f"efetch_{agravo}_{i:06d}", extensao="xml")
        for s in ET.fromstring(r.corpo).iterfind("GBSeq"):
            q = _quals(s)
            acc = s.findtext("GBSeq_primary-accession")
            geo = q.get("geo_loc_name") or q.get("country")
            seq = (s.findtext("GBSeq_sequence") or "").upper()
            linhas.append({
                "accession": acc,
                "organismo": s.findtext("GBSeq_organism"),
                "agravo": agravo_de(s.findtext("GBSeq_organism")),
                # sorotipo DENV-1..4 só existe para dengue
                "sorotipo_declarado": (sorotipo(q.get("serotype"), s.findtext("GBSeq_organism"),
                                                s.findtext("GBSeq_definition"))
                                       if agravo_de(s.findtext("GBSeq_organism")) == "dengue" else None),
                "data_coleta": q.get("collection_date"),
                "data_publicacao": s.findtext("GBSeq_create-date"),
                "geo_loc_name": geo,
                "rn": bool(geo and re.search(r"rio grande do norte|\bRN\b", geo, re.I)),
                "hospedeiro": q.get("host"),
                "tamanho": int(s.findtext("GBSeq_length") or 0),
                "bruto": r.caminho_bruto.name,
            })
            if seq:
                fasta.append(f">{acc}\n{seq}\n")
        time.sleep(intervalo)

    df = pd.DataFrame(linhas)
    PROCESSED.mkdir(parents=True, exist_ok=True)
    sufixo = "" if agravo == "dengue" else f"_{agravo}"
    df.to_parquet(PROCESSED / f"sequencias_metadados{sufixo}.parquet", index=False)
    (RAW / "genbank" / f"sequencias{sufixo}_{acesso}.fasta").write_text("".join(fasta))
    ano = pd.to_datetime(df["data_coleta"], errors="coerce", format="mixed").dt.year
    return {
        "fonte": f"NCBI GenBank ({agravo})", "agravo": agravo, "endpoint": f"{EUTILS}/esearch+efetch", "termo": termo,
        "acesso": acesso, "registros": len(df),
        "rn": int(df["rn"].sum()),
        "brasil_sem_estado": int(df["geo_loc_name"].fillna("").str.fullmatch(r"\s*Brazil\s*").sum()),
        "por_ano": ano.value_counts().sort_index().to_dict(),
        "por_sorotipo": df["sorotipo_declarado"].fillna("não declarado").value_counts().to_dict(),
    }
