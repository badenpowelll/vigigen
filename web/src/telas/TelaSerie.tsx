import { useEffect, useMemo, useState } from "react";
import type { Ctx } from "./ctx";
import type { Doenca, Serie } from "../dados/tipos";
import { DOENCAS } from "../dados/tipos";
import { Alternador, Nota, Secao } from "../componentes/basicos";
import { BarrasComposicao, GraficoLinhas } from "../componentes/Graficos";
import { COR_DOENCA, COR_SOROTIPO, DOENCA_ROTULO, SOROTIPOS, fmtNum } from "../util";

export function TelaSerie({ dados, g, nomeSel }: Ctx) {
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
  const comp = dados.resumo?.composicao_brasil ?? [];
  const totRN = dados.resumo?.genbank.rn ?? 0;

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

      <Secao titulo="Sorotipos declarados nas sequências do Brasil"
        subtitulo={<>Proporção por ano de coleta, no mesmo eixo de tempo da série acima. Escala <strong>Brasil</strong>: o RN tem só {totRN} sequência(s) com estado identificado no GenBank, poucas para uma composição anual.</>}>
        {comp.length ? (
          <BarrasComposicao dados={comp} categorias={SOROTIPOS} cores={COR_SOROTIPO} dominio={dominio}
            titulo="Composição anual de sorotipos declarados nas sequências de dengue do Brasil" />
        ) : <Nota>Sem dado para este período.</Nota>}
        <p className="mt-2 text-xs text-suave">
          Sorotipo como declarado pelo depositante no GenBank (campo serotype ou título), antes da classificação pelo Nextclade.
          "Não declarado" não é um sorotipo: é a parte que só a classificação vai resolver. Total na base: {fmtNum(dados.resumo?.genbank.total)} sequências.
        </p>
      </Secao>
    </div>
  );
}
