-- Esquema mínimo para testar migrações SQL num Postgres local (sem PostGIS,
-- pg_cron e Supabase). Colunas copiadas do banco de produção em 14/11/2026.
-- Só para testes: nada aqui roda em produção.
create schema if not exists app;
create schema if not exists cron;
create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (n, s, c)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create function cron.unschedule(n text) returns boolean language sql as $$
  delete from cron.job where jobname = n returning true $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create function app.trimestre(d date) returns text language sql immutable set search_path = '' as $$
  select extract(year from d)::int || 'T' || extract(quarter from d)::int; $$;
create function app.coleta_tem_dia(t text) returns boolean language sql immutable set search_path = '' as $$
  select t ~ '^\d{4}-\d{2}-\d{2}$' or t ~* '^\d{1,2}-[a-z]{3}-\d{4}$'; $$;
create table public.municipio (geocodigo integer primary key, nome text, uf text);
create table public.sequencia (accession text primary key, organismo text, sorotipo_declarado text,
  data_coleta text, data_coleta_inicio date, data_publicacao date,
  geocodigo integer references public.municipio(geocodigo), uf_inferida text, pais text,
  geo_loc_bruto text, hospedeiro text, tamanho integer, titulo text, sequencia_fasta text,
  fonte text, bruto_id bigint, ingerido_em timestamptz default now(), rn_por_nome_cepa boolean not null default false);
create table public.caso_semanal (geocodigo integer, doenca text, semana_epidemiologica integer,
  data_inicio_se date, casos integer);
create table public.indicador (id bigint generated always as identity primary key,
  geocodigo integer references public.municipio(geocodigo), nivel text not null, periodo text not null,
  tipo text not null, valor numeric, numerador numeric, denominador numeric, motivo_nulo text,
  detalhe jsonb not null default '{}', calculado_em timestamptz not null default now(),
  constraint indicador_geocodigo_nivel_periodo_tipo_key unique nulls not distinct (geocodigo, nivel, periodo, tipo));
create table public.alerta (id uuid primary key default gen_random_uuid(), geocodigo integer, tipo text,
  periodo_deteccao text, evidencia jsonb, status text default 'novo', revisado_em timestamptz,
  criado_em timestamptz default now());
create table public.execucao_ingestao (id bigint generated always as identity primary key, fonte text,
  parametros jsonb, iniciado_em timestamptz default now(), finalizado_em timestamptz, status text, registros integer);
create table public.classificacao (accession text primary key references public.sequencia(accession), sorotipo text);
create table public.exclusao_qc (id bigint generated always as identity, accession text, motivo text);
create table public.auditoria (id bigint generated always as identity, ator text, acao text, entidade text,
  detalhe jsonb, ocorrido_em timestamptz default now());
select cron.schedule('vigigen-diario-genbank', '0 10 * * *', $$select 1$$);
