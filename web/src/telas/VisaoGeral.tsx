import { useMemo } from "react";
import type { Ctx } from "./ctx";
import { FONTE_GENBANK, FONTE_INFODENGUE } from "./ctx";
import { KpiCard, Secao, StatusBadge, IconeNivel, Nota, type Nivel } from "../componentes/basicos";
import { Mapa, limitesQuantis, type ValorMapa } from "../componentes/Mapa";
import { GraficoLinhas } from "../componentes/Graficos";
import { ListaMunicipios } from "../componentes/ListaMunicipios";
import { agregarEstado, atualidadeSerie, coberturaMunicipio, estadoDeteccao, genomicaDe, posicao, ultimos, valorNaSE } from "../dados/calc";
import { ult12Retrato } from "../dados/useDados";
import { DOENCA_ROTULO, COR_DOENCA, fmtData, fmtNum, fmtPct, fmtSE, fmtTrimestre } from "../util";

const MOTIVO_SEM_ALERTA: Record<string, string> = {
  sem_sequencias: "as sequências deste vírus ainda não foram ingeridas; sem elas não há detecção (isto não é zero)",
  aguardando_classificacao: "a classificação por Nextclade ainda não rodou para este vírus; sem ela não há detecção (isto não é zero)",
  qc_insuficiente: "nenhuma sequência passou no controle de qualidade; sem classificação não há detecção (isto não é zero)",
  deteccao_pendente: "há classificação, mas a detecção R1/R2/R3 ainda não tem execução registrada (isto não é zero)",
  concluida_sem_alertas: "", alertas_pendentes: "", alertas_revisados: "",
};

export function VisaoGeral({ dados, doenca, g, nomeSel, serieMun, setG, irPara }: Ctx) {
  const sem = dados.semana[doenca];
  const serie = g === null ? dados.serieEstado[doenca] : serieMun;
  const m = g !== null ? sem?.municipios.find((x) => x.g === g) : undefined;
  const est = agregarEstado(sem);
  const fonteInfo = { nome: FONTE_INFODENGUE, atualizado: `lido em ${fmtData(sem?.ingerido_em)}` };
  const periodo = fmtSE(sem?.se);
  const seMax = Math.max(0, ...Object.values(dados.semana).map((x) => x?.se ?? 0)) || null;

  const c = g === null ? est?.c ?? null : m?.c ?? null;
  const i = g === null ? est?.i ?? null : m?.i ?? null;
  const cAnt = valorNaSE(serie, sem?.se_anterior ?? null, "c");
  const spark = serie ? ultimos(serie.c, 12) : g !== null ? ult12Retrato(g, doenca) : null;
  const rank = g !== null ? posicao(sem, g, "i") : null;
  const gen = genomicaDe(dados.resumo, doenca);
  const cob = gen.estado === "ok" ? coberturaMunicipio(gen.r, g) : null;
  const r = dados.resumo!;
  // alertas e classificações filtrados por agravo E território (nunca o total global)
  const det = estadoDeteccao(r, doenca, g);
  const atual = atualidadeSerie(sem?.se);

  const valoresMapa = useMemo(() => {
    const mp = new Map<number, ValorMapa>();
    sem?.municipios.forEach((x) => mp.set(x.g, x.i === null ? { v: null, motivo: "sem registro nesta SE" } : { v: x.i, detalhe: `${fmtNum(x.c)} casos · Rt ${fmtNum(x.rt, 2)}` }));
    return mp;
  }, [sem]);
  const limites = useMemo(() => limitesQuantis([...valoresMapa.values()].map((v) => v.v ?? NaN)), [valoresMapa]);

  const dominio: [Date, Date] = useMemo(() => [new Date(Date.UTC(2020, 0, 1)), new Date()], []);
  const linhas = serie ? [
    { nome: "Casos notificados", cor: COR_DOENCA[doenca], pontos: serie.se.map((_, k) => ({ t: new Date(serie.dt[k]), v: serie.c[k] })) },
    { nome: "Casos estimados (nowcasting)", cor: "var(--texto-suave)", tracejado: true, pontos: serie.se.map((_, k) => ({ t: new Date(serie.dt[k]), v: serie.ce[k] })) },
  ] : [];

  return (
    <div className="flex flex-col gap-4">
      <h2 className="sr-only">Visão geral de {nomeSel}</h2>
      {(atual.estado === "atrasada" || atual.estado === "parada") && (
        <Nota tipo="aviso">
          {atual.estado === "parada" ? <strong>Série parada. </strong> : <strong>Série atrasada. </strong>}
          A última semana publicada pelo InfoDengue para {DOENCA_ROTULO[doenca]} no RN é a {fmtSE(sem?.se)}, {atual.semanas} semanas antes da semana corrente
          {seMax && sem?.se && sem.se < seMax ? ` (os outros agravos já chegam à ${fmtSE(seMax)})` : ""}.
          Os números abaixo são dessa última semana publicada, não da semana atual. A data de leitura do banco ({fmtData(sem?.ingerido_em)}) não torna o dado recente.
        </Nota>
      )}
      {atual.estado === "em_dia" && sem?.se && seMax && sem.se < seMax && (
        <Nota tipo="aviso">
          A última semana publicada pelo InfoDengue para {DOENCA_ROTULO[doenca]} no RN é a {fmtSE(sem.se)}; para os outros agravos já há a {fmtSE(seMax)}.
        </Nota>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {g !== null ? (
          <KpiCard titulo={`Nível de alerta · ${DOENCA_ROTULO[doenca]}`} periodo={periodo} fonte={fonteInfo}
            ajuda="Nível do InfoDengue: 1 Baixo, 2 Atenção (clima propício), 3 Alerta (transmissão sustentada), 4 Emergência (incidência alta)." 
            valor={m ? <StatusBadge nivel={(m.nv ?? null) as Nivel | null} grande /> : null}
            semDadoMotivo="o InfoDengue não publicou este município nesta semana" />
        ) : (
          <KpiCard titulo={`Municípios por nível · ${DOENCA_ROTULO[doenca]}`} periodo={periodo} fonte={fonteInfo}
            ajuda="Quantos dos 167 municípios do RN estão em cada nível do InfoDengue: 4 Emergência, 3 Alerta, 2 Atenção, 1 Baixo." 
            valor={est ? <span className="flex flex-wrap gap-x-3 gap-y-1 text-base font-semibold">
              {(["4", "3", "2", "1"] as const).map((k) => (
                <span key={k} className="inline-flex items-center gap-1"><IconeNivel nivel={Number(k) as Nivel} />{est.porNivel[k]}</span>
              ))}</span> : null}
            rodapeExtra={est ? `${est.porNivel["3"] + est.porNivel["4"]} de ${est.nMun} municípios em Alerta ou Emergência` : undefined}
            semDadoMotivo="nenhum município publicado nesta semana" />
        )}
        <KpiCard titulo="Casos notificados na semana" periodo={periodo} fonte={fonteInfo}
          ajuda="Casos notificados ao SINAN e publicados pelo InfoDengue para a última semana epidemiológica disponível. Semanas recentes ainda recebem notificações atrasadas."
          valor={c === null ? null : fmtNum(c)} serie={spark ?? undefined}
          variacao={c !== null && cAnt !== null ? { valor: c - cAnt, contra: fmtSE(sem?.se_anterior), maiorEhPior: true } : null}
          rodapeExtra={g !== null && m?.ce != null ? `estimado pelo InfoDengue: ${fmtNum(m.ce)}. A semana mais recente ainda recebe notificações atrasadas.` : g === null && est ? `${est.nComDado} municípios com registro` : undefined}
          semDadoMotivo="sem registro do InfoDengue nesta semana" />
        <KpiCard titulo="Incidência" periodo={periodo} fonte={fonteInfo} unidade="por 100 mil hab."
          ajuda="Casos notificados na semana divididos pela população do IBGE, por 100 mil habitantes. Permite comparar municípios de tamanhos diferentes."
          valor={i === null ? null : fmtNum(i, 1)}
          rodapeExtra={rank ? `${rank.pos}º maior entre ${rank.de} municípios do RN` : g === null && est ? `população coberta: ${fmtNum(est.pop)}` : undefined}
          semDadoMotivo="sem casos ou sem população para o cálculo" />
        <KpiCard titulo="Número de reprodução (Rt)" periodo={periodo} fonte={fonteInfo}
          ajuda="Estimado pelo InfoDengue. Acima de 1, cada caso gera em média mais de um novo caso: a transmissão está crescendo."
          valor={g === null ? null : m?.rt == null ? null : fmtNum(m.rt, 2)}
          semDadoMotivo={g === null ? "Rt é estimado por município; escolha um município" : "o InfoDengue não estimou Rt nesta semana"}
          rodapeExtra={m?.prt != null ? `probabilidade de Rt > 1: ${fmtPct(m.prt, 0)}` : undefined} />
        <KpiCard titulo="Sequências públicas por casos notificados"
          ajuda="Sequências do vírus depositadas no GenBank com município identificado, divididas pelos casos notificados no mesmo trimestre. Mede o que é público e identificável, não o sequenciamento feito pelos laboratórios." periodo={cob ? fmtTrimestre(cob.p) : "último trimestre"}
          fonte={{ nome: `${FONTE_GENBANK} + InfoDengue`, atualizado: "calculado pelo VigiGen" }}
          valor={cob && cob.v !== null ? fmtPct(cob.v, 2) : null}
          semDadoMotivo={cob ? cob.mot ?? undefined : gen.estado !== "ok" ? `sequências de ${DOENCA_ROTULO[doenca].toLowerCase()} ainda não ingeridas do GenBank` : "indicador ainda não calculado"}
          rodapeExtra={cob ? `${fmtNum(cob.num)} sequência(s) / ${fmtNum(cob.den)} casos de ${DOENCA_ROTULO[doenca].toLowerCase()}` : undefined} />
        <KpiCard titulo={`Alertas de mudança de linhagem · ${DOENCA_ROTULO[doenca]}`} periodo="Fase 1"
          ajuda="Alertas das regras R1 (linhagem inédita), R2 (aumento de proporção) e R3 (queda da razão sequências/casos). Só existem depois da classificação Nextclade e da execução da detecção, e todos passam por revisão humana."
          fonte={{ nome: "VigiGen (Nextclade)", atualizado: `${fmtNum(det.classificadas)} sequências de ${DOENCA_ROTULO[doenca].toLowerCase()} classificadas` }}
          valor={det.estado === "alertas_pendentes" || det.estado === "alertas_revisados" || det.estado === "concluida_sem_alertas" ? fmtNum(det.alertas.length) : null}
          semDadoMotivo={MOTIVO_SEM_ALERTA[det.estado]}
          rodapeExtra={<button type="button" className="br-button small" style={{ padding: "0 8px", marginLeft: "-8px" }} onClick={() => irPara("alertas")}>ver por quê</button>} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Secao titulo={`Incidência de ${DOENCA_ROTULO[doenca].toLowerCase()} por município`} subtitulo={`${periodo} · casos por 100 mil habitantes · clique para escolher`}>
          {dados.malha && sem ? (
            <Mapa malha={dados.malha} valores={valoresMapa} limites={limites} formatar={(v) => fmtNum(v, v < 10 ? 1 : 0)}
              unidade="por 100 mil" titulo={`Mapa de incidência de ${DOENCA_ROTULO[doenca]}, ${periodo}`} selecionado={g} aoSelecionar={setG} aoSelecionarEstado={() => setG(null)} />
          ) : <Nota>Sem dado para este período: malha ou semana não carregada.</Nota>}
        </Secao>
        <Secao titulo={`Série semanal · ${nomeSel}`} subtitulo={`${DOENCA_ROTULO[doenca]}, desde 2020`}>
          {serie ? <GraficoLinhas series={linhas} dominio={dominio} unidade="casos por semana" titulo={`Casos semanais de ${DOENCA_ROTULO[doenca]} em ${nomeSel}`} altura={300} />
            : <Nota>{g !== null && dados.origem === "retrato" ? "A série completa deste município só aparece com o dado ao vivo; o retrato embutido traz a série do estado e as últimas 12 semanas de cada município." : "Carregando série…"}</Nota>}
          <p className="mt-2 text-xs text-suave">A linha tracejada é a estimativa do InfoDengue que corrige o atraso de notificação nas semanas recentes.</p>
        </Secao>
      </div>

      {g === null && (
        <Secao id="lista-municipios" titulo={`Municípios do Rio Grande do Norte · ${DOENCA_ROTULO[doenca]}`}
          subtitulo={est ? `${periodo} · total do estado: ${fmtNum(est.c)} casos notificados e ${fmtNum(est.ce)} estimados pelo InfoDengue, em ${est.nComDado} de ${est.nMun} municípios com registro` : periodo}>
          {sem?.municipios.length
            ? <ListaMunicipios municipios={sem.municipios} periodo={periodo} aoSelecionar={setG} />
            : <Nota>Sem dado para este período: o InfoDengue não publicou municípios nesta semana.</Nota>}
        </Secao>
      )}
    </div>
  );
}
