// VigiGen — utilidades comuns das Edge Functions de ingestão.
// Regra 3 do CLAUDE.md: toda resposta externa é gravada crua em public.bruto
// antes de qualquer transformação (a transformação é feita no banco).
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export const USER_AGENT = "VigiGen/0.1 (UFRN/IMD; pesquisa de doutorado)";

export function cliente(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export async function autorizado(req: Request, sb: SupabaseClient): Promise<boolean> {
  const t = req.headers.get("x-vigigen-token") ?? "";
  if (!t) return false;
  const { data, error } = await sb.rpc("ingest_token_valido", { t });
  return !error && data === true;
}

export async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// GET/POST com retentativa e backoff exponencial (1s, 2s, 4s, 8s).
export async function buscar(
  url: string,
  init: RequestInit = {},
  tentativas = 4,
): Promise<{ status: number; corpo: string }> {
  let ultimoErro = "";
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, {
        ...init,
        headers: { "User-Agent": USER_AGENT, ...(init.headers ?? {}) },
      });
      const corpo = await r.text();
      if (r.status < 500 && r.status !== 429) return { status: r.status, corpo };
      ultimoErro = `HTTP ${r.status}`;
    } catch (e) {
      ultimoErro = String(e);
    }
    await dormir(1000 * 2 ** i);
  }
  throw new Error(`falha após ${tentativas} tentativas: ${url} :: ${ultimoErro}`);
}

export async function gravarBruto(
  sb: SupabaseClient,
  fonte: string,
  endpoint: string,
  parametros: Record<string, unknown>,
  status: number,
  corpo: string,
): Promise<number> {
  const { data, error } = await sb.from("bruto").insert({
    fonte,
    endpoint,
    parametros,
    status_http: status,
    sha256: await sha256(corpo),
    tamanho_bytes: new TextEncoder().encode(corpo).length,
    corpo,
  }).select("id").single();
  if (error) throw new Error(`gravarBruto: ${error.message}`);
  return data.id as number;
}

export type Execucao = {
  id: number;
  parametros: Record<string, unknown>;
  registros: number | null;
};

// Retoma a execução em andamento da fonte, ou abre uma nova se pedido.
export async function execucaoAtual(
  sb: SupabaseClient,
  fonte: string,
  iniciar: boolean,
  parametrosIniciais: Record<string, unknown>,
): Promise<Execucao | null> {
  const { data } = await sb.from("execucao_ingestao")
    .select("id, parametros, registros")
    .eq("fonte", fonte).eq("status", "em_andamento")
    .order("id", { ascending: false }).limit(1);
  if (data && data.length) return data[0] as Execucao;
  if (!iniciar) return null;
  const { data: nova, error } = await sb.from("execucao_ingestao")
    .insert({ fonte, parametros: parametrosIniciais, registros: 0 })
    .select("id, parametros, registros").single();
  if (error) throw new Error(error.message);
  return nova as Execucao;
}

export async function atualizarExecucao(
  sb: SupabaseClient,
  id: number,
  campos: Record<string, unknown>,
) {
  const { error } = await sb.from("execucao_ingestao").update(campos).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function auditar(
  sb: SupabaseClient,
  acao: string,
  entidade: string,
  detalhe: Record<string, unknown>,
) {
  await sb.from("auditoria").insert({ ator: "edge:" + entidade, acao, entidade, detalhe });
}

export function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
