// Análise automática por regras (não é modelo de IA).
// Lê só o que o painel já carregou (InfoDengue por município e semana; indicador
// genômico do GenBank) e devolve respostas em texto. Mesma entrada, mesmo texto:
// a análise é reprodutível e cada regra está descrita em `regra`.
import type { Doenca, MunicipioSemana, Semana } from "./tipos";
import { DOENCAS } from "./tipos";
import { DOENCA_ROTULO, fmtNum, fmtPct, fmtSE, fmtTrimestre } from "../util";
import { atualidadeSerie } from "./calc";

export const PLANO_MS = {
  titulo: "Plano de contingência nacional para dengue, chikungunya e Zika",
  autoria: "Ministério da Saúde, SVSA/DEDT/CGARB",
  ano: 2025,
  url: "https://www.saude.mg.gov.br/wp-content/uploads/2025/07/23-Plano-de-contingencia-nacional-para-dengue-chikungunya-e-Zika-2.pdf",
} as const;

/** Rt com menos casos que isto (notificados ou estimados) é instável demais para ser lido sozinho. */
export const MIN_CASOS_RT = 5;
/** Probabilidade de Rt > 1 a partir da qual a transmissão é tratada como "tende a crescer". */
export const P_RT_CRESCE = 0.9;

export interface Item { g: number; n: string; texto: string; d?: Doenca }
export interface Resposta {
  id: string; pergunta: string; resumo: string; itens: Item[];
  regra: string; fonte: string; aviso?: string;
}

const casosRef = (m: MunicipioSemana) => Math.max(m.c ?? 0, m.ce ?? 0);
const rotulo = (d: Doenca) => DOENCA_ROTULO[d].toLowerCase();
const listaNomes = (xs: MunicipioSemana[]) => xs.map((m) => m.n).join(", ");

function avisoAtualidade(s: Semana | undefined, d: Doenca, hoje?: Date): string | undefined {
  const a = atualidadeSerie(s?.se, hoje);
  if (a.estado === "atrasada" || a.estado === "parada")
    return `A última semana publicada de ${rotulo(d)} é a ${fmtSE(s?.se)}, ${a.semanas} semanas atrás: o retrato é antigo, não atual.`;
  return undefined;
}

/** 1. Maior incidência, por vírus. */
export function maiorIncidencia(semanas: Partial<Record<Doenca, Semana>>, n = 5, hoje?: Date): Resposta {
  const itens: Item[] = [];
  const partes: string[] = [];
  const avisos: string[] = [];
  for (const d of DOENCAS) {
    const s = semanas[d];
    const top = (s?.municipios ?? []).filter((m) => m.i !== null && m.i > 0).sort((a, b) => b.i! - a.i!).slice(0, n);
    const av = avisoAtualidade(s, d, hoje); if (av) avisos.push(av);
    if (!top.length) { partes.push(`${DOENCA_ROTULO[d]}: nenhum município com incidência acima de zero na ${fmtSE(s?.se)}.`); continue; }
    partes.push(`${DOENCA_ROTULO[d]} (${fmtSE(s?.se)}): ${top.map((m) => `${m.n} ${fmtNum(m.i, 1)}`).join("; ")}.`);
    top.forEach((m) => itens.push({ g: m.g, d, n: `${m.n} · ${DOENCA_ROTULO[d]}`, texto:
      `${fmtNum(m.i, 1)} por 100 mil hab.; ${fmtNum(m.c)} caso(s) notificado(s) e ${fmtNum(m.ce)} estimado(s) pelo InfoDengue.` }));
  }
  return {
    id: "maior-incidencia", pergunta: "Quais municípios têm a maior incidência de cada vírus?",
    resumo: `Os ${n} municípios de maior incidência de cada vírus na última semana publicada. ${partes.filter((x) => x.includes("nenhum")).join(" ")}`.trim(), itens,
    regra: `Os ${n} maiores valores de incidência (casos estimados por 100 mil hab.) da última semana publicada de cada vírus.`,
    fonte: "InfoDengue (Fiocruz/FGV), população IBGE", aviso: avisos.join(" ") || undefined,
  };
}

/** 2. Onde a transmissão tende a crescer (Rt > 1 com alta probabilidade). */
export function transmissaoCrescendo(s: Semana | undefined, d: Doenca): Resposta {
  const cand = (s?.municipios ?? []).filter((m) => m.rt !== null && m.rt > 1 && (m.prt ?? 0) >= P_RT_CRESCE);
  const firmes = cand.filter((m) => casosRef(m) >= MIN_CASOS_RT).sort((a, b) => b.rt! - a.rt!);
  const instaveis = cand.filter((m) => casosRef(m) < MIN_CASOS_RT);
  const resumo = !cand.length
    ? `Nenhum município tem Rt acima de 1 com probabilidade de ${fmtPct(P_RT_CRESCE, 0)} ou mais na ${fmtSE(s?.se)}.`
    : `${firmes.length} município(s) com Rt acima de 1, probabilidade alta e casos suficientes para leitura${firmes.length ? `: ${listaNomes(firmes)}` : ""}.`
      + (instaveis.length ? ` Outros ${instaveis.length} têm Rt acima de 1 com menos de ${MIN_CASOS_RT} casos, leitura instável (${listaNomes(instaveis)}).` : "");
  return {
    id: "rt", pergunta: `Onde a transmissão de ${rotulo(d)} tende a crescer?`, resumo,
    itens: firmes.map((m) => ({ g: m.g, n: m.n, texto: `Rt ${fmtNum(m.rt, 2)}; probabilidade de Rt > 1: ${fmtPct(m.prt, 0)}; ${fmtNum(m.c)} notificado(s), ${fmtNum(m.ce)} estimado(s).` })),
    regra: `Rt > 1 e probabilidade de Rt > 1 de ${fmtPct(P_RT_CRESCE, 0)} ou mais, ambos estimados pelo InfoDengue. Com menos de ${MIN_CASOS_RT} casos (o maior entre notificados e estimados), o Rt é marcado como instável.`,
    fonte: "InfoDengue (Fiocruz/FGV)",
  };
}

/** 3. Onde os casos notificados subiram em relação à semana anterior. */
export function subidaSemanal(s: Semana | undefined, d: Doenca, n = 5): Resposta {
  const sub = (s?.municipios ?? []).filter((m) => m.c !== null && m.ca !== null && m.c > m.ca)
    .sort((a, b) => (b.c! - b.ca!) - (a.c! - a.ca!) || a.n.localeCompare(b.n, "pt-BR"));
  const top = sub.slice(0, n);
  return {
    id: "subida", pergunta: `Onde os casos notificados de ${rotulo(d)} subiram em relação à semana anterior?`,
    resumo: sub.length
      ? `${sub.length} município(s) notificaram mais casos na ${fmtSE(s?.se)} que na ${fmtSE(s?.se_anterior)}. Maiores altas: ${top.map((m) => `${m.n} (+${fmtNum(m.c! - m.ca!)})`).join(", ")}.`
      : `Nenhum município notificou mais casos na ${fmtSE(s?.se)} que na ${fmtSE(s?.se_anterior)}.`,
    itens: top.map((m) => ({ g: m.g, n: m.n, texto: `${fmtNum(m.ca)} → ${fmtNum(m.c)} caso(s) notificado(s).` })),
    regra: "Diferença entre os casos notificados da última semana e os da semana anterior, publicados pelo InfoDengue. A semana mais recente ainda recebe notificações atrasadas, então a alta tende a ser subestimada.",
    fonte: "InfoDengue (Fiocruz/FGV)",
  };
}

/** Diferença mínima entre estimados e notificados para tratar a incidência como vinda do atraso de notificação. */
export const DIF_ATRASO = 2;
const soEstimado = (m: MunicipioSemana) => (m.c ?? 0) <= 1 && (m.ce ?? 0) - (m.c ?? 0) >= DIF_ATRASO;

/** 4. Incidência alta com poucos notificados e muitos estimados: sinal de atraso de notificação. */
export function incidenciaSemNotificacao(s: Semana | undefined, d: Doenca): Resposta {
  const com = (s?.municipios ?? []).filter((m) => m.i !== null && m.i > 0).sort((a, b) => a.i! - b.i!);
  const p75 = com.length ? com[Math.floor(com.length * 0.75)].i! : Infinity;
  const xs = com.filter((m) => m.i! >= p75 && soEstimado(m)).sort((a, b) => b.i! - a.i!);
  return {
    id: "atraso", pergunta: "Onde há incidência alta, mas quase nenhum caso notificado?",
    resumo: xs.length
      ? `${xs.length} município(s) estão entre os 25% de maior incidência de ${rotulo(d)} com 0 ou 1 caso notificado e ao menos ${DIF_ATRASO} a mais estimados: ${listaNomes(xs)}. A incidência deles vem dos casos estimados; vale conferir se há notificações paradas.`
      : `Nenhum município está entre os 25% de maior incidência com 0 ou 1 caso notificado e ao menos ${DIF_ATRASO} a mais estimados.`,
    itens: xs.map((m) => ({ g: m.g, n: m.n, texto: `${fmtNum(m.i, 1)} por 100 mil; ${fmtNum(m.c)} notificado(s) e ${fmtNum(m.ce)} estimado(s); população ${fmtNum(m.pop)}.` })),
    regra: `Municípios com incidência no quartil superior (entre os que têm incidência acima de zero), 0 ou 1 caso notificado e ao menos ${DIF_ATRASO} casos estimados a mais que os notificados. Município pequeno com 1 caso notificado e 1 estimado não entra: ali a incidência alta vem da população pequena, não do atraso.`,
    fonte: "InfoDengue (Fiocruz/FGV), população IBGE",
  };
}

/** 5. Municípios em Alerta ou Emergência no InfoDengue. */
export function nivelAlto(s: Semana | undefined, d: Doenca): Resposta {
  const xs = (s?.municipios ?? []).filter((m) => (m.nv ?? 0) >= 3).sort((a, b) => (b.nv! - a.nv!) || ((b.i ?? 0) - (a.i ?? 0)));
  const cont = [1, 2, 3, 4].map((k) => (s?.municipios ?? []).filter((m) => m.nv === k).length);
  return {
    id: "nivel", pergunta: `Quais municípios estão em Alerta ou Emergência para ${rotulo(d)}?`,
    resumo: (xs.length ? `${xs.length} município(s): ${listaNomes(xs)}.` : `Nenhum na ${fmtSE(s?.se)}.`)
      + ` Distribuição dos ${s?.municipios.length ?? 0}: ${cont[0]} Baixo, ${cont[1]} Atenção, ${cont[2]} Alerta, ${cont[3]} Emergência.`,
    itens: xs.map((m) => ({ g: m.g, n: m.n, texto: `Nível ${m.nv === 4 ? "Emergência" : "Alerta"}; incidência ${fmtNum(m.i, 1)} por 100 mil.` })),
    regra: "Nível de alerta publicado pelo InfoDengue (3 = Alerta, 4 = Emergência). Não é o estágio operacional do Plano de Contingência do Ministério da Saúde.",
    fonte: "InfoDengue (Fiocruz/FGV)",
  };
}

/** 6. Onde faltam sequências: casos no trimestre e nenhuma sequência pública com município. */
export function faltamSequencias(
  cob: { g: number; p: string; v: number | null; num: number; den: number | null; mot: string | null }[],
  nomes: Map<number, string>, d: Doenca, genomicaOk: boolean, n = 5,
): Resposta {
  const base = {
    id: "sequencias", pergunta: `Onde faltam sequências genômicas de ${rotulo(d)}?`,
    regra: "Indicador do VigiGen: sequências do GenBank com coleta no trimestre e município identificado ÷ casos notificados no mesmo trimestre e município. \"Zero observado\" = houve casos e nenhuma sequência pública com município.",
    fonte: "NCBI GenBank + InfoDengue, calculado pelo VigiGen",
  };
  if (!genomicaOk) return { ...base, itens: [], resumo: `As sequências de ${rotulo(d)} ainda não foram ingeridas do GenBank; não dá para dizer onde faltam (isto não é zero).` };
  if (!cob.length) return { ...base, itens: [], resumo: "O indicador por município ainda não foi calculado para este vírus (isto não é zero)." };
  const zero = cob.filter((x) => x.v === 0 && (x.den ?? 0) > 0).sort((a, b) => (b.den ?? 0) - (a.den ?? 0));
  const comSeq = cob.filter((x) => (x.v ?? 0) > 0);
  const p = cob[0]?.p ? fmtTrimestre(cob[0].p) : "mais recente";
  return {
    ...base,
    resumo: `No ${p}, ${zero.length} município(s) tiveram casos e nenhuma sequência pública com município identificado; ${comSeq.length} tiveram ao menos uma.`
      + (zero.length ? ` Mais casos sem sequência: ${zero.slice(0, n).map((x) => `${nomes.get(x.g) ?? x.g} (${fmtNum(x.den)} casos)`).join(", ")}.` : ""),
    itens: zero.slice(0, n).map((x) => ({ g: x.g, n: nomes.get(x.g) ?? String(x.g), texto: `${fmtNum(x.den)} caso(s) no trimestre e 0 sequência pública com município.` })),
    aviso: "Zero aqui é ausência de registro no GenBank, não prova de que não houve sequenciamento no LACEN ou em outro laboratório.",
  };
}

/** Sinais de um município, para as condutas sugeridas. */
export function sinaisDe(m: MunicipioSemana, p75: number): string[] {
  const s: string[] = [];
  if ((m.nv ?? 0) >= 3) s.push("nivel");
  if (m.rt !== null && m.rt > 1 && (m.prt ?? 0) >= P_RT_CRESCE && casosRef(m) >= MIN_CASOS_RT) s.push("rt");
  if (m.c !== null && m.ca !== null && m.c > m.ca) s.push("subida");
  if (m.i !== null && m.i >= p75 && soEstimado(m)) s.push("atraso");
  if (m.i !== null && m.i >= p75) s.push("incidencia");
  return s;
}

/** Condutas sugeridas por sinal, nos eixos do Plano de Contingência Nacional (MS, 2025). */
export const CONDUTA: Record<string, { eixo: string; texto: string }> = {
  incidencia: { eixo: "Vigilância epidemiológica", texto: "acompanhar a incidência semana a semana e compará-la ao canal endêmico do próprio município, que é o critério do plano para mudar de estágio." },
  subida: { eixo: "Vigilância epidemiológica", texto: "consolidar semanalmente as informações epidemiológicas, laboratoriais e entomológicas, como o plano prevê no estágio de Mobilização." },
  rt: { eixo: "Controle vetorial", texto: "avaliar a intensificação das medidas de controle vetorial, ação que o plano associa ao estágio de Mobilização." },
  nivel: { eixo: "Assistência", texto: "verificar se a rede de atenção está preparada para o aumento de atendimentos, como o plano orienta ao mobilizar os serviços assistenciais." },
  atraso: { eixo: "Vigilância epidemiológica", texto: "conferir se há notificações paradas ou digitação atrasada no SINAN, porque a incidência vem quase toda dos casos estimados." },
};

/** 7. Atuação sugerida aos gestores nos municípios com mais sinais. */
export function condutasSugeridas(s: Semana | undefined, d: Doenca, n = 5): Resposta {
  const com = (s?.municipios ?? []).filter((m) => m.i !== null && m.i > 0).sort((a, b) => a.i! - b.i!);
  const p75 = com.length ? com[Math.floor(com.length * 0.75)].i! : Infinity;
  const ord = (s?.municipios ?? []).map((m) => ({ m, sin: sinaisDe(m, p75) })).filter((x) => x.sin.length)
    .sort((a, b) => b.sin.length - a.sin.length || (b.m.i ?? 0) - (a.m.i ?? 0)).slice(0, n);
  return {
    id: "condutas", pergunta: `Que atuação dos gestores é sugerida nos municípios com mais sinais de ${rotulo(d)}?`,
    resumo: ord.length
      ? `Os ${ord.length} municípios com mais sinais na ${fmtSE(s?.se)} são ${ord.map((x) => x.m.n).join(", ")}. Para cada um, a conduta abaixo sai dos sinais encontrados e dos eixos do Plano de Contingência Nacional.`
      : `Nenhum município reúne sinais nesta semana.`,
    itens: ord.map(({ m, sin }) => ({ g: m.g, n: m.n,
      texto: sin.filter((k, i, a) => a.findIndex((z) => CONDUTA[z].texto === CONDUTA[k].texto) === i)
        .map((k) => `${CONDUTA[k].eixo}: ${CONDUTA[k].texto}`).join(" ") })),
    regra: "Sinais: incidência no quartil superior; casos acima da semana anterior; Rt > 1 com probabilidade alta e casos suficientes; nível Alerta ou Emergência; incidência alta com 0 ou 1 notificado e mais estimados. Cada sinal leva a uma conduta fixa, escrita a partir dos eixos do plano do Ministério da Saúde.",
    fonte: `${PLANO_MS.autoria}, ${PLANO_MS.titulo} (${PLANO_MS.ano}); dados do InfoDengue`,
    aviso: "São sugestões de conduta, não o que a gestão do município fez: o VigiGen não tem dado sobre as ações realizadas. O estágio oficial (Normalidade, Mobilização, Alerta, Epidemia) depende do canal endêmico local por quatro semanas, que o VigiGen ainda não calcula.",
  };
}
