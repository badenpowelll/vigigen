-- Teste das migrações 014 (procedência do IBGE) e 015 (permissões) com
-- registros FIXTURE_ (fictícios, só para teste). Roda depois de
-- FIXTURE_esquema_minimo.sql e FIXTURE_teste_013.sql, num Postgres descartável.
\set ON_ERROR_STOP on

-- Stubs mínimos de PostGIS (sem a extensão): geometria vira texto e as funções
-- só marcam o que foi feito, para conferir que a simplificada vem da geometria nova.
create schema if not exists extensions;
create function extensions.ST_GeomFromGeoJSON(t text) returns text language sql immutable as $$ select t $$;
create function extensions.ST_SetSRID(g text, s int) returns text language sql immutable as $$ select g $$;
create function extensions.ST_Multi(g text) returns text language sql immutable as $$ select g $$;
create function extensions.ST_SimplifyPreserveTopology(g text, tol float8) returns text language sql immutable as $$ select 'simpl(' || g || ')' $$;
alter table public.municipio add column mesorregiao text, add column microrregiao text,
  add column geometria text, add column geometria_simplificada text,
  add column ano_referencia_malha integer, add column fonte text, add column ingerido_em timestamptz;
create table public.bruto (id bigint primary key, corpo text);

-- estado de produção antes da correção: malha BC250 com ano 2025
update public.municipio set geometria = 'BC250', geometria_simplificada = 'simpl(BC250)',
  ano_referencia_malha = 2025, fonte = 'IBGE GeoServer CCAR:BC250_2025_lml_municipio_a';
insert into public.municipio (geocodigo, nome, uf, geometria, geometria_simplificada, ano_referencia_malha, fonte)
values (2400208, 'FIXTURE_Acu', 'RN', 'BC250-acu', 'simpl(BC250-acu)', 2025, 'IBGE GeoServer CCAR:BC250_2025_lml_municipio_a');
insert into public.bruto values
  (1, '[{"id": 2408102, "nome": "FIXTURE_Natal", "microrregiao": {"nome": "FIXTURE_micro", "mesorregiao": {"nome": "FIXTURE_meso"}}},
        {"id": 2400208, "nome": "FIXTURE_Acu", "microrregiao": {"nome": "FIXTURE_micro2", "mesorregiao": {"nome": "FIXTURE_meso"}}}]'),
  -- a malha nova só traz Natal: Açu precisa manter a geometria e a fonte antigas
  (2, '{"features": [{"properties": {"codarea": "2408102"}, "geometry": {"type": "MultiPolygon", "coordinates": []}}]}');

\i src/db/migrations/014_procedencia_ibge.sql

do $$
declare m record;
begin
  assert public.ingest_ibge(1, 2) = 2, 'duas linhas';
  select * into m from public.municipio where geocodigo = 2408102;
  assert m.fonte = 'IBGE Localidades v1 + Malhas v3 (qualidade mínima)', 'fonte natal: ' || m.fonte;
  assert m.ano_referencia_malha is null, 'ano não inventado';
  assert m.geometria like '{"type"%' and m.geometria_simplificada = 'simpl(' || m.geometria || ')', 'simplificada da geometria nova';
  assert m.mesorregiao = 'FIXTURE_meso', 'meso';
  select * into m from public.municipio where geocodigo = 2400208;
  assert m.geometria = 'BC250-acu' and m.geometria_simplificada = 'simpl(BC250-acu)' and m.ano_referencia_malha = 2025, 'açu mantém malha antiga';
  assert m.fonte like 'IBGE GeoServer CCAR:BC250_2025_lml_municipio_a (nomes: IBGE Localidades v1)', 'açu fonte: ' || m.fonte;
  raise notice 'OK: migração 014 passou em todos os testes';
end $$;

-- Stubs do Supabase e da 011 (PR #1) para a 015
create schema if not exists auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;
create function app.cabecalho(n text) returns text language sql stable as $$ select nullif(current_setting('teste.h_' || replace(n, '-', '_'), true), '') $$;
create table public.perfil (user_id uuid primary key, email text);
create table public.convite (id bigint primary key);
create table public.evento_uso (id bigint generated always as identity, ocorrido_em timestamptz, user_id uuid, email text,
  sessao text, tipo text, alvo text, rota text, detalhe jsonb, ip text, pais text, user_agent text);
create table public.organizacao (id int); create table public.usuario_organizacao (id int);
grant usage on schema public, app, auth to anon, authenticated;
grant all on all tables in schema public to authenticated;   -- reproduz o estado de produção
alter table public.alerta enable row level security;
create policy alerta_revisao on public.alerta for update to authenticated using (true) with check (true);
create policy alerta_ler on public.alerta for select to authenticated using (true);

\i src/db/migrations/015_seguranca.sql

do $$
declare n int; ok boolean;
begin
  -- 1) sem escrita fora de alerta.status
  assert not has_table_privilege('authenticated', 'public.alerta', 'TRUNCATE'), 'truncate alerta';
  assert not has_table_privilege('authenticated', 'public.bruto', 'INSERT'), 'insert bruto';
  assert not has_table_privilege('authenticated', 'public.sequencia', 'DELETE'), 'delete sequencia';
  assert has_table_privilege('authenticated', 'public.municipio', 'SELECT'), 'select mantido';
  assert has_column_privilege('authenticated', 'public.alerta', 'status', 'UPDATE'), 'revisão mantida';
  assert not has_column_privilege('authenticated', 'public.alerta', 'evidencia', 'UPDATE'), 'evidência travada';

  -- 2) registrar_eventos sem login
  perform set_config('teste.uid', '', false);
  perform set_config('teste.h_x_real_ip', '203.0.113.9', false);   -- IP de documentação (RFC 5737)
  begin
    perform public.registrar_eventos('[{"tipo":"login_falha"},{"tipo":"login_falha"}]');
    ok := false;
  exception when others then ok := true;
  end;
  assert ok, 'lote anônimo recusado';
  for i in 1..25 loop
    n := public.registrar_eventos('[{"tipo":"login_falha","email":"fixture@example.invalid"}]');
  end loop;
  assert (select count(*) from public.evento_uso where ip = '203.0.113.9') = 20, 'limite de 20 por IP';
  assert public.registrar_eventos('[{"tipo":"clique"}]') = 0, 'anônimo só login_falha';
  -- com login, lote de até 100 continua aceito
  perform set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
  assert public.registrar_eventos('[{"tipo":"clique"},{"tipo":"navegacao"}]') = 2, 'logado aceita lote';
  raise notice 'OK: migração 015 passou em todos os testes';
end $$;

-- painel_resumo (013) só informa a detecção quando há execução registrada
do $$
begin
  assert public.painel_resumo()->'deteccao' = 'null'::jsonb or public.painel_resumo()->'deteccao' is null, 'sem detecção registrada';
  insert into public.auditoria (ator, acao, entidade, detalhe)
  values ('pipeline:deteccao', 'deteccao', 'alerta', '{"alertas_gravados": 0, "pares_abaixo_do_minimo": 3}');
  assert (public.painel_resumo()->'deteccao'->'resumo'->>'pares_abaixo_do_minimo')::int = 3, 'detecção visível';
  raise notice 'OK: painel_resumo informa a detecção';
end $$;

-- 016: SLA no painel. Stub de app.sla_sucessos igual ao da 011 (PR #1).
create function app.sla_sucessos() returns table (fonte text, em timestamptz)
language sql stable security definer set search_path = '' as $$
  select fonte, finalizado_em from public.execucao_ingestao where status in ('ok','vazio') and finalizado_em is not null
  union all select 'indicadores', ocorrido_em from public.auditoria where ator = 'sql:calcular_indicadores'
  union all select 'nextclade', ocorrido_em from public.auditoria where ator = 'pipeline:nextclade'; $$;
-- GenBank: uma carga a cada 12 h nos últimos 40 dias (sempre dentro da meta de 48 h)
insert into public.execucao_ingestao (fonte, parametros, iniciado_em, finalizado_em, status, registros)
select 'genbank', '{"termo":"FIXTURE"}', t, t, 'ok', 1
from generate_series(now() - interval '40 days', now(), interval '12 hours') t;
-- InfoDengue: uma única carga há 20 dias (fora da meta de 120 h na maior parte da janela)
insert into public.execucao_ingestao (fonte, parametros, iniciado_em, finalizado_em, status, registros)
values ('infodengue', '{}', now() - interval '20 days', now() - interval '20 days', 'ok', 1);

\i src/db/migrations/016_sla_painel.sql

do $$
declare s jsonb := public.painel_resumo()->'sla'; f jsonb;
begin
  assert (s->>'meta_cumprimento')::int = 95, 'meta 95';
  select x into f from jsonb_array_elements(s->'fontes') x where x->>'fonte' = 'genbank';
  assert (f->>'cumprimento_30d')::numeric = 100 and (f->>'atende')::boolean, 'genbank atende';
  assert (f->>'meta_horas')::numeric = 48, 'genbank diário: 48 h';
  select x into f from jsonb_array_elements(s->'fontes') x where x->>'fonte' = 'infodengue';
  assert not (f->>'atende')::boolean and (f->>'cumprimento_30d')::numeric < 95, 'infodengue não atende';
  select x into f from jsonb_array_elements(s->'fontes') x where x->>'fonte' = 'nextclade';
  assert f->'cumprimento_30d' = 'null'::jsonb and not (f->>'atende')::boolean, 'nextclade sem medição não atende';
  assert public.painel_resumo() ? 'genomica', 'resumo da 013 preservado';
  assert not has_function_privilege('anon', 'public.painel_sla()', 'execute'), 'anon sem SLA';
  raise notice 'OK: migração 016 passou em todos os testes';
end $$;
