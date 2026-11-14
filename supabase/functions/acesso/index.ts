// VigiGen — primeiro acesso e redefinição de senha por código de uso único.
//
// O administrador gera um código no menu Administração (public.admin_convidar
// ou public.admin_codigo_redefinicao). A pessoa informa e-mail, código e a
// senha que ela mesma escolheu. Esta função confere o código no banco
// (public.liberar_convite, que conta tentativas e só guarda o hash) e cria a
// conta ou troca a senha com a service role. Não envia e-mail e não grava
// senha em lugar nenhum além do próprio Supabase Auth.
// verify_jwt = false: quem chama ainda não tem conta. Por isso cada chamada
// passa por public.acesso_pode_tentar (migração 021): até 10 tentativas por IP
// e 5 falhas por e-mail a cada 15 min, e toda tentativa fica registrada em
// public.acesso_tentativa (só o administrador lê; retenção de 90 dias).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

// IP de quem chama, pelos cabeçalhos do proxy do Supabase (o primeiro de x-forwarded-for).
function ipDe(req: Request): string {
  const h = req.headers;
  return (h.get("cf-connecting-ip") ?? h.get("x-real-ip") ?? (h.get("x-forwarded-for") ?? "").split(",")[0]).trim()
    || "desconhecido";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "use POST" }, 405);

  const corpo = await req.json().catch(() => ({}));
  const email = typeof corpo.email === "string" ? corpo.email.trim().toLowerCase() : "";
  const codigo = typeof corpo.codigo === "string" ? corpo.codigo.trim() : "";
  const senha = typeof corpo.senha === "string" ? corpo.senha : "";
  if (!email || !codigo) return json({ erro: "informe e-mail e código" }, 400);
  if (senha.length < 10 || senha.length > 72) return json({ erro: "a senha precisa ter entre 10 e 72 caracteres" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // limite de frequência antes de qualquer consulta ao convite
  const { data: lim, error: eLim } = await sb.rpc("acesso_pode_tentar", { p_ip: ipDe(req), p_email: email });
  if (eLim) return json({ erro: "não foi possível conferir o limite de tentativas" }, 503);
  if (!lim?.ok) {
    const espera = Number(lim?.espera_s) || 900;
    return new Response(JSON.stringify({ erro: `Muitas tentativas. Tente de novo em ${Math.ceil(espera / 60)} min.` }), {
      status: 429, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Retry-After": String(espera) },
    });
  }
  const tentativa = lim.id as number;
  const resultado = async (r: "ok" | "recusado" | "erro", detalhe?: string) => {
    await sb.rpc("acesso_registrar_resultado", { p_id: tentativa, p_resultado: r, p_detalhe: detalhe ?? null });
  };

  const { data: lib, error } = await sb.rpc("liberar_convite", { p_email: email, p_codigo: codigo });
  if (error) { await resultado("erro", "liberar_convite"); return json({ erro: "não foi possível conferir o convite" }, 500); }
  if (!lib?.ok) { await resultado("recusado", lib?.motivo); return json({ erro: lib?.motivo ?? "convite inválido" }, 403); }

  if (lib.tipo === "cadastro") {
    const { error: e } = await sb.auth.admin.createUser({ email, password: senha, email_confirm: true });
    if (e) { await resultado("erro", "createUser: " + e.message); return json({ erro: e.message }, 400); }
  } else {
    if (!lib.user_id) { await resultado("recusado", "conta inexistente"); return json({ erro: "conta não encontrada para este e-mail" }, 404); }
    const { error: e } = await sb.auth.admin.updateUserById(lib.user_id, { password: senha });
    if (e) { await resultado("erro", "updateUser: " + e.message); return json({ erro: e.message }, 400); }
    await sb.rpc("concluir_convite", { p_email: email });
  }
  await resultado("ok", lib.tipo);
  return json({ ok: true, tipo: lib.tipo });
});
