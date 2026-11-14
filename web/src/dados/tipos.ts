// Formas devolvidas pelas funções SQL painel_* (src/db/migrations/008_painel.sql).
import type { FeatureCollection, Geometry } from "geojson";

export type Doenca = "dengue" | "chikungunya" | "zika";
export const DOENCAS: Doenca[] = ["dengue", "chikungunya", "zika"];

export type Malha = FeatureCollection<Geometry, { g: number; n: string }> & {
  fonte?: string;
  ano_referencia?: number;
};

export interface MunicipioSemana {
  g: number; n: string;
  c: number | null; ce: number | null; i: number | null; nv: 1 | 2 | 3 | 4 | null;
  rt: number | null; prt: number | null; pop: number | null; ca: number | null; dt: string | null;
}
export interface Semana {
  doenca: Doenca; se: number | null; se_anterior: number | null;
  municipios: MunicipioSemana[]; ingerido_em: string | null;
}

export interface Serie {
  geocodigo: number | null; doenca: Doenca;
  se: number[]; dt: string[]; c: (number | null)[]; ce: (number | null)[];
  i: (number | null)[]; nv: (number | null)[]; rt: (number | null)[]; n_mun: number[];
}

export interface Indicador {
  g: number | null; nivel: "municipio" | "estado" | "pais"; p: string; t: string;
  v: number | null; num: number | null; den: number | null; mot: string | null;
  d: Record<string, unknown>; em: string;
}

export interface SequenciaRN {
  acc: string; soro: string | null; coleta: string | null; pub: string | null;
  geo: string | null; nt: number; titulo: string; por_nome: boolean;
}

export interface Alerta {
  id: string; g: number | null; a?: Doenca; tipo: string; p: string;
  status: "novo" | "em_analise" | "confirmado" | "descartado";
  ev: Record<string, unknown>; criado: string; rev: string | null;
}

export interface Fonte { status: string; finalizado_em: string; iniciado_em: string; registros: number; rota?: string | null }

export interface GenbankResumo {
  total: number; rn: number; rn_por_nome_cepa: number; brasil_sem_estado: number;
  sem_geo: number; genoma_quase_completo: number; por_sorotipo: Record<string, number>; termo: string;
}

/** Bloco genômico de um agravo (painel_genomica, migração 013). */
export interface Genomica {
  agravo: Doenca;
  config?: { termo: string; referencia: string; tamanho_referencia: number; limiar: number; criterio_limiar: string; classificacao: string } | null;
  fonte?: { status: string; iniciado_em: string; finalizado_em: string; registros: number } | null;
  genbank: GenbankResumo;
  sequencias_rn: SequenciaRN[];
  composicao_brasil: { a: number; s: string; n: number }[];
  por_ano_brasil: { a: number; n: number; rn: number }[];
  indicadores: Indicador[];
  cobertura_municipal_trimestre: { g: number; p: string; v: number | null; num: number; den: number | null; mot: string | null }[];
  classificacao?: { total: number };
}

export interface Resumo {
  gerado_em: string;
  fontes: Record<string, Fonte> | null;
  em_andamento: string[];
  /** chaves antigas: só dengue */
  genbank: GenbankResumo;
  sequencias_rn: SequenciaRN[];
  composicao_brasil: { a: number; s: string; n: number }[];
  por_ano_brasil: { a: number; n: number; rn: number }[];
  indicadores: Indicador[];
  cobertura_municipal_trimestre: { g: number; p: string; v: number | null; num: number; den: number | null; mot: string | null }[];
  alertas: Alerta[];
  classificacao: { total: number };
  exclusoes_qc: Record<string, number>;
  /** um bloco por agravo; ausente em retratos anteriores à migração 013 */
  genomica?: Partial<Record<Doenca, Genomica>>;
}

export interface Retrato {
  gerado_em: string;
  resumo: Resumo;
  malha: Malha;
  semana: Partial<Record<Doenca, Semana>>;
  serie_estado: Partial<Record<Doenca, Serie>>;
  /** chave "geocodigo:doenca" */
  series_municipio?: Record<string, Serie>;
  /** últimas 12 semanas de casos por município, para as sparklines sem conector */
  ult12?: Partial<Record<Doenca, { se: number[]; c: Record<string, (number | null)[]> }>>;
}
