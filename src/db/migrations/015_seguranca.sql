-- VigiGen — 015: endurecimento de permissões (achados da varredura de 14/11/2026).
--
-- NÃO APLICADA EM PRODUÇÃO. Aplicar só com autorização expressa. Depende da
-- 011_administracao.sql (PR #1), que já está aplicada no banco.
--
-- Achados (consulta só leitura a information_schema e pg_policies, 14/11/2026):
--  1. "authenticated" tem INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES e TRIGGER
--     em 12 tabelas públicas. As políticas de RLS barram INSERT/UPDATE/DELETE,
--     mas RLS não cobre TRUNCATE. A única escrita legítima do painel é
--     UPDATE(status) em alerta (política alerta_revisao).
--  2. registrar_eventos aceita chamada sem login com até 100 eventos
--     "login_falha" por chamada e sem limite de frequência.
--  3. Proteção contra senhas vazadas desligada no Auth: é configuração do
--     painel do Supabase (Authentication > Providers > Email > "Prevent use of
--     leaked passwords"), não SQL. Fica no checklist de implantação.

-- 1) Só leitura para anon/authenticated; a revisão de alerta continua por coluna.
do $$
declare t text;
begin
  foreach t in array array['alerta','auditoria','bruto','caso_semanal','classificacao',
    'exclusao_qc','execucao_ingestao','indicador','municipio','organizacao',
    'sequencia','usuario_organizacao'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;
grant update (status) on public.alerta to authenticated;
-- tabelas criadas depois desta migração não herdam escrita
alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon, authenticated;

-- 2) registrar_eventos: sem login, no máximo 1 evento por chamada e 20 falhas de
-- login por IP a cada 10 minutos; acima disso a chamada é ignorada (retorna 0).
create index if not exists evento_uso_ip_tempo on public.evento_uso (ip, ocorrido_em desc)
  where user_id is null;

create or replace function public.registrar_eventos(p_eventos jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  mail text;
  v_ip text := coalesce(app.cabecalho('cf-connecting-ip'), app.cabecalho('x-real-ip'),
                      btrim(split_part(app.cabecalho('x-forwarded-for'), ',', 1)));
  pais text := app.cabecalho('cf-ipcountry');
  ua text := left(app.cabecalho('user-agent'), 400);
  e jsonb;
  n integer := 0;
begin
  if jsonb_typeof(p_eventos) <> 'array' or jsonb_array_length(p_eventos) > 100 then
    raise exception 'esperado um array de até 100 eventos';
  end if;
  if uid is null then
    if jsonb_array_length(p_eventos) > 1 then
      raise exception 'sem login, só um evento por chamada';
    end if;
    if v_ip is null or (select count(*) from public.evento_uso
                      where evento_uso.user_id is null and evento_uso.ip = v_ip
                        and evento_uso.ocorrido_em > now() - interval '10 minutes') >= 20 then
      return 0;
    end if;
  else
    select email into mail from public.perfil where user_id = uid;
  end if;
  for e in select * from jsonb_array_elements(p_eventos) loop
    continue when coalesce(e ->> 'tipo', '') not in ('sessao','login','login_falha','logout','navegacao','clique','acao','erro');
    continue when uid is null and (e ->> 'tipo') <> 'login_falha';
    continue when length(coalesce(e ->> 'detalhe', '')) > 4000;
    insert into public.evento_uso (ocorrido_em, user_id, email, sessao, tipo, alvo, rota, detalhe, ip, pais, user_agent)
    values (
      case when (e ->> 'em') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$'
           then case when abs(extract(epoch from now() - (e ->> 'em')::timestamptz)) < 600
                     then (e ->> 'em')::timestamptz else now() end
           else now() end,
      uid,
      coalesce(mail, case when uid is null then lower(left(e ->> 'email', 200)) end),
      left(e ->> 'sessao', 64), e ->> 'tipo', left(e ->> 'alvo', 200), left(e ->> 'rota', 200),
      coalesce(e -> 'detalhe', '{}'::jsonb), v_ip, pais, ua);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.registrar_eventos(jsonb) from public;
grant execute on function public.registrar_eventos(jsonb) to anon, authenticated;

-- 3) convite: RLS ligada e nenhuma política é intencional (acesso só pelas
-- funções admin_*, security definer). Documentado aqui para a auditoria.
comment on table public.convite is 'RLS sem políticas de propósito: acesso só pelas funções admin_* (security definer).';

-- Reversão:
--   grant insert, update, delete, truncate, references, trigger on <tabelas> to authenticated;
--   reaplicar registrar_eventos de 011_administracao.sql; drop index public.evento_uso_ip_tempo;
