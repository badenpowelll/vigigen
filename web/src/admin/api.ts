// Chamadas do menu Administração. Cada função do banco confere se quem chama
// é administrador (app.exigir_admin); a interface só esconde o menu.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../dados/supabase";

export async function rpc<T>(funcao: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error("Supabase não configurado");
  const { data, error } = await supabase.rpc(funcao, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Lê uma função e guarda o resultado, com recarga manual. */
export function useLeitura<T>(funcao: string, args: Record<string, unknown>) {
  const chave = JSON.stringify(args);
  const [dado, setDado] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lidoEm, setLidoEm] = useState<number | null>(null);
  const [carregando, setCarregando] = useState(true);
  const recarregar = useCallback(() => {
    setCarregando(true);
    rpc<T>(funcao, JSON.parse(chave))
      .then((d) => { setDado(d); setErro(null); setLidoEm(Date.now()); })
      .catch((e: Error) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, [funcao, chave]);
  useEffect(recarregar, [recarregar]);
  return { dado, erro, lidoEm, carregando, recarregar };
}

export interface Evento {
  id: number; ocorrido_em: string; user_id: string | null; email: string | null; sessao: string | null;
  tipo: string; alvo: string | null; rota: string | null; detalhe: Record<string, unknown>;
  ip: string | null; pais: string | null; user_agent: string | null;
}
export interface ResumoUso {
  desde: string; ate: string; por_tipo: Record<string, number>; usuarios_distintos: number; sessoes: number;
  por_dia: { dia: string; eventos: number; usuarios: number }[];
  top_alvos: { alvo: string; n: number }[];
  top_usuarios: { email: string; n: number; ultimo: string }[];
  trilha_dados: { id: number; ator: string; acao: string; entidade: string; entidade_id: string | null; ocorrido_em: string; detalhe: unknown }[];
}
export interface Sla {
  calculado_em: string;
  fontes: {
    fonte: string; rotulo: string; agenda: string; meta_horas: number; ultima_ok: string | null; idade_horas: number | null;
    dentro: boolean; ultima_falha: string | null; ultima_falha_msg: string | null; cumprimento_30d: number | null; horas_medidas_30d: number;
  }[];
  agendador: { tarefa: string; agenda: string; ativa: boolean; execucoes_7d: number; falhas_7d: number; ultima: string | null; ultimo_status: string | null; ultimo_erro: string | null }[];
  revisao_alertas: { pendentes: number; pendente_mais_antigo: string | null; mediana_horas_revisao: number | null };
}
export interface AlertaSistema { gravidade: "critico" | "aviso" | "info"; origem: string; titulo: string; detalhe: string; desde: string | null; ref?: number }
export interface Usuario {
  user_id: string; email: string; nome: string | null; administrador: boolean; ativo: boolean;
  criado_em: string; atualizado_em: string; ultimo_login: string | null; ultimo_evento: string | null; ultimo_ip: string | null;
  vinculos: { organizacao_id: string; organizacao: string; tipo: string; papel: string }[];
}
export interface Convite { email: string; tipo: string; nome: string | null; administrador: boolean; organizacao: string | null; papel: string | null; tentativas: number; criado_em: string; expira_em: string; usado_em: string | null }
export interface Organizacao { id: string; nome: string; tipo: string; geocodigo: number | null }
export interface Usuarios { usuarios: Usuario[]; convites: Convite[]; organizacoes: Organizacao[] }

export const PAPEIS: Record<string, string> = {
  gestor: "Gestor", vigilancia: "Vigilância (revisa alertas)", laboratorio: "Laboratório (revisa alertas)", leitura: "Somente leitura",
};
export const TIPOS_EVENTO: Record<string, string> = {
  sessao: "Abriu o site", login: "Login", login_falha: "Login falhou", logout: "Saiu", navegacao: "Navegação",
  clique: "Clique", acao: "Ação", erro: "Erro",
};

/** "Chrome 129 · Windows" a partir do user-agent, sem biblioteca. */
export function navegador(ua: string | null): string {
  if (!ua) return "—";
  const b = /Edg\/(\d+)/.exec(ua) ? `Edge ${/Edg\/(\d+)/.exec(ua)![1]}`
    : /OPR\/(\d+)/.exec(ua) ? `Opera ${/OPR\/(\d+)/.exec(ua)![1]}`
      : /Firefox\/(\d+)/.exec(ua) ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}`
        : /Chrome\/(\d+)/.exec(ua) ? `Chrome ${/Chrome\/(\d+)/.exec(ua)![1]}`
          : /Version\/(\d+).*Safari/.exec(ua) ? `Safari ${/Version\/(\d+)/.exec(ua)![1]}`
            : ua.split(/[ /]/)[0];
  const so = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return so ? `${b} · ${so}` : b;
}

export function baixarCsv(nome: string, linhas: Record<string, unknown>[]) {
  if (!linhas.length) return;
  const cols = Object.keys(linhas[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...linhas.map((l) => cols.map((c) => esc(l[c])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nome });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
