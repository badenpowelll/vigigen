// Contas derivadas do dado do banco. Só agregações transparentes; nada estimado aqui.
import type { Alerta, Doenca, Indicador, MunicipioSemana, Resumo, Semana, Serie } from "./tipos";
import { trimestreDe } from "../util";

export interface Agregado {
  c: number | null; ce: number | null; i: number | null; pop: number;
  nMun: number; nComDado: number; porNivel: Record<string, number>;
}

export function agregarEstado(s: Semana | undefined): Agregado | null {
  if (!s || !s.municipios.length) return null;
  const com = s.municipios.filter((m) => m.c !== null);
  if (!com.length) return null;
  const c = com.reduce((a, m) => a + (m.c ?? 0), 0);
  const ce = com.reduce((a, m) => a + (m.ce ?? m.c ?? 0), 0);
  const pop = com.reduce((a, m) => a + (m.pop ?? 0), 0);
  const porNivel: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, nulo: 0 };
  s.municipios.forEach((m) => { porNivel[m.nv ? String(m.nv) : "nulo"]++; });
  return { c, ce, i: pop ? (c / pop) * 1e5 : null, pop, nMun: s.municipios.length, nComDado: com.length, porNivel };
}

export function posicao(s: Semana | undefined, g: number, campo: keyof MunicipioSemana): { pos: number; de: number } | null {
  if (!s) return null;
  const lista = s.municipios.filter((m) => typeof m[campo] === "number").sort((a, b) => (b[campo] as number) - (a[campo] as number));
  const i = lista.findIndex((m) => m.g === g);
  return i < 0 ? null : { pos: i + 1, de: lista.length };
}

export function ultimos<T>(arr: T[] | undefined, n: number): T[] { return arr ? arr.slice(Math.max(0, arr.length - n)) : []; }

/** Valor da semana anterior na série (para variação), alinhado pela SE. */
export function valorNaSE(serie: Serie | null | undefined, se: number | null, campo: "c" | "i" | "rt"): number | null {
  if (!serie || !se) return null;
  const k = serie.se.indexOf(se);
  return k < 0 ? null : (serie[campo][k] ?? null);
}

export function coberturaMunicipio(r: Resumo | null, g: number | null) {
  if (!r) return null;
  if (g === null) {
    const est = r.indicadores.filter((x) => x.t === "cobertura_sequenciamento" && x.nivel === "estado" && /T\d$/.test(x.p) && x.p < trimestreDe(new Date())).sort((a, b) => a.p.localeCompare(b.p));
    return est.at(-1) ?? null;
  }
  const lst = r.cobertura_municipal_trimestre.filter((x) => x.g === g).sort((a, b) => a.p.localeCompare(b.p));
  return lst.at(-1) ?? null;
}

export function indicadoresPor(r: Resumo | null, prefixo: string): Indicador[] {
  return r ? r.indicadores.filter((x) => x.t.startsWith(prefixo)) : [];
}

export const seParaData = (se: number) => {
  // início aproximado da SE para eixo; o dt do InfoDengue é usado quando existe.
  const ano = Math.floor(se / 100), sem = se % 100;
  return new Date(Date.UTC(ano, 0, 1 + (sem - 1) * 7));
};

// ---------- camada genômica por agravo ----------

export type EstadoGenomico = "ok" | "nao_ingerido" | "vazio";

/** Limiar histórico de dengue (9.000 nt), usado só quando o banco não informa o do agravo. */
const LIMIAR_DENGUE_LEGADO = 9000;

/**
 * O resumo com os campos genômicos trocados pelos do agravo escolhido.
 * Nunca usa dado de outro vírus: sem bloco do agravo, devolve estado
 * "nao_ingerido" e listas vazias.
 */
export function genomicaDe(r: Resumo | null, doenca: Doenca): {
  r: Resumo | null; estado: EstadoGenomico; limiar: number | null; criterioLimiar: string | null;
  termo: string | null; consultaEm: string | null; classificacao: string | null;
  /** sequências DESTE agravo com classificação gravada (nunca o total global) */
  classificadas: number; execucao: string | number | null; provisorio: boolean;
} {
  if (!r) return { r: null, estado: "nao_ingerido", limiar: null, criterioLimiar: null, termo: null, consultaEm: null, classificacao: null, classificadas: 0, execucao: null, provisorio: false };
  const g = r.genomica?.[doenca];
  if (g) {
    const estado: EstadoGenomico = g.genbank.total > 0 ? "ok" : g.fonte ? "vazio" : "nao_ingerido";
    return {
      r: { ...r, genbank: g.genbank, sequencias_rn: g.sequencias_rn, composicao_brasil: g.composicao_brasil,
           por_ano_brasil: g.por_ano_brasil, indicadores: g.indicadores,
           cobertura_municipal_trimestre: g.cobertura_municipal_trimestre },
      estado, limiar: g.config?.limiar ?? null, criterioLimiar: g.config?.criterio_limiar ?? null,
      termo: g.config?.termo ?? g.genbank.termo, consultaEm: g.fonte?.finalizado_em ?? null,
      classificacao: g.config?.classificacao ?? null,
      classificadas: g.classificacao?.total ?? 0, execucao: g.fonte?.id ?? null,
      provisorio: /provis/i.test(g.config?.criterio_limiar ?? ""),
    };
  }
  if (doenca === "dengue") {
    return { r, estado: r.genbank.total > 0 ? "ok" : "nao_ingerido", limiar: LIMIAR_DENGUE_LEGADO,
             criterioLimiar: "limiar histórico do projeto", termo: r.genbank.termo,
             consultaEm: r.fontes?.genbank?.finalizado_em ?? null, classificacao: null,
             // antes da migração 013 só existia dengue no banco, então o total é de dengue
             classificadas: r.classificacao.total, execucao: r.fontes?.genbank?.id ?? null, provisorio: false };
  }
  const vazio: Resumo = { ...r, genbank: { total: 0, rn: 0, rn_por_nome_cepa: 0, brasil_sem_estado: 0, sem_geo: 0, genoma_quase_completo: 0, por_sorotipo: {}, termo: "" },
    sequencias_rn: [], composicao_brasil: [], por_ano_brasil: [], indicadores: [], cobertura_municipal_trimestre: [] };
  return { r: vazio, estado: "nao_ingerido", limiar: null, criterioLimiar: null, termo: null, consultaEm: null, classificacao: null, classificadas: 0, execucao: null, provisorio: false };
}

/**
 * Sequências classificadas do agravo. Usa a contagem por vírus do bloco
 * genômico (migração 013). Sem o bloco, o total antigo do resumo só vale para
 * dengue, que era o único vírus ingerido; para os outros é zero, nunca o de dengue.
 */
export function classificadasDe(r: Resumo | null, doenca: Doenca): number {
  if (!r) return 0;
  const porAgravo = r.genomica?.[doenca]?.classificacao?.total;
  if (typeof porAgravo === "number") return porAgravo;
  return doenca === "dengue" ? r.classificacao.total : 0;
}

/** Alertas do agravo e do território. Alertas anteriores à migração 013 não têm agravo e são de dengue. */
export function alertasDe(r: Resumo | null, doenca: Doenca, g: number | null): Alerta[] {
  return r ? r.alertas.filter((a) => (a.a ?? "dengue") === doenca && (g === null || a.g === g)) : [];
}

/**
 * Estado da camada de cobertura do mapa. Distingue indicador não calculado,
 * nenhum município com valor (só "sem dado") e zero observado de verdade.
 */
export type EstadoCobertura = "nao_calculado" | "so_sem_dado" | "zero_observado" | "com_valor";
export function estadoCobertura(valores: (number | null)[]): EstadoCobertura {
  if (valores.length === 0) return "nao_calculado";
  if (valores.some((v) => v !== null && v > 0)) return "com_valor";
  return valores.some((v) => v === 0) ? "zero_observado" : "so_sem_dado";
}

export const SIGLA_VIRUS: Record<Doenca, string> = { dengue: "DENV", chikungunya: "CHIKV", zika: "ZIKV" };
export const NOME_VIRUS: Record<Doenca, string> = { dengue: "Dengue virus", chikungunya: "Chikungunya virus", zika: "Zika virus" };

/** Frase única para quando o agravo não tem dado genômico, com o motivo. */
export function motivoSemGenomica(doenca: Doenca, estado: EstadoGenomico): string {
  const v = `${NOME_VIRUS[doenca]} (${SIGLA_VIRUS[doenca]})`;
  return estado === "vazio"
    ? `A consulta ao GenBank para ${v} rodou e não trouxe nenhuma sequência do Brasil. Isto é zero na fonte, não falha.`
    : `As sequências de ${v} ainda não foram ingeridas do GenBank neste banco. Nenhum número de dengue é mostrado no lugar.`;
}

// ---------- estado da detecção de alertas, por agravo ----------

/**
 * Em que ponto da cadeia sequência → classificação → detecção → revisão o agravo está.
 * Só devolve um estado conclusivo ("concluida_sem_alertas", "alertas_*") quando há
 * registro de uma execução da detecção; sem esse registro a ausência de alerta é
 * "deteccao_pendente", nunca "sem mudança".
 */
export type EstadoDeteccao =
  | "sem_sequencias" | "aguardando_classificacao" | "qc_insuficiente"
  | "deteccao_pendente" | "concluida_sem_alertas" | "alertas_pendentes" | "alertas_revisados";

/** A detecção (src/db/load.py detectar-alertas) roda hoje só sobre dengue. */
export const AGRAVOS_COM_DETECCAO: Doenca[] = ["dengue"];

export function estadoDeteccao(r: Resumo | null, doenca: Doenca, g: number | null): {
  estado: EstadoDeteccao; alertas: Alerta[]; classificadas: number; excluidasQc: number; deteccaoEm: string | null;
} {
  const gen = genomicaDe(r, doenca);
  // alertas gravados antes da migração 013 não têm agravo e são todos de dengue
  const alertas = (r?.alertas ?? []).filter((a) => (a.a ?? "dengue") === doenca && (g === null || a.g === g));
  // exclusões de QC só existem para o workflow de dengue (o único com dataset Nextclade verificado)
  const excluidasQc = doenca === "dengue" ? Object.values(r?.exclusoes_qc ?? {}).reduce((a, b) => a + b, 0) : 0;
  const deteccaoEm = AGRAVOS_COM_DETECCAO.includes(doenca) ? r?.deteccao?.em ?? null : null;
  const base = { alertas, classificadas: gen.classificadas, excluidasQc, deteccaoEm };
  if (gen.estado !== "ok") return { estado: "sem_sequencias", ...base };
  if (gen.classificadas === 0) return { estado: excluidasQc > 0 ? "qc_insuficiente" : "aguardando_classificacao", ...base };
  if (alertas.length > 0) {
    const pend = alertas.some((a) => a.status === "novo" || a.status === "em_analise");
    return { estado: pend ? "alertas_pendentes" : "alertas_revisados", ...base };
  }
  return { estado: deteccaoEm ? "concluida_sem_alertas" : "deteccao_pendente", ...base };
}

// ---------- atualidade da série epidemiológica, por agravo ----------

/** Semana epidemiológica (aaaass) de uma data, pela regra do SINAN: a SE 1 termina no
 *  primeiro sábado do ano que tenha pelo menos 4 dias de janeiro. */
export function seDe(d: Date): number {
  const dia = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const inicioSE1 = (ano: number) => {
    const j1 = Date.UTC(ano, 0, 1);
    const dow = new Date(j1).getUTCDay(); // 0 = domingo
    // domingo que começa a SE 1: o domingo da semana de 1º de janeiro se ela tem 4+ dias em janeiro
    return dow <= 3 ? j1 - dow * 864e5 : j1 + (7 - dow) * 864e5;
  };
  let ano = d.getUTCFullYear();
  if (dia < inicioSE1(ano)) ano -= 1;
  else if (dia >= inicioSE1(ano + 1)) ano += 1;
  const sem = Math.floor((dia - inicioSE1(ano)) / (7 * 864e5)) + 1;
  return ano * 100 + sem;
}

/** Semanas entre duas SE (aaaass), contando a virada de ano pelo calendário real. */
export function semanasEntre(seA: number, seB: number): number {
  const ini = (se: number) => {
    const ano = Math.floor(se / 100);
    const j1 = Date.UTC(ano, 0, 1); const dow = new Date(j1).getUTCDay();
    const s1 = dow <= 3 ? j1 - dow * 864e5 : j1 + (7 - dow) * 864e5;
    return s1 + ((se % 100) - 1) * 7 * 864e5;
  };
  return Math.round((ini(seB) - ini(seA)) / (7 * 864e5));
}

export type Atualidade = "em_dia" | "atrasada" | "parada" | "sem_dado";

/**
 * Quão atual é a última SE publicada de um agravo, comparada com a SE corrente.
 * O InfoDengue publica com 1 a 2 semanas de defasagem; acima de 4 é atraso e acima
 * de 12 a série é tratada como parada. A data de leitura do banco não entra aqui:
 * uma leitura recente não torna recente o dado epidemiológico.
 */
export function atualidadeSerie(se: number | null | undefined, hoje = new Date()): { estado: Atualidade; semanas: number | null } {
  if (!se) return { estado: "sem_dado", semanas: null };
  const n = semanasEntre(se, seDe(hoje));
  return { estado: n <= 4 ? "em_dia" : n <= 12 ? "atrasada" : "parada", semanas: n };
}
