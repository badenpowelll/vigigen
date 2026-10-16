"""Classificação de sorotipo e linhagem com o Nextclade CLI, em dois passos.

1. O dataset de sorotipo (NEXTCLADE_DATASET_SOROTIPO) classifica todas as
   sequências; o clado devolvido é o sorotipo (DENV1..DENV4).
2. Cada sorotipo passa pelo seu dataset de linhagem
   (NEXTCLADE_DATASET_LINHAGEM, com {n} trocado pelo número do sorotipo).

Os nomes não ficam fixos no código (regra 2 do CLAUDE.md): vêm de variáveis
de ambiente e foram escolhidos de `nextclade dataset list` (D-013). A versão
do CLI e a tag de cada dataset são gravadas junto de cada classificação
(regra 5).

Uso:
  python -m src.pipeline.classify listar
  NEXTCLADE_DATASET_SOROTIPO=... NEXTCLADE_DATASET_LINHAGEM=...{n} \
    python -m src.pipeline.classify rodar --fasta data/interim/seq.fasta
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
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


def _nextclade(fasta: Path, nome_dataset: str, rotulo: str) -> tuple[Path, dict]:
    ds_dir = SAIDA / "datasets" / rotulo
    ds = baixar_dataset(nome_dataset, ds_dir)
    tsv = SAIDA / f"{rotulo}.tsv"
    _rodar(["nextclade", "run", "--input-dataset", str(ds_dir), "--output-tsv", str(tsv), str(fasta)])
    return tsv, ds


def _separar_por_sorotipo(fasta: Path, sorotipo_de: dict[str, str]) -> dict[str, Path]:
    """Grava um FASTA por sorotipo com as sequências que o passo 1 atribuiu a ele."""
    arquivos: dict[str, Path] = {}
    saidas: dict[str, object] = {}
    atual = None
    with fasta.open(encoding="utf-8") as f:
        for linha in f:
            if linha.startswith(">"):
                atual = sorotipo_de.get(linha[1:].strip())
                if atual and atual not in saidas:
                    arquivos[atual] = SAIDA / f"seq_{atual}.fasta"
                    saidas[atual] = arquivos[atual].open("w", encoding="utf-8")
            if atual:
                saidas[atual].write(linha)  # type: ignore[attr-defined]
    for s in saidas.values():
        s.close()  # type: ignore[attr-defined]
    return arquivos


def classificar(fasta: Path, ds_sorotipo: str, ds_linhagem: str) -> Path:
    """Roda os dois passos e grava classificacao.tsv com uma linha por sequência."""
    SAIDA.mkdir(parents=True, exist_ok=True)
    tsv1, ds1 = _nextclade(fasta, ds_sorotipo, "sorotipo")
    passo1 = ler_tsv(tsv1)
    sorotipo_de = {l["seqName"]: l["clade"] for l in passo1 if re.fullmatch(r"DENV[1-4]", l.get("clade") or "")}
    versoes = {"nextclade_versao": versao_nextclade(), "sorotipo": ds1, "linhagem": {}}

    passo2: dict[str, tuple[dict, str]] = {}
    for sor, arq in _separar_por_sorotipo(fasta, sorotipo_de).items():
        nome = ds_linhagem.format(n=sor[-1])
        tsv2, ds2 = _nextclade(arq, nome, f"linhagem_{sor}")
        versoes["linhagem"][sor] = ds2
        for l in ler_tsv(tsv2):
            passo2[l["seqName"]] = (l, f"{ds2['nome']}@{ds2['tag']}")

    saida = SAIDA / "classificacao.tsv"
    campos = ["seqName", "sorotipo", "genotipo", "linhagem", "coverage", "qc.overallStatus", "qc.overallScore",
              "errors", "dataset"]
    with saida.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=campos, delimiter="\t")
        w.writeheader()
        for l1 in passo1:
            sor = sorotipo_de.get(l1["seqName"])
            l2, ds = passo2.get(l1["seqName"], (None, f"{ds1['nome']}@{ds1['tag']}"))
            base = l2 or l1  # a cobertura e o QC vêm do passo mais específico que rodou
            linhagem = (l2 or {}).get("clade") or None
            w.writerow({
                "seqName": l1["seqName"], "sorotipo": sor or "",
                # genótipo = prefixo do clado antes do "_" (ex.: 2II_F.1.1.10 -> 2II)
                "genotipo": linhagem.split("_")[0] if linhagem and "_" in linhagem else "",
                "linhagem": linhagem or "", "coverage": base.get("coverage", ""),
                "qc.overallStatus": base.get("qc.overallStatus", ""), "qc.overallScore": base.get("qc.overallScore", ""),
                "errors": base.get("errors", "") or ("" if sor else "sorotipo não atribuído no passo 1"),
                "dataset": ds,
            })
    (SAIDA / "versoes.json").write_text(json.dumps(versoes, indent=2, ensure_ascii=False), encoding="utf-8")
    return saida


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
    ds_sor = os.environ.get("NEXTCLADE_DATASET_SOROTIPO")
    ds_lin = os.environ.get("NEXTCLADE_DATASET_LINHAGEM")
    if not ds_sor or not ds_lin or "{n}" not in ds_lin:
        raise SystemExit("Defina NEXTCLADE_DATASET_SOROTIPO e NEXTCLADE_DATASET_LINHAGEM (com {n}) "
                         "a partir de `python -m src.pipeline.classify listar`.")
    print(classificar(a.fasta, ds_sor, ds_lin))


if __name__ == "__main__":
    main()
