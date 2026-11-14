"""CLI: python -m src.ingest --fonte {ibge|infodengue|genbank|sinan|cnes|inmet|todas} [--agravo dengue|chikungunya|zika|todos]

sinan, cnes e inmet ficam fora de "todas" (D-020, D-021): rodam só quando pedidos.

Ao final gera docs/INGESTAO_RELATORIO.md com endpoint, data e hora do acesso,
número de registros e período coberto de cada fonte.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone

from . import demas, genbank, ibge, infodengue, inmet
from .comum import RAIZ


def main() -> None:
    ap = argparse.ArgumentParser(description="Ingestão VigiGen")
    ap.add_argument("--fonte", choices=["ibge", "infodengue", "genbank", "sinan", "cnes", "inmet", "todas"], required=True)
    ap.add_argument("--amostra", action="store_true",
                    help="InfoDengue: só uma chamada para Natal, para conferir os campos")
    ap.add_argument("--ano-inicio", type=int, default=2020)
    ap.add_argument("--agravo", choices=["dengue", "chikungunya", "zika", "todos"], default="dengue",
                    help="GenBank: qual vírus buscar (padrão: dengue)")
    ap.add_argument("--ano", type=int, help="SINAN e INMET: ano a buscar")
    ap.add_argument("--municipio6", nargs="+", default=["240810"],
                    help="SINAN: municípios de NOTIFICAÇÃO, 6 dígitos (padrão: Natal)")
    ap.add_argument("--banco", action="store_true",
                    help="INMET: também grava em public.bruto e normaliza (pede DATABASE_URL)")
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
    if a.fonte in ("sinan", "inmet") and not a.ano:
        ap.error("--ano é obrigatório para sinan e inmet")
    if a.fonte == "sinan":
        agravos = ["dengue", "chikungunya", "zika"] if a.agravo == "todos" else [a.agravo]
        resultados.append(demas.executar_sinan(a.ano, a.municipio6, agravos))
    if a.fonte == "cnes":
        resultados.append(demas.executar_cnes())
    if a.fonte == "inmet":
        resultados.append(inmet.executar(a.ano, banco=a.banco))
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
