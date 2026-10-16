"""Ponte entre o banco e o pipeline local/Actions.

  python -m src.db.load exportar-fasta  data/interim/seq.fasta
  python -m src.db.load carregar-nextclade data/interim/nextclade/classificacao.tsv

Precisa de DATABASE_URL (conexão Postgres do Supabase, papel com escrita em
classificacao e exclusao_qc). Nunca versionar a URL.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from src.pipeline.classify import SAIDA, ler_tsv
from src.pipeline.qc import avaliar


def conectar():
    import psycopg
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL não definido")
    return psycopg.connect(url)


def exportar_fasta(destino: Path) -> int:
    destino.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with conectar() as con, destino.open("w", encoding="utf-8") as f:
        for acc, seq in con.execute(
                "select accession, sequencia_fasta from public.sequencia where sequencia_fasta is not null order by accession"):
            corpo = seq if seq.startswith(">") else f">{acc}\n{seq}\n"
            f.write(corpo if corpo.endswith("\n") else corpo + "\n")
            n += 1
    return n


def carregar_nextclade(tsv: Path) -> dict:
    versoes = json.loads((SAIDA / "versoes.json").read_text(encoding="utf-8"))
    ok = excl = 0
    with conectar() as con:
        for linha in ler_tsv(tsv):
            acc = linha["seqName"].split()[0].split("|")[0]
            aprovada, motivo, detalhe = avaliar(linha)
            if not aprovada:
                # uma linha por sequência e motivo, para a rodada semanal não duplicar exclusões
                con.execute("""insert into public.exclusao_qc (accession, motivo, detalhe)
                               select %s, %s, %s where not exists (
                                 select 1 from public.exclusao_qc where accession = %s and motivo = %s)""",
                            (acc, motivo, detalhe, acc, motivo))
                excl += 1
                continue
            nome_ds, tag_ds = linha["dataset"].rsplit("@", 1)
            con.execute("""
                insert into public.classificacao (accession, sorotipo, genotipo, linhagem, cobertura, qc_status,
                                                  dataset_nome, dataset_tag, nextclade_versao)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (accession) do update set sorotipo = excluded.sorotipo, genotipo = excluded.genotipo,
                  linhagem = excluded.linhagem, cobertura = excluded.cobertura, qc_status = excluded.qc_status,
                  dataset_nome = excluded.dataset_nome, dataset_tag = excluded.dataset_tag,
                  nextclade_versao = excluded.nextclade_versao, classificado_em = now()""",
                (acc, linha.get("sorotipo") or None, linha.get("genotipo") or None,
                 linha.get("linhagem") or None, float(linha["coverage"]),
                 linha.get("qc.overallStatus") or None, nome_ds, tag_ds, versoes["nextclade_versao"]))
            ok += 1
        con.execute("insert into public.auditoria (ator, acao, entidade, detalhe) values (%s, %s, %s, %s)",
                    ("pipeline:nextclade", "classificacao", "classificacao",
                     json.dumps({"classificadas": ok, "excluidas": excl, **versoes})))
    return {"classificadas": ok, "excluidas": excl, **versoes}


if __name__ == "__main__":
    cmd, arq = sys.argv[1], Path(sys.argv[2])
    if cmd == "exportar-fasta":
        print(exportar_fasta(arq), "sequências")
    elif cmd == "carregar-nextclade":
        print(carregar_nextclade(arq))
    else:
        raise SystemExit("comandos: exportar-fasta | carregar-nextclade")
