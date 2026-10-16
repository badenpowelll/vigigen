"""Classificação de sorotipo, genótipo e linhagem com o Nextclade CLI.

Não fixamos nome de dataset no código (regra 2 do CLAUDE.md): o dataset é
escolhido a partir de `nextclade dataset list` e informado em
NEXTCLADE_DATASET. A versão do CLI e a tag do dataset são gravadas junto de
cada classificação (regra 5).

Uso:
  python -m src.pipeline.classify listar
  NEXTCLADE_DATASET=<nome> python -m src.pipeline.classify rodar --fasta data/interim/seq.fasta
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
from pathlib import Path

from src.ingest.comum import DATA

SAIDA = DATA / "interim" / "nextclade"


def _rodar(cmd: list[str]) -> str:
    r = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)} falhou ({r.returncode}): {r.stderr.strip()}")
    return r.stdout


def versao_nextclade() -> str:
    return _rodar(["nextclade", "--version"]).strip()


def listar_datasets(busca: str = "dengue") -> list[dict]:
    """Datasets oficiais que mencionam `busca`, como o próprio Nextclade os lista."""
    saida = _rodar(["nextclade", "dataset", "list", "--json", "--search", busca])
    return json.loads(saida)


def baixar_dataset(nome: str, destino: Path) -> dict:
    destino.mkdir(parents=True, exist_ok=True)
    _rodar(["nextclade", "dataset", "get", "--name", nome, "--output-dir", str(destino)])
    info = json.loads((destino / "pathogen.json").read_text(encoding="utf-8"))
    tag = (info.get("version") or {}).get("tag") or "desconhecida"
    return {"nome": nome, "tag": tag}


def classificar(fasta: Path, nome_dataset: str) -> Path:
    ds_dir = SAIDA / "dataset"
    ds = baixar_dataset(nome_dataset, ds_dir)
    tsv = SAIDA / "nextclade.tsv"
    _rodar(["nextclade", "run", "--input-dataset", str(ds_dir), "--output-tsv", str(tsv), str(fasta)])
    meta = {"nextclade_versao": versao_nextclade(), "dataset_nome": ds["nome"], "dataset_tag": ds["tag"]}
    (SAIDA / "versoes.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return tsv


def ler_tsv(tsv: Path) -> list[dict]:
    with tsv.open(encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter="\t"))


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("listar")
    r = sub.add_parser("rodar")
    r.add_argument("--fasta", type=Path, required=True)
    a = ap.parse_args()
    if a.cmd == "listar":
        for d in listar_datasets():
            print(d.get("path") or d.get("name"), "|", (d.get("attributes") or {}).get("name", ""))
        return
    nome = os.environ.get("NEXTCLADE_DATASET")
    if not nome:
        raise SystemExit("Defina NEXTCLADE_DATASET com um nome de `python -m src.pipeline.classify listar`.")
    print(classificar(a.fasta, nome))


if __name__ == "__main__":
    main()
