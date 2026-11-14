-- VigiGen — 013: camada genômica multiagravo (dengue, chikungunya, Zika).
--
-- Por quê: até a 012 a camada genômica só tinha dengue e os indicadores e o
-- painel liam a tabela public.sequencia inteira. Ingerir CHIKV e ZIKV sem esta
-- migração misturaria os vírus. Aqui o agravo vira coluna derivada do
-- organismo declarado no GenBank (nunca inferido de outro campo), e
-- indicadores, alertas e o resumo do painel passam a ser separados por agravo.
--
-- Não apaga nem reescreve dado: as 7.203 sequências de dengue recebem
-- agravo = 'dengue' pela coluna gerada, os indicadores antigos recebem
-- agravo = 'dengue' pelo default. Reversão no fim do arquivo.
--
-- Consultas validadas em 14/11/2026 15:24 UTC (esearch, db=nuccore):
--   "Dengue virus"[Organism] AND Brazil[All Fields]       -> 7.203
--   "Chikungunya virus"[Organism] AND Brazil[All Fields]  -> 1.839
--   "Zika virus"[Organism] AND Brazil[All Fields]         -> 519
-- Referências conferidas por esummary (14/11/2026 15:25 UTC):
--   NC_001477.1 dengue virus type 1, 10.735 nt (taxid 11053)
--   NC_004162.2 Chikungunya virus, 11.826 nt (taxid 37124)
--   NC_012532.1 Zika virus MR 766, 10.794 nt (taxid 64320)

-- 1) Agravo a partir do organismo declarado -----------------------------------
create or replace function app.agravo_de(organismo text)
returns text language sql immutable set search_path = '' as $$
  select case
    when organismo ~* '^\s*dengue virus' then 'dengue'
    when organismo ~* '^\s*chikungunya virus' then 'chikungunya'
    when organismo ~* '^\s*zika virus' then 'zika'
  end;
$$;

alter table public.sequencia
  add column if not exists agravo text generated always as (app.agravo_de(organismo)) stored;
create index if not exists sequencia_agravo_idx on public.sequencia (agravo);

-- Sorotipo DENV-1..4 só existe para dengue. A regex de app.sorotipo_de aceita
-- "1".."4" isolado no campo /serotype, que em outro vírus não é sorotipo de dengue.
create or replace function app.sorotipo_so_dengue()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.agravo_de(new.organismo) is distinct from 'dengue' then
    new.sorotipo_declarado := null;
  end if;
  return new;
end;
$$;
drop trigger if exists sequencia_sorotipo_so_dengue on public.sequencia;
create trigger sequencia_sorotipo_so_dengue before insert or update on public.sequencia
  for each row execute function app.sorotipo_so_dengue();

-- 2) Configuração por agravo (termo, referência, limiar de genoma quase completo)
create table if not exists public.agravo_genomico (
  agravo                text primary key check (agravo in ('dengue','chikungunya','zika')),
  termo_ncbi            text not null,
  referencia            text not null,
  tamanho_referencia    integer not null,
  limiar_quase_completo integer not null,
  criterio_limiar       text not null,
  classificacao         text not null
);
-- Configuração pública (sem dado pessoal): leitura para usuários autenticados,
-- escrita só por migração.
alter table public.agravo_genomico enable row level security;
revoke all on public.agravo_genomico from public, anon, authenticated;
grant select on public.agravo_genomico to authenticated;
drop policy if exists agravo_genomico_leitura on public.agravo_genomico;
create policy agravo_genomico_leitura on public.agravo_genomico for select to authenticated using (true);

insert into public.agravo_genomico values
  ('dengue', '"Dengue virus"[Organism] AND Brazil[All Fields]', 'NC_001477.1', 10735, 9000,
   'limiar histórico do projeto (9.000 nt, 83,8% de NC_001477.1)',
   'Nextclade: nextstrain/dengue/all (sorotipo) e community/v-gen-lab/dengue/denv{n} (linhagem), D-013'),
  ('chikungunya', '"Chikungunya virus"[Organism] AND Brazil[All Fields]', 'NC_004162.2', 11826, 9914,
   'mesma fração do limiar de dengue (83,8%) aplicada a NC_004162.2; provisório, a validar',
   'a definir: verificar dataset Nextclade de genótipos de CHIKV antes de classificar'),
  ('zika', '"Zika virus"[Organism] AND Brazil[All Fields]', 'NC_012532.1', 10794, 9046,
   'mesma fração do limiar de dengue (83,8%) aplicada a NC_012532.1; provisório, a validar',
   'a definir: verificar dataset Nextclade de ZIKV antes de classificar')
on conflict (agravo) do update set
  termo_ncbi = excluded.termo_ncbi, referencia = excluded.referencia,
  tamanho_referencia = excluded.tamanho_referencia,
  limiar_quase_completo = excluded.limiar_quase_completo,
  criterio_limiar = excluded.criterio_limiar, classificacao = excluded.classificacao;

-- 3) Indicadores e alertas com agravo -----------------------------------------
alter table public.indicador
  add column if not exists agravo text not null default 'dengue'
  check (agravo in ('dengue','chikungunya','zika'));
alter table public.indicador drop constraint if exists indicador_geocodigo_nivel_periodo_tipo_key;
alter table public.indicador drop constraint if exists indicador_chave_agravo;
alter table public.indicador add constraint indicador_chave_agravo
  unique nulls not distinct (geocodigo, nivel, periodo, tipo, agravo);

alter table public.alerta
  add column if not exists agravo text not null default 'dengue'
  check (agravo in ('dengue','chikungunya','zika'));

-- 4) Cálculo dos indicadores, um agravo de cada vez ---------------------------
-- Mesmas regras da 007; muda só o filtro: sequências do agravo e casos do
-- mesmo agravo no denominador. Sem sequência do agravo, nada é gravado para
-- ele (o painel mostra "sem dado", não zero).
create or replace function public.calcular_indicadores()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cfg record;
  n_cob_mun integer; n_cob_uf integer; n_op integer; n_seq integer;
  saida jsonb := '{}'::jsonb;
begin
  for cfg in select * from public.agravo_genomico order by agravo loop
    if not exists (select 1 from public.sequencia where agravo = cfg.agravo) then
      saida := saida || jsonb_build_object(cfg.agravo, jsonb_build_object('sem_sequencias', true));
      continue;
    end if;

    -- 1a) Cobertura municipal por trimestre
    with casos as (
      select geocodigo, app.trimestre(data_inicio_se) as periodo, sum(casos) as casos
      from public.caso_semanal where doenca = cfg.agravo
      group by 1, 2
    ), seq_mun as (
      select geocodigo, app.trimestre(data_coleta_inicio) as periodo, count(*) as n,
             array_agg(accession order by accession) as acc
      from public.sequencia
      where agravo = cfg.agravo and geocodigo is not null and data_coleta_inicio is not null
        and data_coleta !~ '^\d{4}$'
      group by 1, 2
    ), rn_sem_mun as (
      select app.trimestre(data_coleta_inicio) as periodo, count(*) as n
      from public.sequencia
      where agravo = cfg.agravo and uf_inferida = 'RN' and geocodigo is null
        and data_coleta_inicio is not null and data_coleta !~ '^\d{4}$'
      group by 1
    ), linhas as (
      select c.geocodigo, c.periodo, coalesce(s.n, 0) as num, c.casos as den,
             coalesce(r.n, 0) as rn_sem_mun, s.acc
      from casos c
      left join seq_mun s using (geocodigo, periodo)
      left join rn_sem_mun r using (periodo)
    )
    insert into public.indicador (geocodigo, nivel, periodo, tipo, agravo, valor, numerador,
                                  denominador, motivo_nulo, detalhe, calculado_em)
    select geocodigo, 'municipio', periodo, 'cobertura_sequenciamento', cfg.agravo,
           case when den is null or den = 0 then null
                when num = 0 and rn_sem_mun > 0 then null
                else num::numeric / den end,
           num, den,
           case when den is null or den = 0 then 'sem casos notificados no período'
                when num = 0 and rn_sem_mun > 0 then
                  'há ' || rn_sem_mun || ' sequência(s) do RN no período sem município identificável'
           end,
           jsonb_build_object('denominador', 'casos notificados de ' || cfg.agravo || ' (InfoDengue)',
                              'numerador', 'sequências de ' || cfg.agravo || ' com coleta no período e município identificado',
                              'accessions', coalesce(to_jsonb(acc), '[]'::jsonb)),
           now()
    from linhas
    on conflict (geocodigo, nivel, periodo, tipo, agravo) do update set
      valor = excluded.valor, numerador = excluded.numerador, denominador = excluded.denominador,
      motivo_nulo = excluded.motivo_nulo, detalhe = excluded.detalhe, calculado_em = now();
    get diagnostics n_cob_mun = row_count;

    -- 1b) Cobertura estadual (RN) por trimestre e por ano
    with casos as (
      select app.trimestre(data_inicio_se) as periodo, sum(casos) as casos
      from public.caso_semanal where doenca = cfg.agravo group by 1
      union all
      select extract(year from data_inicio_se)::text, sum(casos)
      from public.caso_semanal where doenca = cfg.agravo group by 1
    ), seq as (
      select app.trimestre(data_coleta_inicio) as periodo, count(*) n, array_agg(accession) acc
      from public.sequencia where agravo = cfg.agravo and uf_inferida = 'RN'
        and data_coleta_inicio is not null and data_coleta !~ '^\d{4}$' group by 1
      union all
      select extract(year from data_coleta_inicio)::text, count(*), array_agg(accession)
      from public.sequencia where agravo = cfg.agravo and uf_inferida = 'RN'
        and data_coleta_inicio is not null group by 1
    )
    insert into public.indicador (geocodigo, nivel, periodo, tipo, agravo, valor, numerador,
                                  denominador, motivo_nulo, detalhe, calculado_em)
    select null, 'estado', c.periodo, 'cobertura_sequenciamento', cfg.agravo,
           case when c.casos > 0 then coalesce(s.n, 0)::numeric / c.casos end,
           coalesce(s.n, 0), c.casos,
           case when coalesce(c.casos, 0) = 0 then 'sem casos notificados no período' end,
           jsonb_build_object('uf', 'RN',
                              'denominador', 'casos notificados de ' || cfg.agravo || ' no RN (InfoDengue)',
                              'numerador', 'sequências de ' || cfg.agravo || ' com geo_loc citando RN e coleta no período',
                              'accessions', coalesce(to_jsonb(s.acc), '[]'::jsonb)),
           now()
    from casos c left join seq s using (periodo)
    on conflict (geocodigo, nivel, periodo, tipo, agravo) do update set
      valor = excluded.valor, numerador = excluded.numerador, denominador = excluded.denominador,
      motivo_nulo = excluded.motivo_nulo, detalhe = excluded.detalhe, calculado_em = now();
    get diagnostics n_cob_uf = row_count;

    -- 2) Oportunidade: dias entre coleta e criação do registro no GenBank
    with base as (
      select case when uf_inferida = 'RN' then 'estado' else 'pais' end as nivel,
             extract(year from data_coleta_inicio)::text as ano,
             coalesce(sorotipo_declarado, case when cfg.agravo = 'dengue' then 'não declarado' else 'todos' end) as soro,
             (data_publicacao - data_coleta_inicio) as dias
      from public.sequencia
      where agravo = cfg.agravo and app.coleta_tem_dia(data_coleta) and data_publicacao is not null
        and data_publicacao >= data_coleta_inicio
    ), expandida as (
      select nivel, ano, soro, dias from base
      union all select 'pais', ano, soro, dias from base where nivel = 'estado'
    ), agreg as (
      select nivel, ano, soro, count(*) n,
             percentile_cont(0.5) within group (order by dias) p50,
             percentile_cont(0.25) within group (order by dias) p25,
             percentile_cont(0.75) within group (order by dias) p75
      from (select * from expandida
            union all
            select nivel, ano, 'todos', dias from expandida where cfg.agravo = 'dengue') x
      group by 1, 2, 3
    )
    insert into public.indicador (geocodigo, nivel, periodo, tipo, agravo, valor, numerador,
                                  denominador, detalhe, calculado_em)
    select null, nivel, ano, 'oportunidade_mediana_dias:' || soro, cfg.agravo, p50, null, n,
           jsonb_build_object('p25', p25, 'p75', p75, 'n', n, 'sorotipo', soro,
                              'data_disponibilidade', 'GBSeq_create-date (criação do registro no GenBank)',
                              'filtro', 'apenas coletas com data completa (dia/mês/ano)'),
           now()
    from agreg
    on conflict (geocodigo, nivel, periodo, tipo, agravo) do update set
      valor = excluded.valor, denominador = excluded.denominador,
      detalhe = excluded.detalhe, calculado_em = now();
    get diagnostics n_op = row_count;

    -- 3) Qualidade do dado genômico (Brasil), por ano de coleta
    with base as (
      select extract(year from data_coleta_inicio)::text as ano,
             (geo_loc_bruto ~* '^\s*brazil\s*$') as sem_estado,
             (uf_inferida = 'RN') as rn,
             rn_por_nome_cepa,
             (tamanho >= cfg.limiar_quase_completo) as genoma_quase_completo
      from public.sequencia where agravo = cfg.agravo and data_coleta_inicio is not null
    )
    insert into public.indicador (geocodigo, nivel, periodo, tipo, agravo, valor, numerador,
                                  denominador, detalhe, calculado_em)
    select null, 'pais', ano, t.tipo, cfg.agravo,
           case when t.tipo like 'sequencias%' then t.num else t.num::numeric / nullif(t.den, 0) end,
           t.num, t.den, jsonb_build_object('descricao', t.descr), now()
    from (
      select ano, 'sequencias_brasil' tipo, count(*) num, count(*) den,
             'sequências de ' || cfg.agravo || ' do Brasil no GenBank' descr from base group by ano
      union all
      select ano, 'percentual_sem_estado', count(*) filter (where sem_estado), count(*), 'fração com geo_loc apenas "Brazil"' from base group by ano
      union all
      select ano, 'sequencias_rn', count(*) filter (where rn), count(*), 'sequências com geo_loc citando RN' from base group by ano
      union all
      select ano, 'sequencias_rn_por_nome_cepa', count(*) filter (where rn_por_nome_cepa), count(*), 'cepas com "/RN/" no nome mas sem RN no geo_loc (sinal secundário)' from base group by ano
      union all
      select ano, 'percentual_genoma_quase_completo', count(*) filter (where genoma_quase_completo), count(*),
             'fração com ' || cfg.limiar_quase_completo || ' nt ou mais (' || cfg.criterio_limiar || ')' from base group by ano
    ) t
    on conflict (geocodigo, nivel, periodo, tipo, agravo) do update set
      valor = excluded.valor, numerador = excluded.numerador, denominador = excluded.denominador,
      detalhe = excluded.detalhe, calculado_em = now();
    get diagnostics n_seq = row_count;

    saida := saida || jsonb_build_object(cfg.agravo, jsonb_build_object(
      'cobertura_municipal', n_cob_mun, 'cobertura_estadual', n_cob_uf,
      'oportunidade', n_op, 'qualidade', n_seq));
  end loop;

  insert into public.auditoria (ator, acao, entidade, detalhe)
  values ('sql:calcular_indicadores', 'calculo', 'indicador', saida);
  return saida;
end;
$$;
revoke all on function public.calcular_indicadores() from public, anon, authenticated;
grant execute on function public.calcular_indicadores() to service_role;

-- 5) Resumo do painel ----------------------------------------------------------
-- Bloco genômico de um agravo (mesmo formato que o painel já lê).
create or replace function public.painel_genomica(p_agravo text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with cfg as (select * from public.agravo_genomico where agravo = p_agravo),
  s as (select * from public.sequencia where agravo = p_agravo)
  select jsonb_build_object(
    'agravo', p_agravo,
    'config', (select jsonb_build_object('termo', termo_ncbi, 'referencia', referencia,
                 'tamanho_referencia', tamanho_referencia, 'limiar', limiar_quase_completo,
                 'criterio_limiar', criterio_limiar, 'classificacao', classificacao) from cfg),
    'fonte', (select jsonb_build_object('status', status, 'iniciado_em', iniciado_em,
                 'finalizado_em', finalizado_em, 'registros', registros)
              from public.execucao_ingestao, cfg
              where fonte = 'genbank' and status in ('ok','vazio') and parametros->>'termo' = cfg.termo_ncbi
              order by finalizado_em desc limit 1),
    'genbank', (select jsonb_build_object(
        'total', count(*),
        'rn', count(*) filter (where uf_inferida = 'RN'),
        'rn_por_nome_cepa', count(*) filter (where rn_por_nome_cepa),
        'brasil_sem_estado', count(*) filter (where geo_loc_bruto ~* '^\s*brazil\s*$'),
        'sem_geo', count(*) filter (where geo_loc_bruto is null),
        'genoma_quase_completo', count(*) filter (where tamanho >= (select limiar_quase_completo from cfg)),
        'por_sorotipo', (select coalesce(jsonb_object_agg(coalesce(sorotipo_declarado, 'não declarado'), n), '{}')
                         from (select sorotipo_declarado, count(*) n from s group by 1) q),
        'termo', (select termo_ncbi from cfg))
      from s),
    'sequencias_rn', (select coalesce(jsonb_agg(jsonb_build_object(
        'acc', accession, 'soro', sorotipo_declarado, 'coleta', data_coleta,
        'pub', data_publicacao, 'geo', geo_loc_bruto, 'nt', tamanho, 'titulo', titulo,
        'por_nome', rn_por_nome_cepa) order by data_coleta_inicio nulls last), '[]')
      from s where uf_inferida = 'RN' or rn_por_nome_cepa),
    'composicao_brasil', (select coalesce(jsonb_agg(jsonb_build_object('a', ano, 's', soro, 'n', n) order by ano, soro), '[]')
      from (select extract(year from data_coleta_inicio)::int ano,
                   coalesce(sorotipo_declarado, 'não declarado') soro, count(*) n
            from s where data_coleta_inicio >= '2010-01-01' group by 1, 2) q),
    'por_ano_brasil', (select coalesce(jsonb_agg(jsonb_build_object('a', ano, 'n', n, 'rn', rn) order by ano), '[]')
      from (select extract(year from data_coleta_inicio)::int ano, count(*) n,
                   count(*) filter (where uf_inferida = 'RN') rn
            from s where data_coleta_inicio is not null group by 1) q),
    'indicadores', (select coalesce(jsonb_agg(jsonb_build_object(
        'g', geocodigo, 'nivel', nivel, 'p', periodo, 't', tipo, 'v', valor,
        'num', numerador, 'den', denominador, 'mot', motivo_nulo,
        'd', detalhe - 'accessions', 'em', calculado_em) order by tipo, periodo), '[]')
      from public.indicador where nivel <> 'municipio' and agravo = p_agravo),
    'cobertura_municipal_trimestre', (select coalesce(jsonb_agg(jsonb_build_object(
        'g', geocodigo, 'p', periodo, 'v', valor, 'num', numerador, 'den', denominador, 'mot', motivo_nulo)), '[]')
      from public.indicador
      where nivel = 'municipio' and tipo = 'cobertura_sequenciamento' and agravo = p_agravo
        and periodo = (select max(periodo) from public.indicador
                       where nivel = 'municipio' and tipo = 'cobertura_sequenciamento' and agravo = p_agravo
                         and periodo < app.trimestre(current_date))),
    'classificacao', (select jsonb_build_object('total', count(*))
                      from public.classificacao c join s using (accession))
  );
$$;
revoke all on function public.painel_genomica(text) from public, anon;
grant execute on function public.painel_genomica(text) to authenticated;

-- painel_resumo: chaves antigas ficam só com dengue (compatibilidade com o
-- painel já publicado) e a nova chave "genomica" traz um bloco por agravo.
create or replace function public.painel_resumo()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with d as (select public.painel_genomica('dengue') j)
  select jsonb_build_object(
    'gerado_em', now(),
    'fontes', (select jsonb_object_agg(fonte, x) from (
        select distinct on (fonte) fonte, jsonb_build_object(
          'status', status, 'finalizado_em', finalizado_em, 'iniciado_em', iniciado_em,
          'registros', registros, 'rota', parametros->>'rota') x
        from public.execucao_ingestao where status in ('ok','vazio')
        order by fonte, finalizado_em desc) f),
    'em_andamento', (select coalesce(jsonb_agg(fonte), '[]') from public.execucao_ingestao where status = 'em_andamento'),
    'genbank', (select j->'genbank' from d),
    'sequencias_rn', (select j->'sequencias_rn' from d),
    'composicao_brasil', (select j->'composicao_brasil' from d),
    'por_ano_brasil', (select j->'por_ano_brasil' from d),
    'indicadores', (select j->'indicadores' from d),
    'cobertura_municipal_trimestre', (select j->'cobertura_municipal_trimestre' from d),
    'genomica', jsonb_build_object(
        'dengue', (select j from d),
        'chikungunya', public.painel_genomica('chikungunya'),
        'zika', public.painel_genomica('zika')),
    'alertas', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'g', geocodigo, 'a', agravo, 'tipo', tipo, 'p', periodo_deteccao, 'status', status,
        'ev', evidencia, 'criado', criado_em, 'rev', revisado_em) order by criado_em desc), '[]')
      from public.alerta),
    'classificacao', (select jsonb_build_object('total', count(*)) from public.classificacao),
    'exclusoes_qc', (select coalesce(jsonb_object_agg(motivo, n), '{}') from
                      (select motivo, count(*) n from public.exclusao_qc group by 1) q)
  );
$$;

-- 6) Agendamento: um disparo diário por agravo (ingest-genbank aceita "agravo").
-- Horários separados porque a função atende uma execução de cada vez.
select cron.unschedule('vigigen-diario-genbank')
where exists (select 1 from cron.job where jobname = 'vigigen-diario-genbank');
select cron.schedule('vigigen-diario-genbank', '0 10 * * *',
  $$select app.disparar('ingest-genbank', '{"iniciar": true, "agravo": "dengue"}'::jsonb)$$);
select cron.schedule('vigigen-diario-genbank-chikungunya', '20 11 * * *',
  $$select app.disparar('ingest-genbank', '{"iniciar": true, "agravo": "chikungunya"}'::jsonb)$$);
select cron.schedule('vigigen-diario-genbank-zika', '40 12 * * *',
  $$select app.disparar('ingest-genbank', '{"iniciar": true, "agravo": "zika"}'::jsonb)$$);

-- ---------------------------------------------------------------------------
-- Reversão (manual, na ordem):
--   select cron.unschedule('vigigen-diario-genbank-chikungunya');
--   select cron.unschedule('vigigen-diario-genbank-zika');
--   -- reaplicar 012_genbank_diario.sql, 010_trimestre_fechado.sql (painel_resumo)
--   -- e 007_indicadores.sql (calcular_indicadores)
--   delete from public.indicador where agravo <> 'dengue';
--   alter table public.indicador drop constraint indicador_chave_agravo;
--   alter table public.indicador add constraint indicador_geocodigo_nivel_periodo_tipo_key
--     unique nulls not distinct (geocodigo, nivel, periodo, tipo);
--   alter table public.indicador drop column agravo;
--   alter table public.alerta drop column agravo;
--   drop trigger sequencia_sorotipo_so_dengue on public.sequencia;
--   -- sequências de CHIKV/ZIKV, se ingeridas, ficam identificáveis por organismo;
--   -- removê-las só com decisão explícita (o bruto continua em public.bruto).
--   alter table public.sequencia drop column agravo;
--   drop function public.painel_genomica(text); drop table public.agravo_genomico;
