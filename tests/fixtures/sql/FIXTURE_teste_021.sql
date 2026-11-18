-- Teste da migração 021 (sincronização manual) num Postgres descartável.
-- Roda depois da cadeia esquema mínimo + stub de auth + 011, 012, 013, 015, 016.
-- Só para testes: nada aqui roda em produção. Os "disparos" não saem para a
-- rede: app.disparar é trocada por um stub que só grava uma resposta HTTP falsa,
-- e as execuções que as Edge Functions abririam são inseridas à mão.

-- stubs do pg_cron, pg_net e colunas de produção ausentes no esquema mínimo
alter table cron.job add column if not exists active boolean not null default true;
alter table public.execucao_ingestao add column if not exists mensagem text;
alter table public.auditoria add column if not exists entidade_id text;
create schema if not exists net;
create table net._http_response (id bigint primary key, status_code integer, content text,
  error_msg text, timed_out boolean, created timestamptz default now());
create sequence net.req;
create or replace function app.disparar(funcao text, corpo jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare r bigint := nextval('net.req');
begin
  insert into net._http_response (id, status_code, content)
  values (r, coalesce(nullif(current_setting('teste.http_' || replace(funcao, '-', '_'), true), '')::int, 200),
          'FIXTURE resposta de ' || funcao);
  return r;
end $$;

-- agendamento da 006 (InfoDengue e IBGE) + uma tarefa "continuar" que não entra no botão
select cron.schedule('vigigen-semanal-infodengue', '0 9 * * 1,4', $$select app.disparar('ingest-infodengue', '{"iniciar": true}'::jsonb)$$);
select cron.schedule('vigigen-continuar-infodengue', '*/3 * * * *', $$select app.disparar('ingest-infodengue', '{}'::jsonb)$$);
select cron.schedule('vigigen-mensal-ibge', '0 8 1 * *', $$select app.disparar('ingest-ibge', '{}'::jsonb)$$);
select cron.schedule('vigigen-indicadores', '15 */6 * * *', $$select public.calcular_indicadores()$$);

\i src/db/migrations/021_sincronizacao_manual.sql

-- usuário comum e administrador (sem o fluxo de convite da 011, que não é o alvo aqui)
alter table auth.users disable trigger user;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'FIXTURE_admin@exemplo.invalid'),
  ('00000000-0000-0000-0000-0000000000b2', 'FIXTURE_leitor@exemplo.invalid');
insert into public.perfil (user_id, email, administrador, ativo) values
  ('00000000-0000-0000-0000-0000000000a1', 'FIXTURE_admin@exemplo.invalid', true, true),
  ('00000000-0000-0000-0000-0000000000b2', 'FIXTURE_leitor@exemplo.invalid', false, true);

do $$
declare r jsonb; ok boolean := false; id1 bigint;
begin
  -- 1. não administrador é recusado
  perform set_config('teste.uid', '00000000-0000-0000-0000-0000000000b2', true);
  begin
    perform public.sincronizar_fontes();
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'leitor não pode sincronizar';

  -- 2. administrador pede: 5 tarefas de início (3 GenBank + InfoDengue + IBGE), sem "continuar"
  perform set_config('teste.uid', '00000000-0000-0000-0000-0000000000a1', true);
  perform set_config('teste.http_ingest_ibge', '500', true);       -- IBGE vai falhar
  r := public.sincronizar_fontes();
  id1 := (r->>'id')::bigint;
  assert jsonb_array_length(r->'itens') = 5, 'cinco tarefas: ' || (r->'itens')::text;
  assert not exists (select 1 from jsonb_array_elements(r->'itens') x where x->>'tarefa' like '%continuar%'), 'sem continuar';
  assert not exists (select 1 from jsonb_array_elements(r->'itens') x where x ? 'comando'), 'comando não sai para o navegador';
  -- uma por fonte: GenBank dengue, IBGE e InfoDengue disparados; chik e zika na fila
  assert (select count(*) from jsonb_array_elements(r->'itens') x where x->>'estado' = 'disparado') = 3, 'três disparos: ' || (r->'itens')::text;
  assert (select x->>'estado' from jsonb_array_elements(r->'itens') x where x->>'tarefa' = 'vigigen-diario-genbank-zika') = 'pendente', 'zika espera';
  assert exists (select 1 from cron.job where jobname = 'vigigen-sincronizar-manual'), 'tarefa temporária criada';
  assert (select count(*) from public.auditoria where entidade = 'sincronizacao' and acao = 'pedir') = 1, 'pedido auditado';

  -- 3. clique repetido devolve a mesma sincronização
  r := public.sincronizar_fontes();
  assert (r->>'id')::bigint = id1 and r ? 'aviso', 'idempotente';
end $$;

-- 4. as funções abrem execuções (simulado); o IBGE respondeu 500 e não abriu nada
insert into public.execucao_ingestao (fonte, parametros, status, registros, finalizado_em)
values ('genbank', '{"agravo": "dengue"}', 'ok', 12, now()),
       ('infodengue', '{}', 'em_andamento', 0, null);
select app.sincronizacao_avancar();

do $$
declare r jsonb := app.sincronizacao_json(null);
begin
  assert (select x->>'estado' from jsonb_array_elements(r->'itens') x where x->>'tarefa' = 'vigigen-diario-genbank') = 'ok', 'dengue ok: ' || (r->'itens')::text;
  assert (select (x->>'registros')::int from jsonb_array_elements(r->'itens') x where x->>'tarefa' = 'vigigen-diario-genbank') = 12, 'registros';
  assert (select x->>'estado' from jsonb_array_elements(r->'itens') x where x->>'tarefa' = 'vigigen-mensal-ibge') = 'erro', 'ibge erro';
  assert (select (x->>'http_status')::int from jsonb_array_elements(r->'itens') x where x->>'tarefa' = 'vigigen-mensal-ibge') = 500, 'ibge 500';
  assert (select x->>'estado' from jsonb_array_elements(r->'itens') x where x->>'tarefa' = 'vigigen-semanal-infodengue') = 'disparado', 'infodengue segue';
  -- GenBank liberou: chikungunya (ordem alfabética) disparado, zika ainda na fila
  assert (select x->>'estado' from jsonb_array_elements(r->'itens') x where x->>'tarefa' = 'vigigen-diario-genbank-chikungunya') = 'disparado', 'chik disparado';
  assert (select x->>'estado' from jsonb_array_elements(r->'itens') x where x->>'tarefa' = 'vigigen-diario-genbank-zika') = 'pendente', 'zika ainda espera';
  assert r->>'concluida_em' is null, 'ainda aberta';
end $$;

-- 5. termina o resto
update public.execucao_ingestao set status = 'ok', registros = 30, finalizado_em = now() where fonte = 'infodengue';
insert into public.execucao_ingestao (fonte, parametros, status, registros, finalizado_em)
values ('genbank', '{"agravo": "chikungunya"}', 'vazio', 0, now());
select app.sincronizacao_avancar();   -- dispara zika
insert into public.execucao_ingestao (fonte, parametros, status, registros, finalizado_em)
values ('genbank', '{"agravo": "zika"}', 'ok', 2, now());
select app.sincronizacao_avancar();   -- fecha

do $$
declare r jsonb := app.sincronizacao_json(null);
begin
  assert r->>'concluida_em' is not null, 'concluída: ' || r::text;
  assert r->>'indicadores_em' is not null, 'indicadores recalculados';
  assert (select x->>'estado' from jsonb_array_elements(r->'itens') x where x->>'tarefa' = 'vigigen-diario-genbank-zika') = 'ok', 'zika ok';
  assert not exists (select 1 from cron.job where jobname = 'vigigen-sincronizar-manual'), 'tarefa temporária removida';
  assert exists (select 1 from public.auditoria where entidade = 'sincronizacao' and acao = 'concluir'), 'conclusão auditada';
  -- 6. intervalo mínimo de 10 minutos
  r := app.sincronizar_pedir('conector', 'conector:FIXTURE');
  assert r ? 'aviso' and r->>'concluida_em' is not null, 'intervalo mínimo';
  assert (select count(*) from app.sincronizacao) = 1, 'nenhuma nova';
  raise notice 'OK: migração 021 passou em todos os testes';
end $$;
