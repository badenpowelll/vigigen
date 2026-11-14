-- 012 (14/11/2026, escolhido por Baden): GenBank passa de semanal (terça) a
-- diário, 10:00 UTC. A carga é incremental (datetype=mdat desde a última
-- carga), então o custo de um dia sem novidade é uma consulta esearch vazia,
-- gravada crua como as demais. InfoDengue segue segunda e quinta (publica
-- semanalmente) e IBGE, mensal.
select cron.unschedule('vigigen-semanal-genbank');
select cron.schedule('vigigen-diario-genbank', '0 10 * * *',
  $$select app.disparar('ingest-genbank', '{"iniciar": true}'::jsonb)$$);
