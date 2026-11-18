// De onde o painel lê os dados, em ordem de preferência:
// 1. "conector": dentro do claude.ai, pelo conector Supabase do próprio
//    visitante (capacidade `mcp`), chamando as funções painel_* — dado ao vivo.
// 2. "supabase": painel publicado na web, com login (supabase-js + RLS).
// 3. "retrato": cópia embutida no build, com a data em que foi tirada.
// Em todos os casos o dado vem do banco do VigiGen; nada é gerado aqui.
import type { Doenca, Malha, Resumo, Retrato, Semana, Serie } from "./tipos";

export const PROJETO_SUPABASE = "tizmhihnggbvjzsmnpne";
export const SERVIDOR_MCP = "Supabase";
export const FERRAMENTA_MCP = "execute_sql";

export type Origem = "conector" | "supabase" | "retrato";

export interface ErroFonte { codigo: string; mensagem: string }

const retratos = import.meta.glob("./retrato.json", { eager: true, import: "default" }) as Record<string, Retrato>;
export const RETRATO: Retrato | null = retratos["./retrato.json"] ?? null;

type ChamadaMcp = {
  callTool: (s: string, t: string, i: unknown, o?: unknown) => Promise<{ payload?: unknown; cache?: { storedAt: number } }>;
};

let mcpPromessa: Promise<ChamadaMcp | null> | null = null;
export function obterMcp(): Promise<ChamadaMcp | null> {
  if (mcpPromessa) return mcpPromessa;
  const w = window as unknown as { claude?: { use: (n: string) => Promise<unknown> } };
  mcpPromessa = w.claude?.use ? (w.claude.use("mcp") as Promise<ChamadaMcp | null>).catch(() => null) : Promise.resolve(null);
  return mcpPromessa;
}

// O execute_sql devolve o resultado dentro de um envelope de texto; extraímos o JSON.
// O texto de introdução cita a própria etiqueta <untrusted-data-…> antes do bloco,
// então o JSON é o que fica entre a ÚLTIMA abertura e o fechamento.
export function extrairLinhas(payload: unknown): unknown {
  let texto: string;
  if (typeof payload === "string") texto = payload;
  else if (payload && typeof payload === "object" && "result" in payload) texto = String((payload as { result: unknown }).result);
  else return payload;
  const fecho = texto.match(/<\/(untrusted-data-[A-Za-z0-9-]+)>/);
  let corpo = texto;
  if (fecho && fecho.index !== undefined) {
    const abertura = `<${fecho[1]}>`;
    const ini = texto.lastIndexOf(abertura, fecho.index);
    if (ini >= 0) corpo = texto.slice(ini + abertura.length, fecho.index);
  }
  try {
    return JSON.parse(corpo.trim());
  } catch {
    throw { codigo: "resposta_inesperada", mensagem: corpo.trim().slice(0, 300) } as ErroFonte;
  }
}

function literal(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v));
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/** fresco: ignora o cache do runtime (usado depois de uma sincronização manual). */
export async function viaConector<T>(funcao: string, args: unknown[] = [], fresco = false): Promise<{ dado: T; em: number }> {
  if (!/^painel_[a-z_]+$/.test(funcao)) throw { codigo: "bad_request", mensagem: "função inválida" } as ErroFonte;
  return executarConector<T>(`select public.${funcao}(${args.map(literal).join(", ")}) as r`,
    { cache: { staleTime: fresco ? 0 : 120_000, gcTime: 3_600_000 } });
}

// Sincronização manual pelo conector (migração 022). Consultas fixas, sem
// parâmetro vindo da tela; as funções ficam no esquema app, fora da API pública.
export const sincronizacaoConector = {
  pedir: () => executarConector<unknown>("select app.sincronizar_pedir('conector', 'conector:' || session_user) as r"),
  estado: () => executarConector<unknown>("select app.sincronizacao_json(null) as r"),
};

async function executarConector<T>(query: string, opcoes?: unknown): Promise<{ dado: T; em: number }> {
  const mcp = await obterMcp();
  if (!mcp) throw { codigo: "sem_conector", mensagem: "Conector indisponível nesta visualização" } as ErroFonte;
  const chamar = () => (opcoes === undefined
    ? mcp.callTool(SERVIDOR_MCP, FERRAMENTA_MCP, { project_id: PROJETO_SUPABASE, query })
    : mcp.callTool(SERVIDOR_MCP, FERRAMENTA_MCP, { project_id: PROJETO_SUPABASE, query }, opcoes));
  let res: Awaited<ReturnType<typeof chamar>>;
  try {
    res = await chamar();
  } catch (e) {
    const err = e as { code?: string; message?: string; retryable?: boolean; retryAfterMs?: number };
    // Leitura: uma única nova tentativa, só quando o próprio runtime marca o erro como repetível.
    if (err.retryable) {
      await new Promise((r) => setTimeout(r, Math.min(err.retryAfterMs ?? 1500, 60_000) + Math.random() * 500));
      try { res = await chamar(); } catch (e2) {
        const er2 = e2 as { code?: string; message?: string };
        throw { codigo: er2.code ?? "upstream_error", mensagem: er2.message ?? String(e2) } as ErroFonte;
      }
    } else {
      throw { codigo: err.code ?? "upstream_error", mensagem: err.message ?? String(e) } as ErroFonte;
    }
  }
  const linhas = extrairLinhas(res.payload) as { r: T }[];
  if (!Array.isArray(linhas) || !linhas[0] || !("r" in linhas[0]))
    throw { codigo: "resposta_inesperada", mensagem: JSON.stringify(linhas).slice(0, 300) } as ErroFonte;
  return { dado: linhas[0].r, em: res.cache?.storedAt ?? Date.now() };
}

export const consultas = {
  resumo: (fresco = false) => viaConector<Resumo>("painel_resumo", [], fresco),
  malha: (fresco = false) => viaConector<Malha>("painel_malha", [], fresco),
  semana: (d: Doenca, fresco = false) => viaConector<Semana>("painel_semana", [d], fresco),
  serie: (g: number | null, d: Doenca, desde = 202001, fresco = false) => viaConector<Serie>("painel_serie", [g, d, desde], fresco),
};

export function mensagemErro(e: ErroFonte): string {
  switch (e.codigo) {
    case "server_not_connected": return "Adicione o conector Supabase em claude.ai → Configurações → Conectores para ver o dado ao vivo.";
    case "needs_reauth": return "Reconecte o Supabase em claude.ai → Configurações → Conectores.";
    case "selection_required": return "Escolha qual conector Supabase usar no aviso do claude.ai.";
    case "not_in_manifest":
    case "approval_required":
    case "consent_required": return "O acesso ao Supabase não foi permitido para esta página. Mostrando o retrato embutido.";
    case "blocked_by_policy": return "A política da organização bloqueia o conector Supabase aqui.";
    case "server_unavailable": return "O Supabase não respondeu agora. Mostrando a última leitura.";
    case "tool_error": return "O Supabase recusou a consulta. Mostrando o retrato embutido.";
    case "resposta_inesperada": return "O Supabase respondeu num formato que o painel não reconheceu. Mostrando o retrato embutido.";
    case "sem_conector": return "Sem conector nesta visualização. Mostrando o retrato embutido.";
    default: return `Falha ao ler o banco (${e.codigo}). Mostrando o retrato embutido.`;
  }
}
