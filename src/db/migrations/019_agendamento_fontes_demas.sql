-- VigiGen — 019: agendamento do SINAN (agregado) e do CNES. NÃO APLICAR sem a
-- aprovação do Baden; depende da 017 aplicada e das funções ingest-sinan e
-- ingest-cnes publicadas.
--
-- SINAN: a base aberta é atualizada semanalmente; uma carga do ano corrente
-- toda terça 06:00 UTC, retomada a cada 3 min até terminar (cursor em
-- execucao_ingestao). Em 14/11/2026, Natal tinha 2.290 notificações de dengue
-- em 2026 (3 páginas de 1000); a carga cobre os 167 municípios do RN.
-- CNES: cadastro mensal; dia 2 de cada mês 07:00 UTC (6.201 estabelecimentos
-- ativos no RN em 14/11/2026, 311 páginas de 20).
-- INMET não tem agendamento no banco: o arquivo anual é grande (82 MB) e é
-- carregado pelo CLI (python -m src.ingest --fonte inmet --ano <ano> --banco).
--
-- Reversão: select cron.unschedule(nome) para os quatro nomes abaixo.
select cron.schedule('vigigen-semanal-sinan', '0 6 * * 2',
  $$select app.disparar('ingest-sinan', '{"iniciar": true}'::jsonb)$$);
select cron.schedule('vigigen-continuar-sinan', '2-59/3 * * * *',
  $$select app.disparar('ingest-sinan', '{}'::jsonb)$$);
select cron.schedule('vigigen-mensal-cnes', '0 7 2 * *',
  $$select app.disparar('ingest-cnes', '{"iniciar": true}'::jsonb)$$);
select cron.schedule('vigigen-continuar-cnes', '0-59/3 * * * *',
  $$select app.disparar('ingest-cnes', '{}'::jsonb)$$);
