// Sincronização manual (botão "Sincronizar"): pede ao banco que rode agora as
// mesmas cargas do agendamento automático (migração 021). O navegador nunca
// fala com as APIs externas nem guarda chave de serviço: só chama funções do
// banco, que conferem a permissão e disparam as Edge Functions pelo pg_net.
import { sincronizacaoConector, type ErroFonte, type Origem } from "./fonte";
import { viaSupabase } from "./supabase";

export type EstadoItem = "pendente" | "disparado" | "ok" | "vazio" | "erro";

export interface ItemSincronizacao {
  tarefa: string;
  fonte: string;
  agravo: string | null;
  estado: EstadoItem;
  disparado_em?: string | null;
  finalizado_em?: string | null;
  execucao_id?: number | null;
  registros?: number | null;
  http_status?: number | null;
  mensagem?: string | null;
}

export interface Sincronizacao {
  id: number;
  pedido_em: string;
  origem: "web" | "conector";
  concluida_em: string | null;
  indicadores_em: string | null;
  mensagem: string | null;
  agora: string;
  itens: ItemSincronizacao[];
  aviso?: string;
}

/** Só quem pode: no conector, o dono do banco; na web, o administrador (conferido no banco). */
export async function pedirSincronizacao(origem: Origem): Promise<Sincronizacao> {
  try {
    const r = origem === "conector"
      ? await sincronizacaoConector.pedir()
      : await viaSupabase<Sincronizacao>("sincronizar_fontes");
    return r.dado as Sincronizacao;
  } catch (e) {
    throw new Error(mensagemSincronizacao(e as ErroFonte));
  }
}

export async function lerSincronizacao(origem: Origem): Promise<Sincronizacao | null> {
  try {
    const r = origem === "conector"
      ? await sincronizacaoConector.estado()
      : await viaSupabase<Sincronizacao | null>("sincronizacao_estado");
    return (r.dado as Sincronizacao | null) ?? null;
  } catch (e) {
    throw new Error(mensagemSincronizacao(e as ErroFonte));
  }
}

export function aberta(s: Sincronizacao | null): boolean {
  return !!s && !s.concluida_em;
}

export function mensagemSincronizacao(e: ErroFonte | { codigo?: string; mensagem?: string }): string {
  const m = e?.mensagem ?? "";
  if (e?.codigo === "42501" || /apenas administradores/.test(m)) return "Só administradores podem sincronizar.";
  if (e?.codigo === "PGRST202" || e?.codigo === "42883" || /does not exist|could not find the function/i.test(m))
    return "A sincronização manual ainda não está ativa no banco (migração 021 não aplicada).";
  if (/nenhuma carga agendada/.test(m)) return "O banco não tem cargas agendadas para repetir agora.";
  if (e?.codigo === "sem_conector") return "Sem conector Supabase nesta visualização.";
  return `O banco recusou o pedido: ${m || e?.codigo || "erro desconhecido"}.`;
}

const FONTE: Record<string, string> = {
  infodengue: "InfoDengue",
  genbank: "GenBank",
  ibge: "IBGE",
  sinan: "SINAN",
  cnes: "CNES",
};
const AGRAVO: Record<string, string> = { dengue: "dengue", chikungunya: "chikungunya", zika: "Zika" };

export function rotuloItem(i: ItemSincronizacao): string {
  const f = FONTE[i.fonte] ?? i.fonte;
  return i.agravo ? `${f} · ${AGRAVO[i.agravo] ?? i.agravo}` : f;
}

export const ROTULO_ESTADO: Record<EstadoItem, string> = {
  pendente: "Na fila",
  disparado: "Carregando",
  ok: "Atualizado",
  vazio: "Sem novidade",
  erro: "Falhou",
};
