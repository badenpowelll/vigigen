// Login do painel web (Supabase Auth, e-mail e senha). Cadastro é fechado:
// só entra quem tem convite. O primeiro acesso e a troca de senha esquecida
// usam um código de uso único gerado pelo administrador (Edge Function `acesso`).
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { enviar, registrar } from "./telemetria";

export interface Perfil {
  user_id: string;
  email: string;
  nome: string | null;
  administrador: boolean;
  ativo: boolean;
  vinculos: { papel: string; organizacao: string; tipo: string }[];
}

const URL_SUPABASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;

export function useSessao() {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [pronto, setPronto] = useState(!supabase);
  const [perfilDe, setPerfilDe] = useState<string | null>(null);   // de qual usuário é o perfil lido

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSessao(data.session); if (!data.session) setPronto(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSessao(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !sessao) { setPerfil(null); return; }
    let vivo = true;
    supabase.rpc("meu_perfil").then(({ data }) => {
      if (!vivo) return;
      const p = (data as Perfil | null) ?? null;
      // conta desativada pelo administrador: encerra a sessão que ainda estiver aberta
      if (p && !p.ativo) { void supabase?.auth.signOut(); setPerfil(null); }
      else setPerfil(p);
    }).then(() => { if (vivo) { setPronto(true); setPerfilDe(sessao.user.id); } },
            () => { if (vivo) { setPronto(true); setPerfilDe(sessao.user.id); } });
    return () => { vivo = false; };
  }, [sessao?.user.id]);

  return { sessao, perfil, pronto: pronto && (!sessao || perfilDe === sessao.user.id) };
}

export async function entrar(email: string, senha: string): Promise<string | null> {
  if (!supabase) return "Supabase não configurado neste build.";
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha });
  if (error) {
    registrar("login_falha", "login", { motivo: error.message }, email.trim().toLowerCase());
    await enviar();
    return error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : error.message;
  }
  registrar("login", "login");
  await enviar();
  return null;
}

export async function sair() {
  if (!supabase) return;
  registrar("logout", "sair");
  await enviar();
  await supabase.auth.signOut();
}

/** Primeiro acesso ou senha esquecida: e-mail + código do administrador + nova senha. */
export async function usarCodigo(email: string, codigo: string, senha: string): Promise<string | null> {
  if (!URL_SUPABASE) return "Supabase não configurado neste build.";
  try {
    const r = await fetch(`${URL_SUPABASE}/functions/v1/acesso`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, codigo, senha }),
    });
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) return corpo.erro ?? `Falha (${r.status}).`;
    return null;
  } catch (e) {
    return `Sem conexão com o servidor: ${(e as Error).message}`;
  }
}

export async function trocarSenha(nova: string): Promise<string | null> {
  if (!supabase) return "Supabase não configurado neste build.";
  if (nova.length < 10) return "A senha precisa ter pelo menos 10 caracteres.";
  const { error } = await supabase.auth.updateUser({ password: nova });
  if (error) return error.message;
  registrar("acao", "trocou a própria senha");
  return null;
}
