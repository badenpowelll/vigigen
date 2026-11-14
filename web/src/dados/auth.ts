// Login do painel web (Supabase Auth, e-mail e senha). Cadastro é fechado:
// só entra quem tem convite. O primeiro acesso e a troca de senha esquecida
// usam um código de uso único gerado pelo administrador (Edge Function `acesso`).
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { enviar, registrar } from "./telemetria";
import { situacaoDoPerfil, type Perfil, type Situacao } from "./situacao";

export type { Perfil, Situacao };


const URL_SUPABASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;

export function useSessao() {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [lida, setLida] = useState(!supabase);   // getSession já respondeu
  const [situacao, setSituacao] = useState<Situacao>(supabase ? "carregando" : "ok");
  const [perfilDe, setPerfilDe] = useState<string | null>(null);   // de qual usuário é a situação lida
  const [tentativa, setTentativa] = useState(0);
  const [desativada, setDesativada] = useState(false);   // sessão encerrada por conta desativada

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSessao(data.session); setLida(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSessao(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !sessao) { setPerfil(null); setPerfilDe(null); return; }
    let vivo = true;
    const uid = sessao.user.id;
    supabase.rpc("meu_perfil").then(({ data, error }) => {
      if (!vivo) return;
      const p = error ? null : ((data as Perfil | null) ?? null);
      const s = situacaoDoPerfil(p, !!error);
      if (s === "desativado") { setDesativada(true); void supabase?.auth.signOut(); }   // encerra a sessão aberta
      setPerfil(s === "ok" ? p : null);
      setSituacao(s);
      setPerfilDe(uid);
    }, () => {
      if (!vivo) return;
      setPerfil(null); setSituacao("erro"); setPerfilDe(uid);
    });
    return () => { vivo = false; };
  }, [sessao?.user.id, tentativa]);

  let atual: Situacao;
  if (!supabase) atual = "ok";
  else if (!lida) atual = "carregando";
  else if (!sessao) atual = desativada ? "desativado" : "sem_sessao";   // mostra o motivo, não só o login
  else if (perfilDe !== sessao.user.id) atual = "carregando";
  else atual = situacao;

  return {
    sessao, perfil: atual === "ok" ? perfil : null, situacao: atual,
    pronto: atual !== "carregando",
    tentarDeNovo: () => { setDesativada(false); setPerfilDe(null); setTentativa((n) => n + 1); },
  };
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
