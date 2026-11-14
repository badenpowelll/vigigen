-- Complementos do esquema mínimo para rodar tests/test_acesso_indevido.sql num
-- Postgres local (aplicado logo depois de FIXTURE_esquema_minimo.sql).
-- Só para testes: nada aqui roda em produção. Nenhum dado é inserido.
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
alter table public.auditoria add column if not exists entidade_id text;
alter table auth.users add column if not exists email_confirmed_at timestamptz;
-- privilégios padrão do Supabase (leitura liberada; quem filtra é a RLS).
-- Rodar por último, depois das migrações, como no banco real.
grant usage on schema public, app, auth to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
