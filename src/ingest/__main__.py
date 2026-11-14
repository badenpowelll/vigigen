"""CLI: python -m src.ingest --fonte {ibge|infodengue|genbank|todas} [--agravo dengue|chikungunya|zika|todos]

Ao final gera docs/INGESTAO_RELATORIO.md com endpoint, data e hora do acesso,
número de registros e período coberto de cada fonte.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone

from . import genbank, ibge, infodengue
from .comum import RAIZ


def main() -> None:
    ap = argparse.ArgumentParser(description="Ingestão VigiGen")
    ap.add_argument("--fonte", choices=["ibge", "infodengue", "genbank", "todas"], required=True)
    ap.add_argument("--amostra", action="store_true",
                    help="InfoDengue: só uma chamada para Natal, para conferir os campos")
    ap.add_argument("--ano-inicio", type=int, default=2020)
    ap.add_argument("--agravo", choices=["dengue", "chikungunya", "zika", "todos"], default="dengue",
                    help="GenBank: qual vírus buscar (padrão: dengue)")
    a = ap.parse_args()

    if a.amostra:
        print(json.dumps(infodengue.amostra(), ensure_ascii=False, indent=2, default=str))
        return

    resultados = []
    if a.fonte in ("ibge", "todas"):
        resultados.append(ibge.executar())
    if a.fonte in ("infodengue", "todas"):
        resultados.append(infodengue.executar(a.ano_inicio))
    if a.fonte in ("genbank", "todas"):
        agravos = ["dengue", "chikungunya", "zika"] if a.agravo == "todos" else [a.agravo]
        resultados += [genbank.executar(x) for x in agravos]
    relatorio(resultados)


def relatorio(resultados: list[dict]) -> None:
    linhas = ["# Relatório de ingestão (CLI local)", "",
              f"Gerado em {datetime.now(timezone.utc):%Y-%m-%d %H:%M UTC}.", ""]
    for r in resultados:
        linhas += [f"## {r['fonte']}", "", "```json",
                   json.dumps(r, ensure_ascii=False, indent=2, default=str), "```", ""]
    (RAIZ / "docs" / "INGESTAO_RELATORIO_LOCAL.md").write_text("\n".join(linhas), encoding="utf-8")
    print("\n".join(linhas))


if __name__ == "__main__":
    main()
