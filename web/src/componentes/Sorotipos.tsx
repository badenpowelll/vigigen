import { useMemo, useState } from "react";
import type { SequenciaRN } from "../dados/tipos";
import { Alternador, Nota } from "./basicos";
import { COR_SOROTIPO, SOROTIPOS, fmtNum, fmtPct } from "../util";

/** Abaixo disto o ano tem poucas sequências para ler proporção (regra de exibição, não teste estatístico). */
export const MIN_SEQ_ANO = 30;
const DECLARADOS = SOROTIPOS.filter((s) => s !== "não declarado");

export interface LinhaAno { a: number; n: number; por: Record<string, number>; pequeno: boolean; dominante: string | null }

/** Tabela ano × sorotipo a partir de composicao_brasil ({a, s, n}). Anos em ordem decrescente. */
export function tabelaSorotipos(comp: { a: number; s: string; n: number }[], desde: number | null): LinhaAno[] {
  const m = new Map<number, Record<string, number>>();
  for (const x of comp) {
    if (desde !== null && x.a < desde) continue;
    const r = m.get(x.a) ?? {};
    r[x.s] = (r[x.s] ?? 0) + x.n;
    m.set(x.a, r);
  }
  return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([a, por]) => {
    const n = Object.values(por).reduce((t, v) => t + v, 0);
    let dominante: string | null = null;
    for (const s of DECLARADOS) if ((por[s] ?? 0) > 0 && (dominante === null || por[s] > por[dominante])) dominante = s;
    return { a, n, por, pequeno: n < MIN_SEQ_ANO, dominante };
  });
}

export interface Destaques {
  ultimo: LinhaAno | null;
  trocas: { a: number; de: string; para: string }[];
  denv3: { a: number; p: number; n: number; tot: number }[];
  picoDenv3: { a: number; p: number; n: number; tot: number } | null;
}

/** Fatos lidos da tabela, só nos anos com amostra suficiente. Nada é estimado. */
export function destaquesSorotipos(linhas: LinhaAno[]): Destaques {
  const ok = linhas.filter((l) => !l.pequeno).slice().sort((a, b) => a.a - b.a);
  const trocas: Destaques["trocas"] = [];
  for (let k = 1; k < ok.length; k++) {
    const de = ok[k - 1].dominante, para = ok[k].dominante;
    if (de && para && de !== para) trocas.push({ a: ok[k].a, de, para });
  }
  const denv3 = ok.map((l) => ({ a: l.a, n: l.por["DENV-3"] ?? 0, tot: l.n, p: (l.por["DENV-3"] ?? 0) / l.n }));
  const picoDenv3 = denv3.filter((x) => x.n > 0).reduce<Destaques["picoDenv3"]>((m, x) => (!m || x.p > m.p ? x : m), null);
  return { ultimo: ok.length ? ok[ok.length - 1] : null, trocas, denv3, picoDenv3 };
}

function Quadrado({ s }: { s: string }) {
  return <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: COR_SOROTIPO[s] }} />;
}

/** Leitura detalhada da composição por sorotipo: destaques, tabela ano a ano e as sequências do RN. */
export function DetalheSorotipos({ comp, totais, seqRN }: {
  comp: { a: number; s: string; n: number }[]; totais: Record<string, number> | undefined; seqRN: SequenciaRN[];
}) {
  const [desde, setDesde] = useState<"2015" | "todos">("2015");
  const [ver, setVer] = useState<"pct" | "n">("pct");
  const linhas = useMemo(() => tabelaSorotipos(comp, desde === "todos" ? null : Number(desde)), [comp, desde]);
  const d = useMemo(() => destaquesSorotipos(tabelaSorotipos(comp, 2015)), [comp]);
  const totGeral = totais ? Object.values(totais).reduce((t, v) => t + v, 0) : 0;
  const rnPorGeo = seqRN.filter((s) => !s.por_nome).length;
  const anoRN = seqRN.map((s) => Number((s.coleta ?? "").slice(-4))).filter((a) => a > 1900);
  const ultAnoRN = anoRN.length ? Math.max(...anoRN) : null;

  return (
    <div className="mt-5 flex flex-col gap-5">
      <div>
        <h3 className="mb-2 text-base font-bold">Leitura rápida, desde 2015</h3>
        <ul className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
          <li className="cartao p-3">
            <p className="rotulo">Predominante no ano mais recente com amostra</p>
            {d.ultimo && d.ultimo.dominante ? (
              <p className="mt-1"><span className="inline-flex items-center gap-1.5 text-lg font-bold"><Quadrado s={d.ultimo.dominante} />{d.ultimo.dominante}</span>{" "}
                em {d.ultimo.a}: {fmtPct((d.ultimo.por[d.ultimo.dominante] ?? 0) / d.ultimo.n)} ({fmtNum(d.ultimo.por[d.ultimo.dominante])} de {fmtNum(d.ultimo.n)} sequências).</p>
            ) : <p className="mt-1 text-suave">Nenhum ano com {MIN_SEQ_ANO} sequências ou mais.</p>}
          </li>
          <li className="cartao p-3">
            <p className="rotulo">DENV-3 nas sequências depositadas</p>
            {d.picoDenv3 ? (
              <>
                <p className="mt-1">Maior proporção em <strong>{d.picoDenv3.a}</strong>: <strong>{fmtPct(d.picoDenv3.p)}</strong> ({fmtNum(d.picoDenv3.n)} de {fmtNum(d.picoDenv3.tot)}).</p>
                <p className="num mt-1 text-xs text-suave">{d.denv3.map((x) => `${x.a}: ${fmtPct(x.p)}`).join(" · ")}</p>
              </>
            ) : <p className="mt-1 text-suave">Sem DENV-3 nos anos com amostra.</p>}
          </li>
          <li className="cartao p-3">
            <p className="rotulo">Troca do sorotipo predominante</p>
            {d.trocas.length ? (
              <ul className="mt-1 flex flex-col gap-0.5">
                {d.trocas.map((t) => <li key={t.a}><strong>{t.a}</strong>: {t.de} → {t.para}</li>)}
              </ul>
            ) : <p className="mt-1 text-suave">Sem troca entre os anos com amostra.</p>}
          </li>
        </ul>
        <p className="mt-2 text-xs text-suave">
          Só entram anos com {MIN_SEQ_ANO} sequências ou mais. Uma troca nas sequências pode refletir onde e quando se sequenciou, não só a circulação do vírus.
        </p>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-end gap-3">
          <h3 className="mr-auto text-base font-bold">Sequências por ano de coleta e sorotipo</h3>
          <Alternador rotulo="Anos" valor={desde} aoMudar={setDesde} opcoes={[{ v: "2015", r: "Desde 2015" }, { v: "todos", r: "Todos" }]} />
          <Alternador rotulo="Mostrar" valor={ver} aoMudar={setVer} opcoes={[{ v: "pct", r: "Percentual" }, { v: "n", r: "Contagem" }]} />
        </div>
        <div className="max-h-[28rem] overflow-auto rounded-[var(--raio)] border border-borda" tabIndex={0} role="region"
          aria-label="Tabela de sequências por ano de coleta e sorotipo, com rolagem">
          <table className="tabela-relatorio w-full text-sm">
            <caption className="sr-only">Sequências brasileiras de dengue no GenBank por ano de coleta e sorotipo informado</caption>
            <thead className="sticky top-0 bg-superficie">
              <tr>
                <th scope="col" className="text-left">Ano</th>
                <th scope="col" className="text-right">Sequências</th>
                {SOROTIPOS.map((s) => <th key={s} scope="col" className="text-right"><span className="inline-flex items-center gap-1"><Quadrado s={s} />{s}</span></th>)}
                <th scope="col" className="text-left">Predominante</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.a}>
                  <th scope="row" className="text-left font-normal">{l.a}</th>
                  <td className="num text-right">{fmtNum(l.n)}{l.pequeno && <span className="block text-xs text-suave">amostra pequena</span>}</td>
                  {SOROTIPOS.map((s) => {
                    const v = l.por[s] ?? 0;
                    return <td key={s} className={`num text-right ${v === 0 ? "text-suave" : ""} ${s === l.dominante && !l.pequeno ? "font-bold" : ""}`}>
                      {ver === "n" ? fmtNum(v) : fmtPct(v / l.n)}
                    </td>;
                  })}
                  <td>{l.dominante ? <span className="inline-flex items-center gap-1"><Quadrado s={l.dominante} />{l.dominante}{l.pequeno ? <span className="text-suave"> (n pequeno)</span> : null}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
            {totais && desde === "todos" && (
              <tfoot>
                <tr className="font-semibold">
                  <th scope="row" className="text-left">Total</th>
                  <td className="num text-right">{fmtNum(totGeral)}</td>
                  {SOROTIPOS.map((s) => <td key={s} className="num text-right">{ver === "n" ? fmtNum(totais[s] ?? 0) : fmtPct((totais[s] ?? 0) / totGeral)}</td>)}
                  <td className="text-xs font-normal text-suave">inclui as sem ano de coleta</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="mt-1 text-xs text-suave">
          Em negrito, o sorotipo predominante de cada ano. "Amostra pequena" = menos de {MIN_SEQ_ANO} sequências no ano; a proporção desses anos não deve ser lida como tendência.
        </p>
      </div>

      <div>
        <h3 className="mb-2 text-base font-bold">As sequências de dengue ligadas ao RN</h3>
        <Nota>
          {rnPorGeo} sequência(s) trazem o RN no campo de origem e {seqRN.length - rnPorGeo} só no nome da cepa (por exemplo "/RN/97").{" "}
          {ultAnoRN ? `A coleta mais recente é de ${ultAnoRN}. ` : ""}É pouco para qualquer composição anual do estado; por isso a distribuição acima é do Brasil.
        </Nota>
        <div className="mt-2 overflow-x-auto rounded-[var(--raio)] border border-borda" tabIndex={0} role="region" aria-label="Sequências do RN">
          <table className="tabela-relatorio w-full text-sm">
            <caption className="sr-only">Sequências de dengue do RN no GenBank</caption>
            <thead><tr><th scope="col" className="text-left">Acesso</th><th scope="col" className="text-left">Sorotipo</th><th scope="col" className="text-left">Coleta</th>
              <th scope="col" className="text-left">Depósito</th><th scope="col" className="text-right">Tamanho</th><th scope="col" className="text-left">Como sabemos que é do RN</th></tr></thead>
            <tbody>
              {seqRN.slice().sort((a, b) => (b.coleta ?? "").slice(-4).localeCompare((a.coleta ?? "").slice(-4))).map((s) => (
                <tr key={s.acc}>
                  <th scope="row" className="text-left font-normal">
                    <a className="underline" href={`https://www.ncbi.nlm.nih.gov/nuccore/${s.acc}`} target="_blank" rel="noreferrer">{s.acc}</a>
                  </th>
                  <td>{s.soro ?? "não declarado"}</td>
                  <td className="num">{s.coleta ?? <span className="text-suave">sem data</span>}</td>
                  <td className="num">{s.pub ?? "—"}</td>
                  <td className="num text-right">{fmtNum(s.nt)} nt</td>
                  <td>{s.por_nome ? "nome da cepa" : `origem: ${s.geo}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">Como ler esta distribuição</summary>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          <li>Cada barra e cada linha da tabela contam <strong>sequências depositadas</strong> no GenBank, não casos. Um laboratório que sequencia muito num ano pesa mais nesse ano.</li>
          <li>O sorotipo é o que o depositante declarou (campo serotype ou título). A classificação pelo Nextclade ainda vai conferir isso.</li>
          <li>Anos recentes têm poucas sequências porque o depósito leva centenas de dias depois da coleta (mediana de 519 a 725 dias em 2023 e 2024).</li>
          <li>Para a vigilância, o sinal que interessa é a <strong>mudança</strong>: um sorotipo que volta a aparecer, como o DENV-3, é o tipo de evento que a detecção proposta no doutorado vai acompanhar por território.</li>
        </ul>
      </details>
    </div>
  );
}
