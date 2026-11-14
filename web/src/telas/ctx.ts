import type { useDados } from "../dados/useDados";
import type { Doenca, Serie } from "../dados/tipos";

export interface Ctx {
  dados: ReturnType<typeof useDados>;
  doenca: Doenca;
  g: number | null;
  nomeSel: string;
  serieMun: Serie | null;
  setG: (g: number | null) => void;
  setDoenca?: (d: Doenca) => void;
  /** quem está logado, para o carimbo das exportações; null no artefato do claude.ai (sem login) */
  usuario?: { email: string; matricula: string | null } | null;
  irPara: (aba: "visao" | "serie" | "mapa" | "alertas" | "qualidade" | "perfil" | "relatorios" | "sobre") => void;
}

export const FONTE_INFODENGUE = "InfoDengue (Fiocruz/FGV)";
export const FONTE_GENBANK = "NCBI GenBank";
