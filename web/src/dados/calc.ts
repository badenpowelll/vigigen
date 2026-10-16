// Contas derivadas do dado do banco. Só agregações transparentes; nada estimado aqui.
import type { Indicador, MunicipioSemana, Resumo, Semana, Serie } from "./tipos";
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
