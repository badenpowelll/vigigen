import type { Ctx } from "./ctx";
import { FONTE_GENBANK } from "./ctx";
import { KpiCard, Nota, Secao } from "../componentes/basicos";
import { COR_SOROTIPO, fmtData, fmtNum, fmtPct, fmtTrimestre } from "../util";

export function TelaQualidade({ dados }: Ctx) {
  const r = dados.resumo!;
  const gb = r.genbank;
  const fonteGb = { nome: FONTE_GENBANK, atualizado: `lido em ${fmtData(r.fontes?.genbank?.finalizado_em)}` };
  const oport = r.indicadores.filter((x) => x.t.startsWith("oportunidade_mediana_dias:") && x.nivel === "pais")
    .sort((a, b) => b.p.localeCompare(a.p));
  const anosOport = [...new Set(oport.map((x) => x.p))].slice(0, 6);
  const soros = [...new Set(oport.map((x) => x.t.split(":")[1]))].sort();
  const cobUF = r.indicadores.filter((x) => x.t === "cobertura_sequenciamento" && x.nivel === "estado" && /^\d{4}$/.test(x.p) && x.p >= "2020").sort((a, b) => b.p.localeCompare(a.p));
  const semMun = r.cobertura_municipal_trimestre.filter((x) => (x.num ?? 0) === 0 && (x.den ?? 0) > 0).length;
  const triCob = r.cobertura_municipal_trimestre[0]?.p;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard titulo="Sequências de dengue do Brasil" periodo="todo o histórico" fonte={fonteGb} valor={fmtNum(gb.total)}
          rodapeExtra={`termo: ${gb.termo}`} />
        <KpiCard titulo="Sem estado de origem" periodo="todo o histórico" fonte={fonteGb}
          valor={gb.total ? fmtPct(gb.brasil_sem_estado / gb.total) : null}
          rodapeExtra={`${fmtNum(gb.brasil_sem_estado)} com geo_loc só "Brazil"; ${fmtNum(gb.sem_geo)} sem geo_loc`} />
        <KpiCard titulo="Sequências do RN" periodo="todo o histórico" fonte={fonteGb} valor={fmtNum(gb.rn)}
          rodapeExtra={`+ ${gb.rn_por_nome_cepa} com "/RN/" no nome da cepa (contadas à parte)`} />
        <KpiCard titulo="Genoma quase completo" periodo="todo o histórico" fonte={fonteGb}
          valor={gb.total ? fmtPct(gb.genoma_quase_completo / gb.total) : null} rodapeExtra="≥ 9.000 nt; o restante são genes parciais (E, NS1, C-prM)" />
      </div>

      <Secao titulo="Oportunidade: dias entre a coleta e a publicação no GenBank" subtitulo="Mediana (P25–P75) por ano de coleta, sequências do Brasil com data de coleta exata">
        {oport.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th className="py-1 pr-3">Ano</th>{soros.map((s) => <th key={s} className="py-1 pr-3"><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COR_SOROTIPO[s] ?? "var(--texto-suave)" }} />{s}</th>)}</tr></thead>
              <tbody>
                {anosOport.map((a) => (
                  <tr key={a} className="border-t border-borda">
                    <td className="num py-1 pr-3 font-semibold">{a}</td>
                    {soros.map((s) => {
                      const x = oport.find((o) => o.p === a && o.t.endsWith(":" + s));
                      const d = x?.d as { p25?: number; p75?: number; n?: number } | undefined;
                      return <td key={s} className="num py-1 pr-3">{x && x.v !== null ? <>{fmtNum(x.v)} d <span className="text-suave">({fmtNum(d?.p25)}–{fmtNum(d?.p75)}; n={d?.n})</span></> : <span className="text-suave">sem dado</span>}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Nota>Sem dado para este período: o indicador ainda não foi calculado.</Nota>}
        <p className="mt-2 text-xs text-suave">Disponibilidade = data de criação do registro (create-date), que é quando a sequência ficou pública. Coletas com só o ano ou o mês ficam de fora para não inventar dia.</p>
      </Secao>

      <Secao titulo="Cobertura de sequenciamento no RN, por ano" subtitulo="Sequências do RN com coleta no ano ÷ casos notificados de dengue no RN">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="py-1 pr-3">Ano</th><th className="py-1 pr-3 text-right">Sequências</th><th className="py-1 pr-3 text-right">Casos</th><th className="py-1 text-right">Cobertura</th></tr></thead>
            <tbody>
              {cobUF.map((x) => (
                <tr key={x.p} className="border-t border-borda">
                  <td className="num py-1 pr-3">{x.p}</td><td className="num py-1 pr-3 text-right">{fmtNum(x.num)}</td>
                  <td className="num py-1 pr-3 text-right">{fmtNum(x.den)}</td>
                  <td className="num py-1 text-right">{x.v === null ? <span className="text-suave">sem dado ({x.mot})</span> : fmtPct(x.v, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-suave">No último trimestre fechado ({triCob ? fmtTrimestre(triCob) : "—"}), {semMun} município(s) com casos notificados não têm nenhuma sequência depositada no GenBank.</p>
      </Secao>

      <Secao titulo="Sequências do Rio Grande do Norte no GenBank" subtitulo="Todas as encontradas, com o texto de origem como foi depositado">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="py-1 pr-3">Accession</th><th className="py-1 pr-3">Sorotipo</th><th className="py-1 pr-3">Coleta</th><th className="py-1 pr-3">Origem declarada</th><th className="py-1 pr-3 text-right">nt</th><th className="py-1">Critério</th></tr></thead>
            <tbody>
              {r.sequencias_rn.map((s) => (
                <tr key={s.acc} className="border-t border-borda">
                  <td className="py-1 pr-3"><a className="font-mono text-destaque underline" href={`https://www.ncbi.nlm.nih.gov/nuccore/${s.acc}`} target="_blank" rel="noreferrer">{s.acc}</a></td>
                  <td className="py-1 pr-3">{s.soro ?? "não declarado"}</td>
                  <td className="num py-1 pr-3">{s.coleta ?? "—"}</td>
                  <td className="py-1 pr-3">{s.geo ?? "—"}</td>
                  <td className="num py-1 pr-3 text-right">{fmtNum(s.nt)}</td>
                  <td className="py-1">{s.por_nome ? "nome da cepa (/RN/)" : "geo_loc"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Secao>

      <Secao titulo="Exclusões no controle de qualidade">
        {Object.keys(r.exclusoes_qc).length
          ? <ul className="text-sm">{Object.entries(r.exclusoes_qc).map(([k, v]) => <li key={k}>{k}: {fmtNum(v)}</li>)}</ul>
          : <Nota>Sem dado para este período: o controle de qualidade roda junto com o Nextclade, que ainda não foi executado.</Nota>}
      </Secao>
    </div>
  );
}
