export const fmtNum = (v: number | null | undefined, casas = 0) =>
  v === null || v === undefined || Number.isNaN(v)
    ? "—"
    : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

export const fmtPct = (v: number | null | undefined, casas = 1) =>
  v === null || v === undefined ? "—" : (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }) + "%";

/** 202640 -> "SE 40/2026" */
export const fmtSE = (se: number | null | undefined) =>
  se ? `SE ${String(se % 100).padStart(2, "0")}/${Math.floor(se / 100)}` : "—";

/** "2025T3" -> "3º trim. 2025" */
export const fmtTrimestre = (p: string) => {
  const m = p.match(/^(\d{4})T(\d)$/);
  return m ? `${m[2]}º trim. ${m[1]}` : p;
};

export const fmtData = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

export const fmtDataHora = (iso: string | number | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export function haQuanto(iso: string | number | null | undefined): string {
  if (!iso) return "data desconhecida";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 2) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

export const trimestreDe = (d: Date) => `${d.getUTCFullYear()}T${Math.floor(d.getUTCMonth() / 3) + 1}`;

export const DOENCA_ROTULO: Record<string, string> = { dengue: "Dengue", chikungunya: "Chikungunya", zika: "Zika" };
/** Identidade: doenças ocupam id-1..3; sorotipos id-4..7; "não declarado" id-8. Nunca reciclar. */
export const COR_DOENCA: Record<string, string> = { dengue: "var(--id-1)", chikungunya: "var(--id-2)", zika: "var(--id-3)" };
export const COR_SOROTIPO: Record<string, string> = {
  "DENV-1": "var(--id-4)", "DENV-2": "var(--id-5)", "DENV-3": "var(--id-6)", "DENV-4": "var(--id-7)", "não declarado": "var(--id-8)",
};
export const SOROTIPOS = ["DENV-1", "DENV-2", "DENV-3", "DENV-4", "não declarado"];

export function percentil(valores: number[], v: number): number {
  const ord = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!ord.length) return NaN;
  const abaixo = ord.filter((x) => x < v).length;
  const iguais = ord.filter((x) => x === v).length;
  return ((abaixo + iguais / 2) / ord.length) * 100;
}

export function mediana(valores: number[]): number | null {
  const o = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!o.length) return null;
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

export function registrarUso(chave: string) {
  try {
    const k = "vigigen:telemetria";
    const t = JSON.parse(localStorage.getItem(k) ?? "{}") as Record<string, number>;
    t[chave] = (t[chave] ?? 0) + 1;
    localStorage.setItem(k, JSON.stringify(t));
  } catch { /* armazenamento indisponível: telemetria local é opcional */ }
}
export function lerUso(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem("vigigen:telemetria") ?? "{}"); } catch { return {}; }
}
