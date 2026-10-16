-- VigiGen — 007: indicadores de cobertura e oportunidade (Prompt 4, itens 1 e 2)
-- Regras: numerador e denominador sempre gravados; nulo (nunca zero) quando o
-- denominador é zero ou a origem municipal é desconhecida, com o motivo.

alter table public.indicador drop constraint if exists indicador_nivel_check;
alter table public.indicador add constraint indicador_nivel_check
  check (nivel in ('municipio','estado','pais'));

-- Trimestre no formato AAAATn
create or replace function app.trimestre(d date)
returns text language sql immutable set search_path = '' as $$
  select extract(year from d)::int || 'T' || extract(quarter from d)::int;
$$;

-- Data de coleta com precisão de dia (só essas entram na oportunidade)
create or replace function app.coleta_tem_dia(t text)
returns boolean language sql immutable set search_path = '' as $$
  select t ~ '^\d{4}-\d{2}-\d{2}$' or t ~* '^\d{1,2}-[a-z]{3}-\d{4}$';
$$;

create or replace function public.calcular_indicadores()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n_cob_mun integer; n_cob_uf integer; n_op integer; n_seq integer;
begin
  -- 1a) Cobertura municipal por trimestre (dengue: as sequências são de DENV)
  with casos as (
    select geocodigo, app.trimestre(data_inicio_se) as periodo, sum(casos) as casos
    from public.caso_semanal where doenca = 'dengue'
    group by 1, 2
  ), seq_mun as (
    select geocodigo, app.trimestre(data_coleta_inicio) as periodo, count(*) as n,
           array_agg(accession order by accession) as acc
    from public.sequencia
    where geocodigo is not null and data_coleta_inicio is not null and data_coleta !~ '^\d{4}$'
    group by 1, 2
  ), rn_sem_mun as (  -- sequências do RN sem município identificável, por trimestre
    select app.trimestre(data_coleta_inicio) as periodo, count(*) as n
    from public.sequencia
    where uf_inferida = 'RN' and geocodigo is null and data_coleta_inicio is not null
      and data_coleta !~ '^\d{4}$'
    group by 1
  ), linhas as (
    select c.geocodigo, c.periodo, coalesce(s.n, 0) as num, c.casos as den,
           coalesce(r.n, 0) as rn_sem_mun, s.acc
    from casos c
    left join seq_mun s using (geocodigo, periodo)
    left join rn_sem_mun r using (periodo)
  )
  insert into public.indicador (geocodigo, nivel, periodo, tipo, valor, numerador,
                                denominador, motivo_nulo, detalhe, calculado_em)
  select geocodigo, 'municipio', periodo, 'cobertura_sequenciamento',
         case when den is null or den = 0 then null
              when num = 0 and rn_sem_mun > 0 then null
              else num::numeric / den end,
         num, den,
         case when den is null or den = 0 then 'sem casos notificados no período'
              when num = 0 and rn_sem_mun > 0 then
                'há ' || rn_sem_mun || ' sequência(s) do RN no período sem município identificável'
         end,
         jsonb_build_object('denominador', 'casos notificados de dengue (InfoDengue)',
                            'numerador', 'sequências depositadas com coleta no período e município identificado',
                            'classificacao', 'pré-classificação: Nextclade ainda não executado',
                            'accessions', coalesce(to_jsonb(acc), '[]'::jsonb)),
         now()
  from linhas
  on conflict (geocodigo, nivel, periodo, tipo) do update set
    valor = excluded.valor, numerador = excluded.numerador, denominador = excluded.denominador,
    motivo_nulo = excluded.motivo_nulo, detalhe = excluded.detalhe, calculado_em = now();
  get diagnostics n_cob_mun = row_count;

  -- 1b) Cobertura estadual (RN) por trimestre e por ano
  with casos as (
    select app.trimestre(data_inicio_se) as periodo, sum(casos) as casos
    from public.caso_semanal where doenca = 'dengue' group by 1
    union all
    select extract(year from data_inicio_se)::text, sum(casos)
    from public.caso_semanal where doenca = 'dengue' group by 1
  ), seq as (
    select app.trimestre(data_coleta_inicio) as periodo, count(*) n, array_agg(accession) acc
    from public.sequencia where uf_inferida = 'RN' and data_coleta_inicio is not null
      and data_coleta !~ '^\d{4}$' group by 1
    union all
    select extract(year from data_coleta_inicio)::text, count(*), array_agg(accession)
    from public.sequencia where uf_inferida = 'RN' and data_coleta_inicio is not null group by 1
  )
  insert into public.indicador (geocodigo, nivel, periodo, tipo, valor, numerador,
                                denominador, motivo_nulo, detalhe, calculado_em)
  select null, 'estado', c.periodo, 'cobertura_sequenciamento',
         case when c.casos > 0 then coalesce(s.n, 0)::numeric / c.casos end,
         coalesce(s.n, 0), c.casos,
         case when coalesce(c.casos, 0) = 0 then 'sem casos notificados no período' end,
         jsonb_build_object('uf', 'RN',
                            'denominador', 'casos notificados de dengue no RN (InfoDengue)',
                            'numerador', 'sequências com geo_loc citando RN e coleta no período',
                            'accessions', coalesce(to_jsonb(s.acc), '[]'::jsonb)),
         now()
  from casos c left join seq s using (periodo)
  on conflict (geocodigo, nivel, periodo, tipo) do update set
    valor = excluded.valor, numerador = excluded.numerador, denominador = excluded.denominador,
    motivo_nulo = excluded.motivo_nulo, detalhe = excluded.detalhe, calculado_em = now();
  get diagnostics n_cob_uf = row_count;

  -- 2) Oportunidade: dias entre coleta e criação do registro no GenBank
  --    (GBSeq_create-date = disponibilidade pública). Só coletas com dia.
  with base as (
    select case when uf_inferida = 'RN' then 'estado' else 'pais' end as nivel,
           extract(year from data_coleta_inicio)::text as ano,
           coalesce(sorotipo_declarado, 'não declarado') as soro,
           (data_publicacao - data_coleta_inicio) as dias
    from public.sequencia
    where app.coleta_tem_dia(data_coleta) and data_publicacao is not null
      and data_publicacao >= data_coleta_inicio
  ), expandida as (
    select nivel, ano, soro, dias from base
    union all select 'pais', ano, soro, dias from base where nivel = 'estado'  -- RN também conta no Brasil
  ), agreg as (
    select nivel, ano, soro, count(*) n,
           percentile_cont(0.5) within group (order by dias) p50,
           percentile_cont(0.25) within group (order by dias) p25,
           percentile_cont(0.75) within group (order by dias) p75
    from (select * from expandida union all select nivel, ano, 'todos', dias from expandida) x
    group by 1, 2, 3
  )
  insert into public.indicador (geocodigo, nivel, periodo, tipo, valor, numerador,
                                denominador, detalhe, calculado_em)
  select null, nivel, ano, 'oportunidade_mediana_dias:' || soro, p50, null, n,
         jsonb_build_object('p25', p25, 'p75', p75, 'n', n, 'sorotipo', soro,
                            'data_disponibilidade', 'GBSeq_create-date (criação do registro no GenBank)',
                            'filtro', 'apenas coletas com data completa (dia/mês/ano)'),
         now()
  from agreg
  on conflict (geocodigo, nivel, periodo, tipo) do update set
    valor = excluded.valor, denominador = excluded.denominador,
    detalhe = excluded.detalhe, calculado_em = now();
  get diagnostics n_op = row_count;

  -- 3) Qualidade do dado genômico (Brasil e RN), por ano de coleta
  with base as (
    select extract(year from data_coleta_inicio)::text as ano,
           (geo_loc_bruto ~* '^\s*brazil\s*$') as sem_estado,
           (uf_inferida = 'RN') as rn,
           rn_por_nome_cepa,
           (tamanho >= 9000) as genoma_quase_completo
    from public.sequencia where data_coleta_inicio is not null
  )
  insert into public.indicador (geocodigo, nivel, periodo, tipo, valor, numerador,
                                denominador, detalhe, calculado_em)
  select null, 'pais', ano, t.tipo,
         case when t.tipo like 'sequencias%' then t.num else t.num::numeric / nullif(t.den, 0) end,
         t.num, t.den,
         jsonb_build_object('descricao', t.descr), now()
  from (
    select ano, 'sequencias_brasil' tipo, count(*) num, count(*) den, 'sequências de dengue do Brasil no GenBank' descr from base group by ano
    union all
    select ano, 'percentual_sem_estado', count(*) filter (where sem_estado), count(*), 'fração com geo_loc apenas "Brazil"' from base group by ano
    union all
    select ano, 'sequencias_rn', count(*) filter (where rn), count(*), 'sequências com geo_loc citando RN' from base group by ano
    union all
    select ano, 'sequencias_rn_por_nome_cepa', count(*) filter (where rn_por_nome_cepa), count(*), 'cepas com "/RN/" no nome mas sem RN no geo_loc (sinal secundário)' from base group by ano
    union all
    select ano, 'percentual_genoma_quase_completo', count(*) filter (where genoma_quase_completo), count(*), 'fração com 9.000 nt ou mais' from base group by ano
  ) t
  on conflict (geocodigo, nivel, periodo, tipo) do update set
    valor = excluded.valor, numerador = excluded.numerador, denominador = excluded.denominador,
    detalhe = excluded.detalhe, calculado_em = now();
  get diagnostics n_seq = row_count;

  insert into public.auditoria (ator, acao, entidade, detalhe)
  values ('sql:calcular_indicadores', 'calculo', 'indicador',
          jsonb_build_object('cobertura_municipal', n_cob_mun, 'cobertura_estadual', n_cob_uf,
                             'oportunidade', n_op, 'qualidade', n_seq));
  return jsonb_build_object('cobertura_municipal', n_cob_mun, 'cobertura_estadual', n_cob_uf,
                            'oportunidade', n_op, 'qualidade', n_seq);
end;
$$;
revoke all on function public.calcular_indicadores() from public, anon, authenticated;
grant execute on function public.calcular_indicadores() to service_role;

select cron.schedule('vigigen-indicadores', '15 */6 * * *', $$select public.calcular_indicadores()$$);
