-- Teste da migração 013 com registros FIXTURE_ (fictícios, só para teste).
\set ON_ERROR_STOP on
insert into public.municipio values (2408102, 'FIXTURE_Natal', 'RN');
-- dengue antes da migração, como em produção
insert into public.sequencia (accession, organismo, sorotipo_declarado, data_coleta, data_coleta_inicio,
  data_publicacao, uf_inferida, geo_loc_bruto, tamanho)
values ('FIXTURE_D1', 'dengue virus type 2', 'DENV-2', '2024-03-10', '2024-03-10', '2025-01-01', 'RN', 'Brazil: Rio Grande do Norte', 10700),
       ('FIXTURE_D2', 'Dengue virus', null, '2024', '2024-01-01', '2025-01-01', null, 'Brazil', 1400);
insert into public.indicador (geocodigo, nivel, periodo, tipo, valor) values (null, 'pais', '2024', 'sequencias_brasil', 2);
insert into public.caso_semanal values (2408102, 'dengue', 202410, '2024-03-04', 50),
  (2408102, 'chikungunya', 202410, '2024-03-04', 7);

\i src/db/migrations/013_multiagravo.sql

-- depois da migração: CHIKV e ZIKV, com /serotype "2" que NÃO pode virar DENV-2
insert into public.sequencia (accession, organismo, sorotipo_declarado, data_coleta, data_coleta_inicio,
  data_publicacao, geocodigo, uf_inferida, geo_loc_bruto, tamanho)
values ('FIXTURE_C1', 'Chikungunya virus', 'DENV-2', '2024-03-15', '2024-03-15', '2024-09-01', 2408102, 'RN', 'Brazil: Rio Grande do Norte, Natal', 11500),
       ('FIXTURE_Z1', 'Zika virus', null, '2016-05-01', '2016-05-01', '2017-01-01', null, null, 'Brazil', 9000);

do $$
declare r jsonb; g jsonb;
begin
  assert (select agravo from public.sequencia where accession = 'FIXTURE_D1') = 'dengue', 'dengue legado';
  assert (select agravo from public.sequencia where accession = 'FIXTURE_D2') = 'dengue', 'Dengue virus sem tipo';
  assert (select agravo from public.sequencia where accession = 'FIXTURE_C1') = 'chikungunya', 'chik';
  assert (select sorotipo_declarado from public.sequencia where accession = 'FIXTURE_C1') is null, 'sorotipo fora de dengue';
  assert (select sorotipo_declarado from public.sequencia where accession = 'FIXTURE_D1') = 'DENV-2', 'sorotipo dengue preservado';
  assert (select agravo from public.indicador where tipo = 'sequencias_brasil') = 'dengue', 'indicador legado vira dengue';

  r := public.calcular_indicadores();
  assert r ? 'dengue' and r ? 'chikungunya' and r ? 'zika', 'um bloco por agravo';

  -- cobertura municipal de chik usa casos de chik (7), não de dengue (50)
  assert (select denominador from public.indicador where agravo = 'chikungunya' and nivel = 'municipio'
          and tipo = 'cobertura_sequenciamento' and periodo = '2024T1') = 7, 'denominador chik';
  assert (select numerador from public.indicador where agravo = 'chikungunya' and nivel = 'municipio'
          and tipo = 'cobertura_sequenciamento' and periodo = '2024T1') = 1, 'numerador chik';
  assert (select numerador from public.indicador where agravo = 'dengue' and nivel = 'municipio'
          and tipo = 'cobertura_sequenciamento' and periodo = '2024T1') = 0, 'chik não conta em dengue';
  -- genoma quase completo com limiar do vírus: ZIKV 9.000 nt < 9.046
  assert (select numerador from public.indicador where agravo = 'zika' and tipo = 'percentual_genoma_quase_completo') = 0, 'limiar zika';
  assert (select numerador from public.indicador where agravo = 'dengue' and tipo = 'sequencias_brasil' and periodo = '2024') = 2, 'dengue total';
  -- sem sorotipo para chik: oportunidade só em "todos"
  assert not exists (select 1 from public.indicador where agravo = 'chikungunya' and tipo like 'oportunidade%DENV%'), 'sem DENV em chik';

  g := public.painel_genomica('chikungunya');
  assert (g->'genbank'->>'total')::int = 1, 'resumo chik total';
  assert (g->'genbank'->>'rn')::int = 1, 'resumo chik rn';
  g := public.painel_genomica('dengue');
  assert (g->'genbank'->>'total')::int = 2, 'resumo dengue não mistura';
  assert (select count(*) from cron.job where jobname like 'vigigen-diario-genbank%') = 3, 'três agendamentos';
  raise notice 'OK: migração 013 passou em todos os testes';
end $$;
