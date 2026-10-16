-- 006: agenda das cargas (pg_cron). As funções são retomáveis: cada chamada
-- avança o cursor guardado em execucao_ingestao.parametros e sai antes do
-- limite de tempo; as tarefas "continuar" só fazem algo se houver carga em andamento.
select cron.schedule('vigigen-continuar-infodengue', '*/3 * * * *',   $$select app.disparar('ingest-infodengue', '{}'::jsonb)$$);
select cron.schedule('vigigen-continuar-genbank',    '1-59/3 * * * *', $$select app.disparar('ingest-genbank', '{}'::jsonb)$$);
select cron.schedule('vigigen-semanal-infodengue',   '0 9 * * 1,4',   $$select app.disparar('ingest-infodengue', '{"iniciar": true}'::jsonb)$$);
select cron.schedule('vigigen-semanal-genbank',      '0 10 * * 2',    $$select app.disparar('ingest-genbank', '{"iniciar": true}'::jsonb)$$);
select cron.schedule('vigigen-mensal-ibge',          '0 8 1 * *',     $$select app.disparar('ingest-ibge', '{}'::jsonb)$$);
select cron.schedule('vigigen-limpa-pgnet',          '30 3 * * *',    $$delete from net._http_response where created < now() - interval '2 days'$$);
-- adicionada junto com 007:
select cron.schedule('vigigen-indicadores',          '15 */6 * * *',  $$select public.calcular_indicadores()$$);
