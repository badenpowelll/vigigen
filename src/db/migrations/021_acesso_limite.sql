-- VigiGen — 021: limite de tentativas e registro na Edge Function `acesso`
-- (primeiro acesso e redefinição de senha por código). Auditoria de 14/11/2026:
-- o endpoint é público por desenho (quem chama ainda não tem conta), então
-- precisa de limite de frequência e de trilha.
--
-- NÃO APLICADA EM PRODUÇÃO. Aplicar só com autorização expressa do Baden.
-- Depende da 011_administracao.sql (app.eh_admin, public.convite).
--
-- Regras (janela de 15 minutos):
--   * por IP: até 10 tentativas, de qualquer resultado;
--   * por e-mail: até 5 tentativas que não deram certo.
-- Acima disso a função responde 429 sem consultar o convite. Isso soma com o
-- bloqueio que já existe no convite (10 códigos errados bloqueiam o convite).
--
-- LGPD: guarda IP e e-mail só para segurança do acesso; nenhum código nem senha.
-- Linhas com mais de 90 dias são apagadas pela própria função a cada chamada.
-- Só o administrador lê a tabela.

create table if not exists public.acesso_tentativa (
  id           bigint generated always as identity primary key,
  ocorrido_em  timestamptz not null default now(),
  ip           text not null,
  email        text not null,
  resultado    text not null default 'pendente'
               check (resultado in ('pendente','ok','recusado','bloqueado_taxa','erro')),
  detalhe      text
);
create index if not exists acesso_tentativa_ip_tempo on public.acesso_tentativa (ip, ocorrido_em desc);
create index if not exists acesso_tentativa_email_tempo on public.acesso_tentativa (email, ocorrido_em desc);

alter table public.acesso_tentativa enable row level security;
revoke all on public.acesso_tentativa from anon, authenticated;
grant select on public.acesso_tentativa to authenticated;
drop policy if exists acesso_tentativa_admin on public.acesso_tentativa;
create policy acesso_tentativa_admin on public.acesso_tentativa
  for select to authenticated using (app.eh_admin());

-- Confere o limite e já registra a tentativa. Devolve {ok, id} ou {ok:false, espera_s}.
create or replace function public.acesso_pode_tentar(p_ip text, p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip text := coalesce(nullif(left(btrim(p_ip), 64), ''), 'desconhecido');
  v_email text := lower(left(btrim(coalesce(p_email, '')), 200));
  janela constant interval := interval '15 minutes';
  n_ip int; n_email int; mais_antiga timestamptz; v_id bigint;
begin
  delete from public.acesso_tentativa where ocorrido_em < now() - interval '90 days';

  select count(*) into n_ip from public.acesso_tentativa
   where ip = v_ip and ocorrido_em > now() - janela and resultado <> 'bloqueado_taxa';
  select count(*) into n_email from public.acesso_tentativa
   where email = v_email and ocorrido_em > now() - janela and resultado in ('pendente','recusado','erro');

  if n_ip >= 10 or n_email >= 5 then
    select min(ocorrido_em) into mais_antiga from public.acesso_tentativa
     where (ip = v_ip or email = v_email) and ocorrido_em > now() - janela and resultado <> 'bloqueado_taxa';
    insert into public.acesso_tentativa (ip, email, resultado, detalhe)
    values (v_ip, v_email, 'bloqueado_taxa', case when n_ip >= 10 then 'limite por IP' else 'limite por e-mail' end);
    return jsonb_build_object('ok', false,
      'espera_s', greatest(60, ceil(extract(epoch from (mais_antiga + janela) - now()))::int));
  end if;

  insert into public.acesso_tentativa (ip, email) values (v_ip, v_email) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.acesso_registrar_resultado(p_id bigint, p_resultado text, p_detalhe text default null)
returns void language sql security definer set search_path = '' as $$
  update public.acesso_tentativa
     set resultado = p_resultado, detalhe = left(p_detalhe, 300)
   where id = p_id and resultado = 'pendente';
$$;

revoke all on function public.acesso_pode_tentar(text, text) from public, anon, authenticated;
revoke all on function public.acesso_registrar_resultado(bigint, text, text) from public, anon, authenticated;
grant execute on function public.acesso_pode_tentar(text, text) to service_role;
grant execute on function public.acesso_registrar_resultado(bigint, text, text) to service_role;

comment on table public.acesso_tentativa is
  'Tentativas na Edge Function acesso (primeiro acesso/redefinição). IP e e-mail por segurança (LGPD: retenção 90 dias). Só administrador lê.';

-- Reversão:
--   drop function public.acesso_registrar_resultado(bigint, text, text);
--   drop function public.acesso_pode_tentar(text, text);
--   drop table public.acesso_tentativa;
--   e republicar a versão anterior de supabase/functions/acesso.
