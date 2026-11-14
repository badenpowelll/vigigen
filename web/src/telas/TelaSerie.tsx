import { useEffect, useMemo, useState } from "react";
import type { Ctx } from "./ctx";
import type { Doenca, Serie } from "../dados/tipos";
import { DOENCAS } from "../dados/tipos";
import { Alternador, Nota, Secao } from "../componentes/basicos";
import { BarrasComposicao, GraficoLinhas } from "../componentes/Graficos";
import { COR_DOENCA, COR_SOROTIPO, DOENCA_ROTULO, SOROTIPOS, fmtNum, fmtPct } from "../util";
import { SIGLA_VIRUS, genomicaDe, motivoSemGenomica } from "../dados/calc";

export function TelaSerie({ dados, g, nomeSel, doenca }: Ctx) {
  const [medida, setMedida] = useState<"c" | "i">("c");
  const [desde, setDesde] = useState<"2020" | "2024">("2020");
  const [series, setSeries] = useState<Partial<Record<Doenca, Serie | null>>>({});

  useEffect(() => {
    let vivo = true;
    if (g === null) { setSeries(dados.serieEstado); return; }
    setSeries({});
    Promise.all(DOENCAS.map((d) => dados.serieMunicipio(g, d))).then((r) => {
      if (vivo) setSeries(Object.fromEntries(DOENCAS.map((d, k) => [d, r[k]])));
    });
    return () => { vivo = false; };
  }, [g, dados.serieEstado, dados.serieMunicipio]);

  const dominio: [Date, Date] = useMemo(() => [new Date(Date.UTC(Number(desde), 0, 1)), new Date()], [desde]);
  const linhas = DOENCAS.filter((d) => series[d]).map((d) => {
    const s = series[d]!;
    return { nome: DOENCA_ROTULO[d], cor: COR_DOENCA[d], pontos: s.se.map((_, k) => ({ t: new Date(s.dt[k]), v: s[medida][k] })) };
  });
  const gen = genomicaDe(dados.resumo, doenca);
  const agr = DOENCA_ROTULO[doenca].toLowerCase();
  const comp = gen.r?.composicao_brasil ?? [];
  const gb = gen.estado === "ok" ? gen.r?.genbank : undefined;
  const porAno = gen.r?.por_ano_brasil ?? [];
  const anos = porAno.map((x) => x.a).sort((a, b) => a - b);
  const comData = porAno.reduce((t, x) => t + x.n, 0);
  const comEstado = gb ? gb.total - gb.brasil_sem_estado - gb.sem_geo : 0;
  const semSoro = gb?.por_sorotipo?.["não declarado"] ?? 0;
  const totRN = gb?.rn ?? 0;
  const anosRecentes = porAno.filter((x) => x.a >= 2010).sort((a, b) => b.a - a.a);

  return (
    <div className="flex flex-col gap-4">
      <Secao titulo={`Arboviroses em ${nomeSel}`} subtitulo="Casos notificados por semana epidemiológica · InfoDengue"
        acoes={<>
          <Alternador rotulo="Medida" valor={medida} aoMudar={setMedida} opcoes={[{ v: "c", r: "Casos" }, { v: "i", r: "Por 100 mil" }]} />
          <Alternador rotulo="Período" valor={desde} aoMudar={setDesde} opcoes={[{ v: "2020", r: "Desde 2020" }, { v: "2024", r: "Desde 2024" }]} />
        </>}>
        {linhas.length > 0 && linhas.length < DOENCAS.length && (
          <div className="mb-3"><Nota>
            Neste retrato embutido só a série de {DOENCAS.filter((d) => series[d]).map((d) => DOENCA_ROTULO[d]).join(", ")} de {nomeSel} vem junto.
            As de {DOENCAS.filter((d) => !series[d]).map((d) => DOENCA_ROTULO[d]).join(" e ")} aparecem com o dado ao vivo, ou escolha "Rio Grande do Norte".
          </Nota></div>
        )}
        {linhas.length ? (
          <GraficoLinhas series={linhas} dominio={dominio} unidade={medida === "c" ? "casos por semana" : "casos por 100 mil hab. por semana"}
            titulo={`Série semanal de dengue, chikungunya e Zika em ${nomeSel}`} altura={280} />
        ) : (
          <Nota>{g !== null && dados.origem === "retrato"
            ? "A série deste município aparece com o dado ao vivo. O retrato embutido traz apenas a série do estado; escolha \"Rio Grande do Norte\" no seletor."
            : "Carregando séries…"}</Nota>
        )}
      </Secao>

      {doenca !== "dengue" ? (
      <Secao titulo={`Sequências de ${agr} (${SIGLA_VIRUS[doenca]}) do Brasil no GenBank, por ano de coleta`}
        subtitulo="Contagem de sequências depositadas. Chikungunya e Zika não têm sorotipos como a dengue; genótipo e linhagem dependem de classificação ainda não definida.">
        {gen.estado !== "ok" ? <Nota tipo="aviso">{motivoSemGenomica(doenca, gen.estado)}</Nota> : (
          <>
            <div className="mb-3"><Nota>Os números representam as sequências disponíveis no GenBank, não a circulação do vírus na população.</Nota></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left"><th className="py-1 pr-3">Ano de coleta</th><th className="py-1 pr-3 text-right">Sequências do Brasil</th><th className="py-1 text-right">Do RN</th></tr></thead>
                <tbody>
                  {anosRecentes.map((x) => (
                    <tr key={x.a} className="border-t border-borda">
                      <td className="num py-1 pr-3">{x.a}</td><td className="num py-1 pr-3 text-right">{fmtNum(x.n)}</td><td className="num py-1 text-right">{fmtNum(x.rn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {gb && <p className="mt-2 text-xs text-suave">{fmtNum(gb.total)} sequências no total; {fmtNum(gb.total - comData)} sem data de coleta; {fmtNum(gb.rn)} do RN. Fonte: NCBI GenBank, termo {gb.termo}.</p>}
          </>
        )}
      </Secao>
      ) : (
      <Secao titulo="Distribuição dos sorotipos informados nos metadados das sequências brasileiras"
        subtitulo={<>Proporção por ano de coleta, no mesmo eixo de tempo da série acima. Escala <strong>Brasil</strong>: o RN tem só {totRN} sequência(s) com estado identificado no GenBank, poucas para uma composição anual.</>}>
        <div className="mb-3">
          <Nota>Os percentuais representam as sequências disponíveis e não a prevalência dos sorotipos na população brasileira.</Nota>
        </div>
        {comp.length ? (
          <BarrasComposicao dados={comp} categorias={SOROTIPOS} cores={COR_SOROTIPO} dominio={dominio}
            titulo="Distribuição anual dos sorotipos informados nos metadados das sequências brasileiras de dengue" />
        ) : <Nota>Sem dado para este período.</Nota>}
        {gb && (
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-[var(--raio)] border border-borda p-3">
              <dt className="rotulo">Período de coleta</dt>
              <dd className="num mt-1">
                {anos.length ? <>{anos[0]} a {anos[anos.length - 1]}: {fmtNum(comData)} sequências com ano de coleta</> : "sem ano de coleta"}
                <span className="block text-xs text-suave">{fmtNum(gb.total - comData)} sem data de coleta. A semana epidemiológica só é calculável quando a data tem dia, o que nem todo registro traz.</span>
              </dd>
            </div>
            <div className="rounded-[var(--raio)] border border-borda p-3">
              <dt className="rotulo">Local de origem</dt>
              <dd className="num mt-1">
                {fmtNum(comEstado)} com estado ({fmtPct(comEstado / gb.total)})
                <span className="block text-xs text-suave">{fmtNum(gb.brasil_sem_estado)} só com "Brazil"; {fmtNum(gb.sem_geo)} sem local; {fmtNum(gb.rn)} do RN.</span>
              </dd>
            </div>
            <div className="rounded-[var(--raio)] border border-borda p-3">
              <dt className="rotulo">Cobertura e qualidade</dt>
              <dd className="num mt-1">
                {fmtNum(gb.total)} sequências; {fmtPct(gb.genoma_quase_completo / gb.total)} com genoma quase completo
                <span className="block text-xs text-suave">{fmtPct(semSoro / gb.total)} sem sorotipo informado. Depósitos refletem onde e quando houve sequenciamento, não a circulação real.</span>
              </dd>
            </div>
          </dl>
        )}
        <p className="mt-2 text-xs text-suave">
          Sorotipo como informado pelo depositante no GenBank (campo serotype ou título), antes da classificação pelo Nextclade.
          "Não declarado" não é um sorotipo: é a parte que só a classificação vai resolver. Fonte: NCBI GenBank, termo {gb?.termo}.
        </p>
      </Secao>
      )}
    </div>
  );
}
