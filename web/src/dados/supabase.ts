// Painel publicado na web: Supabase Auth + RPC. O RLS do banco faz o recorte
// territorial; a interface também esconde o que o papel não pode ver.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const CHAVE = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// O artefato do claude.ai nunca usa supabase-js (CSP), mesmo que haja .env.
export const supabase: SupabaseClient | null =
  URL && CHAVE && import.meta.env.MODE !== "artefato" ? createClient(URL, CHAVE) : null;

export async function viaSupabase<T>(funcao: string, args: Record<string, unknown> = {}): Promise<{ dado: T; em: number }> {
  if (!supabase) throw { codigo: "sem_supabase", mensagem: "Supabase não configurado" };
  const { data, error } = await supabase.rpc(funcao, args);
  if (error) throw { codigo: error.code ?? "erro", mensagem: error.message };
  return { dado: data as T, em: Date.now() };
}

export async function papelDoUsuario(): Promise<{ papel: string; organizacao: string; tipo: string } | null> {
  if (!supabase) return null;
  const { data } = await supabase.from("usuario_organizacao").select("papel, organizacao(nome, tipo)").limit(1);
  const linha = data?.[0] as unknown as { papel: string; organizacao: { nome: string; tipo: string } } | undefined;
  return linha ? { papel: linha.papel, organizacao: linha.organizacao.nome, tipo: linha.organizacao.tipo } : null;
}

export async function revisarAlerta(id: string, status: "confirmado" | "descartado" | "em_analise") {
  if (!supabase) throw new Error("Supabase não configurado");
  const { error } = await supabase.from("alerta").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
}
