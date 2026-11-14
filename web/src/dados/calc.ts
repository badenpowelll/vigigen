// Contas derivadas do dado do banco. Só agregações transparentes; nada estimado aqui.
import type { Doenca, Indicador, MunicipioSemana, Resumo, Semana, Serie } from "./tipos";
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
} {
  if (!r) return { r: null, estado: "nao_ingerido", limiar: null, criterioLimiar: null, termo: null, consultaEm: null, classificacao: null };
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
    };
  }
  if (doenca === "dengue") {
    return { r, estado: r.genbank.total > 0 ? "ok" : "nao_ingerido", limiar: LIMIAR_DENGUE_LEGADO,
             criterioLimiar: "limiar histórico do projeto", termo: r.genbank.termo,
             consultaEm: r.fontes?.genbank?.finalizado_em ?? null, classificacao: null };
  }
  const vazio: Resumo = { ...r, genbank: { total: 0, rn: 0, rn_por_nome_cepa: 0, brasil_sem_estado: 0, sem_geo: 0, genoma_quase_completo: 0, por_sorotipo: {}, termo: "" },
    sequencias_rn: [], composicao_brasil: [], por_ano_brasil: [], indicadores: [], cobertura_municipal_trimestre: [] };
  return { r: vazio, estado: "nao_ingerido", limiar: null, criterioLimiar: null, termo: null, consultaEm: null, classificacao: null };
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
