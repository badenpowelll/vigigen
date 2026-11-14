// Trilha de uso do site: login, cliques, navegação e erros vão para
// public.evento_uso pelo RPC registrar_eventos. IP, país e navegador são
// lidos pelo banco nos cabeçalhos da requisição; o site não manda isso.
// Nunca registramos o que a pessoa digita: só o rótulo do elemento clicado.
// No artefato do claude.ai (sem Supabase) nada é enviado.
import { supabase } from "./supabase";

export type TipoEvento = "sessao" | "login" | "login_falha" | "logout" | "navegacao" | "clique" | "acao" | "erro";
interface Evento { tipo: TipoEvento; alvo?: string; rota?: string; detalhe?: Record<string, unknown>; email?: string; em: string; sessao: string }

const SESSAO = (() => {
  try {
    const k = "vigigen:sessao";
    const s = sessionStorage.getItem(k) ?? crypto.randomUUID();
    sessionStorage.setItem(k, s);
    return s;
  } catch { return crypto.randomUUID(); }
})();

let fila: Evento[] = [];
let ligado = false;
let timer: number | undefined;

export function registrar(tipo: TipoEvento, alvo?: string, detalhe?: Record<string, unknown>, email?: string) {
  if (!supabase) return;
  fila.push({ tipo, alvo: alvo?.slice(0, 200), rota: location.hash || "#", detalhe, email, em: new Date().toISOString(), sessao: SESSAO });
  if (fila.length >= 20 || tipo === "login" || tipo === "login_falha" || tipo === "logout") void enviar();
  else if (timer === undefined) timer = window.setTimeout(() => void enviar(), 4000);
}

export async function enviar() {
  if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
  if (!supabase || !fila.length) return;
  const lote = fila.splice(0, 100);
  const { error } = await supabase.rpc("registrar_eventos", { p_eventos: lote });
  // sem sessão o banco descarta o que não for login_falha; com erro de rede, tenta de novo uma vez
  if (error && !lote.some((e) => (e.detalhe as { reenvio?: boolean } | undefined)?.reenvio)) {
    fila.unshift(...lote.map((e) => ({ ...e, detalhe: { ...e.detalhe, reenvio: true } })));
  }
}

function rotuloDe(el: Element): string {
  const h = el as HTMLElement;
  const explicito = h.dataset?.rastro || h.getAttribute("aria-label") || h.getAttribute("title");
  if (explicito) return explicito;
  if (el instanceof HTMLSelectElement) {
    const rot = el.closest("label")?.querySelector(".rotulo")?.textContent ?? el.name ?? "seleção";
    return `${rot}: ${el.selectedOptions[0]?.textContent ?? ""}`;
  }
  if (el instanceof HTMLInputElement) return `${el.type}: ${el.name || el.id || el.closest("label")?.textContent?.trim() || "campo"}`;
  const t = (h.innerText || h.textContent || "").replace(/\s+/g, " ").trim();
  return t.slice(0, 80) || el.tagName.toLowerCase();
}

const CLICAVEIS = "button,a,[role=tab],[role=radio],[role=button],summary,input[type=checkbox],input[type=radio],input[type=submit],[data-rastro],path[aria-label],[role=img][aria-label]";

/** Liga os ouvintes globais uma vez por página. */
export function ligarTelemetria() {
  if (ligado || !supabase) return;
  ligado = true;
  registrar("sessao", "abriu o site", {
    tela: `${screen.width}x${screen.height}`, janela: `${innerWidth}x${innerHeight}`,
    idioma: navigator.language, fuso: Intl.DateTimeFormat().resolvedOptions().timeZone, referencia: document.referrer || null,
  });
  document.addEventListener("click", (e) => {
    const el = (e.target as Element | null)?.closest?.(CLICAVEIS);
    if (!el || (el as HTMLInputElement).type === "password") return;
    registrar("clique", rotuloDe(el), { tag: el.tagName.toLowerCase() });
  }, { capture: true });
  document.addEventListener("change", (e) => {
    const el = e.target as Element;
    if (el instanceof HTMLSelectElement) registrar("clique", rotuloDe(el), { tag: "select" });
  }, { capture: true });
  addEventListener("hashchange", () => registrar("navegacao", location.hash || "#"));
  addEventListener("error", (e) => registrar("erro", String(e.message).slice(0, 200), { arquivo: e.filename, linha: e.lineno }));
  addEventListener("unhandledrejection", (e) => registrar("erro", String((e.reason as Error)?.message ?? e.reason).slice(0, 200)));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void enviar(); });
}
