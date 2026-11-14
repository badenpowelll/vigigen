-- Stubs mínimos para aplicar a migração 011 real (PR #1) sobre o esquema mínimo,
-- e depois 012, 013, 015 e 016, na ordem em que iriam para produção.
-- Só para testes: nada aqui roda em produção. Nenhum dado é inserido.
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text,
  banned_until timestamptz, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}',
  created_at timestamptz default now(), last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;
create table if not exists public.bruto (id bigint generated always as identity primary key, fonte text,
  coletado_em timestamptz default now(), resposta jsonb);
-- colunas de 001_schema.sql
create table public.organizacao (id uuid primary key default gen_random_uuid(), nome text not null,
  tipo text not null, geocodigo_ibge integer references public.municipio(geocodigo), uf text not null default 'RN');
create table public.usuario_organizacao (user_id uuid not null references auth.users(id) on delete cascade,
  organizacao_id uuid not null references public.organizacao(id) on delete cascade, papel text not null,
  primary key (user_id, organizacao_id));
-- função de 002_rls.sql usada pelos gatilhos de 011
create or replace function app.auditoria_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'auditoria é append-only: % não permitido', tg_op;
end $$;
