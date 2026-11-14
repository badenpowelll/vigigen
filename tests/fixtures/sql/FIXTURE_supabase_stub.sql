-- Só para testes: o mínimo do ambiente Supabase para aplicar 001–020 num
-- Postgres descartável (papéis, auth, vault, pg_cron, pg_net, schema extensions).
-- Nenhum dado real. Não usar fora de teste.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key, email text, encrypted_password text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}',
  created_at timestamptz default now(), updated_at timestamptz default now(), last_sign_in_at timestamptz,
  banned_until timestamptz, deleted_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select current_setting('request.jwt.claims', true)::jsonb->>'role' $$;
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb $$;
grant usage on schema auth, extensions to anon, authenticated, service_role;
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (name text, decrypted_secret text);
create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
create table if not exists cron.job_run_details (runid bigserial, jobid bigint, status text, return_message text, start_time timestamptz, end_time timestamptz);
create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as
  $$ insert into cron.job (jobname, schedule, command) values (n, s, c)
     on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create or replace function cron.unschedule(n text) returns boolean language sql as
  $$ with d as (delete from cron.job where jobname = n returning 1) select exists (select 1 from d) $$;
create schema if not exists net;
create table if not exists net._http_response (id bigint, status_code int, content text, created timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
  headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;
create or replace function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}',
  timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;
