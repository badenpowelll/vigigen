"""Ponte entre o banco e o pipeline local/Actions.

  python -m src.db.load exportar-fasta  data/interim/seq.fasta
  python -m src.db.load carregar-nextclade data/interim/nextclade/classificacao.tsv
  python -m src.db.load detectar-alertas  data/interim/deteccao.json

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


def detectar_alertas(relatorio: Path, inicio: str = "2020T1") -> dict:
    """Roda R1, R2 e R3 em cada município do RN e no estado, trimestre a trimestre,
    só sobre trimestres fechados e só com sequências aprovadas no QC (as que estão em
    classificacao). Cada alerta nasce "novo"; a mesma regra, território, período e
    linhagem não é gravada duas vezes. O relatório registra também o que NÃO pôde ser
    avaliado (trimestres abaixo do mínimo de sequências), para a ausência de alerta
    não ser lida como ausência de mudança."""
    from src.indicators.deteccao import (ESTADO, MIN_SEQUENCIAS, detectar, montar_contagens,
                                         parametros, trimestres_entre)
    with conectar() as con:
        fim = con.execute("select app.trimestre((date_trunc('quarter', current_date) - interval '1 day')::date)").fetchone()[0]
        linhas = con.execute("""
            select s.geocodigo, app.trimestre(s.data_coleta_inicio), coalesce(c.linhagem, c.genotipo, c.sorotipo)
            from public.classificacao c join public.sequencia s using (accession)
            where s.uf_inferida = 'RN' and s.data_coleta_inicio is not null
              and coalesce(c.linhagem, c.genotipo, c.sorotipo) is not null""").fetchall()
        contagens = montar_contagens(linhas)
        cobertura: dict = {}
        for geo, nivel, periodo, valor in con.execute("""
                select geocodigo, nivel, periodo, valor from public.indicador
                where tipo = 'cobertura_sequenciamento' and periodo like '____T_'"""):
            terr = ESTADO if nivel == "estado" else str(geo)
            cobertura[(terr, periodo)] = float(valor) if valor is not None else None
        municipios = [str(g) for (g,) in con.execute("select geocodigo from public.municipio")]
        periodos = trimestres_entre(inicio, fim)
        gravados = repetidos = 0
        abaixo_minimo = 0
        for terr in municipios + [ESTADO]:
            for p in periodos:
                if sum(contagens.get((terr, p), {}).values()) < MIN_SEQUENCIAS:
                    abaixo_minimo += 1
                for a in detectar(contagens, cobertura, terr, p):
                    geo = None if terr == ESTADO else int(terr)
                    ev = {**a.evidencia, "parametros": parametros(), "territorio": terr}
                    cur = con.execute("""
                        insert into public.alerta (geocodigo, tipo, periodo_deteccao, evidencia)
                        select %s, %s, %s, %s::jsonb where not exists (
                          select 1 from public.alerta where geocodigo is not distinct from %s and tipo = %s
                            and periodo_deteccao = %s
                            and coalesce(evidencia->>'linhagem', '') = coalesce(%s, ''))""",
                        (geo, a.regra, a.periodo, json.dumps(ev), geo, a.regra, a.periodo,
                         a.evidencia.get("linhagem")))
                    if cur.rowcount:
                        gravados += 1
                    else:
                        repetidos += 1
        resumo = {"periodos": [periodos[0], periodos[-1]], "territorios": len(municipios) + 1,
                  "sequencias_rn_classificadas": len(linhas),
                  "pares_territorio_trimestre": (len(municipios) + 1) * len(periodos),
                  "pares_abaixo_do_minimo": abaixo_minimo,
                  "alertas_gravados": gravados, "alertas_ja_existentes": repetidos,
                  "parametros": parametros()}
        con.execute("insert into public.auditoria (ator, acao, entidade, detalhe) values (%s, %s, %s, %s)",
                    ("pipeline:deteccao", "deteccao", "alerta", json.dumps(resumo)))
    relatorio.parent.mkdir(parents=True, exist_ok=True)
    relatorio.write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8")
    return resumo


if __name__ == "__main__":
    cmd, arq = sys.argv[1], Path(sys.argv[2])
    if cmd == "exportar-fasta":
        print(exportar_fasta(arq), "sequências")
    elif cmd == "carregar-nextclade":
        print(carregar_nextclade(arq))
    elif cmd == "detectar-alertas":
        print(detectar_alertas(arq))
    else:
        raise SystemExit("comandos: exportar-fasta | carregar-nextclade | detectar-alertas")
