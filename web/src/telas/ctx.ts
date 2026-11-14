import type { useDados } from "../dados/useDados";
import type { Doenca, Serie } from "../dados/tipos";

export interface Ctx {
  dados: ReturnType<typeof useDados>;
  doenca: Doenca;
  g: number | null;
  nomeSel: string;
  serieMun: Serie | null;
  setG: (g: number | null) => void;
  irPara: (aba: "visao" | "serie" | "mapa" | "alertas" | "qualidade" | "perfil" | "relatorios" | "sobre") => void;
}

export const FONTE_INFODENGUE = "InfoDengue (Fiocruz/FGV)";
export const FONTE_GENBANK = "NCBI GenBank";
