-- Teste da migração 020 (focos) com registros FIXTURE_ (fictícios, só para teste).
-- Roda depois de FIXTURE_esquema_minimo.sql num Postgres descartável.
\set ON_ERROR_STOP on
-- stubs do que o esquema mínimo não traz (no banco real vêm da 001, 002 e 013)
create table if not exists public.bruto (id bigint generated always as identity primary key, fonte text);
create or replace function app.pode_ver_geocodigo(g integer) returns boolean language sql stable as $$ select true $$;
alter table public.alerta add column if not exists agravo text not null default 'dengue';
insert into public.municipio values (2408102, 'FIXTURE_Natal', 'RN') on conflict do nothing;

\i src/db/migrations/020_focos.sql
\i src/db/migrations/020_focos.sql

do $$
declare falhou boolean;
begin
  insert into public.exame_territorial (fonte, geocodigo, territorio_tipo, territorio_codigo, semana_epidemiologica,
    agravo, tipo_exame, resultado, qualidade_geocodigo, n)
  values ('lais_pep', 2408102, 'setor_censitario', 'FIXTURE_SETOR', 202644, 'dengue', 'ns1', 'reagente', 'logradouro', 7);
  -- célula pequena num setor é recusada
  falhou := false;
  begin
    insert into public.exame_territorial (fonte, geocodigo, territorio_tipo, territorio_codigo, semana_epidemiologica,
      agravo, tipo_exame, resultado, qualidade_geocodigo, n)
    values ('lais_pep', 2408102, 'setor_censitario', 'FIXTURE_SETOR2', 202644, 'dengue', 'ns1', 'reagente', 'logradouro', 3);
  exception when check_violation then falhou := true;
  end;
  assert falhou, 'célula pequena em setor deveria ser recusada';
  -- no nível município a contagem pequena é aceita
  insert into public.exame_territorial (fonte, geocodigo, territorio_tipo, territorio_codigo, semana_epidemiologica,
    agravo, tipo_exame, resultado, qualidade_geocodigo, n)
  values ('lais_pep', 2408102, 'municipio', '2408102', 202644, 'dengue', 'igm', 'reagente', 'nao_localizado', 2);
  -- fonte fora do contrato é recusada
  falhou := false;
  begin
    insert into public.exame_territorial (fonte, geocodigo, territorio_tipo, territorio_codigo, semana_epidemiologica,
      agravo, tipo_exame, resultado, qualidade_geocodigo, n)
    values ('FIXTURE_outra', 2408102, 'bairro', 'FIXTURE_B', 202644, 'dengue', 'ns1', 'reagente', 'bairro', 9);
  exception when check_violation then falhou := true;
  end;
  assert falhou, 'fonte fora do contrato';
  assert (select relrowsecurity from pg_class where oid = 'public.exame_territorial'::regclass), 'RLS ligada';
  assert not has_table_privilege('authenticated', 'public.exame_territorial', 'insert'), 'authenticated sem escrita';
  assert to_regclass('public.alerta_focos_episodio') is not null, 'índice de episódio';
  delete from public.exame_territorial;
  raise notice 'OK: migração 020';
end $$;
