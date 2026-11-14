import { useMemo, useState } from "react";
import type { Serie } from "../dados/tipos";
import { GraficoLinhas } from "./Graficos";
import { Nota } from "./basicos";
import { fmtDia } from "./HistoricoMunicipio";
import { fmtNum, fmtSE } from "../util";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DIA = 86400000;

/** Início e fim (inclusive, em UTC) do recorte escolhido; null = sem recorte. */
export function intervaloDoFiltro(f: { ano: string; mes: string; de: string; ate: string }): [Date, Date] | null {
  if (f.de || f.ate) {
    const ini = f.de ? new Date(`${f.de}T00:00:00Z`) : new Date(Date.UTC(2020, 0, 1));
    const fim = f.ate ? new Date(`${f.ate}T00:00:00Z`) : new Date(Date.UTC(2100, 0, 1));
    return ini <= fim ? [ini, fim] : [fim, ini];
  }
  if (!f.ano) return null;
  const a = Number(f.ano);
  if (!f.mes) return [new Date(Date.UTC(a, 0, 1)), new Date(Date.UTC(a, 11, 31))];
  const m = Number(f.mes);
  return [new Date(Date.UTC(a, m, 1)), new Date(Date.UTC(a, m + 1, 0))];
}

/** Índices das semanas (domingo a sábado) que têm ao menos um dia dentro do recorte. */
export function semanasNoRecorte(s: Serie, r: [Date, Date] | null): number[] {
  return s.se.map((_, k) => k).filter((k) => {
    if (!r) return true;
    const ini = new Date(`${s.dt[k].slice(0, 10)}T00:00:00Z`).getTime();
    return ini <= r[1].getTime() && ini + 6 * DIA >= r[0].getTime();
  });
}

/** Série semanal com filtro por ano, mês ou intervalo de datas, e a tabela das semanas do recorte. */
export function SerieFiltrada({ serie, cor, nome, doencaRotulo }: { serie: Serie; cor: string; nome: string; doencaRotulo: string }) {
  const [f, setF] = useState({ ano: "", mes: "", de: "", ate: "" });
  const anos = useMemo(() => [...new Set(serie.se.map((x) => String(x).slice(0, 4)))].sort().reverse(), [serie]);
  const r = intervaloDoFiltro(f);
  const ks = useMemo(() => semanasNoRecorte(serie, r), [serie, r?.[0].getTime(), r?.[1].getTime()]);
  const ultima = serie.se.length ? serie.se.length - 1 : -1;

  const dominio: [Date, Date] = ks.length
    ? [new Date(`${serie.dt[ks[0]].slice(0, 10)}T00:00:00Z`), new Date(new Date(`${serie.dt[ks[ks.length - 1]].slice(0, 10)}T00:00:00Z`).getTime() + 6 * DIA)]
    : [new Date(Date.UTC(2020, 0, 1)), new Date()];
  const linhas = [
    { nome: "Casos notificados", cor, pontos: ks.map((k) => ({ t: new Date(serie.dt[k]), v: serie.c[k] })) },
    { nome: "Casos estimados (nowcasting)", cor: "var(--texto-suave)", tracejado: true, pontos: ks.map((k) => ({ t: new Date(serie.dt[k]), v: serie.ce[k] })) },
  ];
  const total = ks.reduce((t, k) => t + (serie.c[k] ?? 0), 0);
  const recorte = f.de || f.ate ? `de ${f.de ? fmtDia(f.de) : "2020"} até ${f.ate ? fmtDia(f.ate) : "hoje"}`
    : f.ano ? (f.mes ? `${MESES[Number(f.mes)]} de ${f.ano}` : `${f.ano}`) : "desde 2020";
  const limpar = () => setF({ ano: "", mes: "", de: "", ate: "" });

  return (
    <div>
      <fieldset className="mb-3">
        <legend className="br-rotulo mb-1">Filtrar período</legend>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-suave">Ano</span>
            <select className="br-campo" value={f.ano} onChange={(e) => setF({ ano: e.target.value, mes: e.target.value ? f.mes : "", de: "", ate: "" })}>
              <option value="">Todos</option>
              {anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-suave">Mês</span>
            <select className="br-campo" value={f.mes} disabled={!f.ano} onChange={(e) => setF({ ...f, mes: e.target.value, de: "", ate: "" })}>
              <option value="">Todos</option>
              {MESES.map((m, i) => <option key={m} value={String(i)}>{m}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-suave">De</span>
            <input type="date" className="br-campo texto" value={f.de} min="2020-01-01" onChange={(e) => setF({ ano: "", mes: "", de: e.target.value, ate: f.ate })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-suave">Até</span>
            <input type="date" className="br-campo texto" value={f.ate} min="2020-01-01" onChange={(e) => setF({ ano: "", mes: "", de: f.de, ate: e.target.value })} />
          </label>
          <button type="button" className="br-button secondary small" onClick={limpar} disabled={!f.ano && !f.de && !f.ate}>Limpar</button>
        </div>
      </fieldset>

      <p className="mb-2 text-sm" aria-live="polite">
        <strong>{doencaRotulo} em {nome}, {recorte}:</strong>{" "}
        {ks.length ? `${ks.length} semana(s) epidemiológica(s), ${fmtNum(total)} caso(s) notificado(s).`
          : `nenhuma semana publicada nesse recorte. A última semana publicada é a ${fmtSE(serie.se[ultima])} (${fmtDia(serie.dt[ultima])} a ${fmtDia(serie.dt[ultima], 6)}).`}
      </p>

      {ks.length > 0 && <GraficoLinhas series={linhas} dominio={dominio} unidade="casos por semana" titulo={`Casos semanais de ${doencaRotulo} em ${nome}, ${recorte}`} altura={260} />}
      <p className="mt-2 text-xs text-suave">A linha tracejada é a estimativa do InfoDengue que corrige o atraso de notificação nas semanas recentes.</p>

      {(f.ano || f.de || f.ate) && ks.length > 0 && (
        <div className="mt-3 max-h-80 overflow-auto rounded-[var(--raio)] border border-borda" tabIndex={0} role="region"
          aria-label={`Semanas de ${doencaRotulo} em ${nome}, ${recorte}, com rolagem`}>
          <table className="tabela-relatorio w-full text-sm">
            <caption className="sr-only">Casos de {doencaRotulo} em {nome} por semana epidemiológica, {recorte}</caption>
            <thead className="sticky top-0 bg-superficie">
              <tr><th scope="col" className="text-left">Semana</th><th scope="col" className="text-left">Domingo a sábado</th>
                <th scope="col" className="text-right"><abbr title="Casos notificados">Notif.</abbr></th><th scope="col" className="text-right"><abbr title="Casos estimados pelo InfoDengue">Estim.</abbr></th></tr>
            </thead>
            <tbody>
              {ks.map((k) => (
                <tr key={serie.se[k]}>
                  <th scope="row" className="text-left font-normal">{fmtSE(serie.se[k])}</th>
                  <td className="whitespace-nowrap">{fmtDia(serie.dt[k]).slice(0, 5)} a {fmtDia(serie.dt[k], 6)}</td>
                  <td className="num text-right">{serie.c[k] === null ? <span className="text-suave">sem registro</span> : fmtNum(serie.c[k])}</td>
                  <td className="num text-right">{serie.ce[k] === null ? "—" : fmtNum(serie.ce[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3"><Nota>
        <strong>Casos por dia dependem dos microdados do SINAN (convênio); as fontes públicas publicam por semana.</strong>{" "}
        Por isso o recorte mostra as semanas epidemiológicas que caem no período, com os casos de cada semana inteira. Nenhum valor diário é estimado ou dividido.
      </Nota></div>
    </div>
  );
}
