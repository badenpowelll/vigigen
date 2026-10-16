import { useMemo } from "react";
import type { Ctx } from "./ctx";
import { FONTE_GENBANK, FONTE_INFODENGUE } from "./ctx";
import { KpiCard, Secao, StatusBadge, IconeNivel, Nota, type Nivel } from "../componentes/basicos";
import { Mapa, limitesQuantis, type ValorMapa } from "../componentes/Mapa";
import { GraficoLinhas } from "../componentes/Graficos";
import { agregarEstado, coberturaMunicipio, posicao, ultimos, valorNaSE } from "../dados/calc";
import { ult12Retrato } from "../dados/useDados";
import { DOENCA_ROTULO, COR_DOENCA, fmtData, fmtNum, fmtPct, fmtSE, fmtTrimestre } from "../util";

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
  const cob = coberturaMunicipio(dados.resumo, g);
  const r = dados.resumo!;
  const alertasAqui = r.alertas.filter((a) => g === null || a.g === g);

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
      {sem?.se && seMax && sem.se < seMax && (
        <Nota tipo="aviso">
          A última semana publicada pelo InfoDengue para {DOENCA_ROTULO[doenca]} no RN é a {fmtSE(sem.se)}; para os outros agravos já há a {fmtSE(seMax)}.
          Os números abaixo são dessa última semana publicada, não da semana atual.
        </Nota>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {g !== null ? (
          <KpiCard titulo={`Nível de alerta · ${DOENCA_ROTULO[doenca]}`} periodo={periodo} fonte={fonteInfo}
            valor={m ? <StatusBadge nivel={(m.nv ?? null) as Nivel | null} grande /> : null}
            semDadoMotivo="o InfoDengue não publicou este município nesta semana" />
        ) : (
          <KpiCard titulo={`Municípios por nível · ${DOENCA_ROTULO[doenca]}`} periodo={periodo} fonte={fonteInfo}
            valor={est ? <span className="flex flex-wrap gap-x-3 gap-y-1 text-base font-semibold">
              {(["4", "3", "2", "1"] as const).map((k) => (
                <span key={k} className="inline-flex items-center gap-1"><IconeNivel nivel={Number(k) as Nivel} />{est.porNivel[k]}</span>
              ))}</span> : null}
            rodapeExtra={est ? `${est.porNivel["3"] + est.porNivel["4"]} de ${est.nMun} municípios em Alerta ou Emergência` : undefined}
            semDadoMotivo="nenhum município publicado nesta semana" />
        )}
        <KpiCard titulo="Casos notificados na semana" periodo={periodo} fonte={fonteInfo}
          valor={c === null ? null : fmtNum(c)} serie={spark ?? undefined}
          variacao={c !== null && cAnt !== null ? { valor: c - cAnt, contra: fmtSE(sem?.se_anterior), maiorEhPior: true } : null}
          rodapeExtra={g !== null && m?.ce != null ? `estimado pelo InfoDengue: ${fmtNum(m.ce)}. A semana mais recente ainda recebe notificações atrasadas.` : g === null && est ? `${est.nComDado} municípios com registro` : undefined}
          semDadoMotivo="sem registro do InfoDengue nesta semana" />
        <KpiCard titulo="Incidência" periodo={periodo} fonte={fonteInfo} unidade="por 100 mil hab."
          valor={i === null ? null : fmtNum(i, 1)}
          rodapeExtra={rank ? `${rank.pos}º maior entre ${rank.de} municípios do RN` : g === null && est ? `população coberta: ${fmtNum(est.pop)}` : undefined}
          semDadoMotivo="sem casos ou sem população para o cálculo" />
        <KpiCard titulo="Número de reprodução (Rt)" periodo={periodo} fonte={fonteInfo}
          valor={g === null ? null : m?.rt == null ? null : fmtNum(m.rt, 2)}
          semDadoMotivo={g === null ? "Rt é estimado por município; escolha um município" : "o InfoDengue não estimou Rt nesta semana"}
          rodapeExtra={m?.prt != null ? `probabilidade de Rt > 1: ${fmtPct(m.prt, 0)}` : undefined} />
        <KpiCard titulo="Cobertura de sequenciamento" periodo={cob ? fmtTrimestre(cob.p) : "último trimestre"}
          fonte={{ nome: `${FONTE_GENBANK} + InfoDengue`, atualizado: "calculado pelo VigiGen" }}
          valor={cob && cob.v !== null ? fmtPct(cob.v, 2) : null}
          semDadoMotivo={cob ? cob.mot ?? undefined : "indicador ainda não calculado"}
          rodapeExtra={cob ? `${fmtNum(cob.num)} sequência(s) / ${fmtNum(cob.den)} casos de dengue` : undefined} />
        <KpiCard titulo="Alertas de mudança de linhagem" periodo="Fase 1" fonte={{ nome: "VigiGen (Nextclade)", atualizado: `${fmtNum(r.classificacao.total)} sequências classificadas` }}
          valor={r.classificacao.total === 0 ? null : fmtNum(alertasAqui.length)}
          semDadoMotivo="a classificação por Nextclade ainda não rodou; sem ela não há como detectar mudança de linhagem (isto não é zero)"
          rodapeExtra={<button className="font-semibold text-destaque underline" onClick={() => irPara("alertas")}>ver por quê</button>} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Secao titulo={`Incidência de ${DOENCA_ROTULO[doenca].toLowerCase()} por município`} subtitulo={`${periodo} · casos por 100 mil habitantes · clique para escolher`}>
          {dados.malha && sem ? (
            <Mapa malha={dados.malha} valores={valoresMapa} limites={limites} formatar={(v) => fmtNum(v, v < 10 ? 1 : 0)}
              unidade="por 100 mil" titulo={`Mapa de incidência de ${DOENCA_ROTULO[doenca]}, ${periodo}`} selecionado={g} aoSelecionar={setG} />
          ) : <Nota>Sem dado para este período: malha ou semana não carregada.</Nota>}
        </Secao>
        <Secao titulo={`Série semanal · ${nomeSel}`} subtitulo={`${DOENCA_ROTULO[doenca]}, desde 2020`}>
          {serie ? <GraficoLinhas series={linhas} dominio={dominio} unidade="casos por semana" titulo={`Casos semanais de ${DOENCA_ROTULO[doenca]} em ${nomeSel}`} altura={300} />
            : <Nota>{g !== null && dados.origem === "retrato" ? "A série completa deste município só aparece com o dado ao vivo; o retrato embutido traz a série do estado e as últimas 12 semanas de cada município." : "Carregando série…"}</Nota>}
          <p className="mt-2 text-xs text-suave">A linha tracejada é a estimativa do InfoDengue que corrige o atraso de notificação nas semanas recentes.</p>
        </Secao>
      </div>
    </div>
  );
}
