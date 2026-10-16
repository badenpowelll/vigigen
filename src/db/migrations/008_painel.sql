-- VigiGen — 008: funções de leitura do painel.
-- SECURITY INVOKER: chamadas por um usuário autenticado (supabase-js/rpc)
-- passam pelo RLS e veem só o território dele. Retornam jsonb compacto.

-- Malha simplificada (GeoJSON) dos municípios visíveis
create or replace function public.painel_malha()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'fonte', min(m.fonte),
    'ano_referencia', min(m.ano_referencia_malha),
    'features', coalesce(jsonb_agg(jsonb_build_object(
      'type', 'Feature',
      'properties', jsonb_build_object('g', m.geocodigo, 'n', m.nome),
      'geometry', extensions.ST_AsGeoJSON(coalesce(m.geometria_simplificada, m.geometria), 4)::jsonb
    ) order by m.geocodigo), '[]'::jsonb))
  from public.municipio m;
$$;

-- Situação da última SE por município (mapa e ranking)
create or replace function public.painel_semana(p_doenca text default 'dengue')
returns jsonb language sql stable security invoker set search_path = '' as $$
  with ultima as (
    select max(semana_epidemiologica) se from public.caso_semanal where doenca = p_doenca
  ), anterior as (
    select max(semana_epidemiologica) se from public.caso_semanal, ultima u
    where doenca = p_doenca and semana_epidemiologica < u.se
  )
  select jsonb_build_object(
    'doenca', p_doenca,
    'se', (select se from ultima),
    'se_anterior', (select se from anterior),
    'municipios', coalesce(jsonb_agg(jsonb_build_object(
       'g', m.geocodigo, 'n', m.nome,
       'c', c.casos, 'ce', c.casos_estimados, 'i', round(c.incidencia_100k, 2),
       'nv', c.nivel_alerta, 'rt', round(c.rt, 3), 'prt', round(c.p_rt1, 3),
       'pop', c.populacao, 'ca', a.casos, 'dt', c.data_inicio_se
     ) order by m.geocodigo), '[]'::jsonb),
    'ingerido_em', max(c.ingerido_em)
  )
  from public.municipio m
  left join public.caso_semanal c
    on c.geocodigo = m.geocodigo and c.doenca = p_doenca
   and c.semana_epidemiologica = (select se from ultima)
  left join public.caso_semanal a
    on a.geocodigo = m.geocodigo and a.doenca = p_doenca
   and a.semana_epidemiologica = (select se from anterior);
$$;

-- Série semanal: de um município ou, com p_geocodigo nulo, do RN agregado
create or replace function public.painel_serie(p_geocodigo integer default null,
                                               p_doenca text default 'dengue',
                                               p_desde integer default 202001)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with s as (
    select semana_epidemiologica se, min(data_inicio_se) dt,
           sum(casos) c, sum(casos_estimados) ce,
           case when sum(populacao) > 0 then round(sum(casos) * 100000.0 / sum(populacao), 2) end i,
           max(nivel_alerta) nv_max,
           case when p_geocodigo is not null then max(rt) end rt,
           count(*) n_mun
    from public.caso_semanal
    where doenca = p_doenca and semana_epidemiologica >= p_desde
      and (p_geocodigo is null or geocodigo = p_geocodigo)
    group by semana_epidemiologica
  )
  select jsonb_build_object(
    'geocodigo', p_geocodigo, 'doenca', p_doenca,
    'se', coalesce(jsonb_agg(se order by se), '[]'), 'dt', coalesce(jsonb_agg(dt order by se), '[]'),
    'c', coalesce(jsonb_agg(c order by se), '[]'), 'ce', coalesce(jsonb_agg(ce order by se), '[]'),
    'i', coalesce(jsonb_agg(i order by se), '[]'), 'nv', coalesce(jsonb_agg(nv_max order by se), '[]'),
    'rt', coalesce(jsonb_agg(rt order by se), '[]'), 'n_mun', coalesce(jsonb_agg(n_mun order by se), '[]'))
  from s;
$$;

-- Resumo: atualização das fontes, genômica, cobertura, oportunidade, qualidade, alertas
create or replace function public.painel_resumo()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'gerado_em', now(),
    'fontes', (select jsonb_object_agg(fonte, x) from (
        select distinct on (fonte) fonte, jsonb_build_object(
          'status', status, 'finalizado_em', finalizado_em, 'iniciado_em', iniciado_em,
          'registros', registros, 'rota', parametros->>'rota') x
        from public.execucao_ingestao where status in ('ok','vazio')
        order by fonte, finalizado_em desc) f),
    'em_andamento', (select coalesce(jsonb_agg(fonte), '[]') from public.execucao_ingestao where status = 'em_andamento'),
    'genbank', (select jsonb_build_object(
        'total', count(*),
        'rn', count(*) filter (where uf_inferida = 'RN'),
        'rn_por_nome_cepa', count(*) filter (where rn_por_nome_cepa),
        'brasil_sem_estado', count(*) filter (where geo_loc_bruto ~* '^\s*brazil\s*$'),
        'sem_geo', count(*) filter (where geo_loc_bruto is null),
        'genoma_quase_completo', count(*) filter (where tamanho >= 9000),
        'por_sorotipo', (select jsonb_object_agg(coalesce(sorotipo_declarado, 'não declarado'), n)
                         from (select sorotipo_declarado, count(*) n from public.sequencia group by 1) q),
        'termo', '"Dengue virus"[Organism] AND Brazil[All Fields]')
      from public.sequencia),
    'sequencias_rn', (select coalesce(jsonb_agg(jsonb_build_object(
        'acc', accession, 'soro', sorotipo_declarado, 'coleta', data_coleta,
        'pub', data_publicacao, 'geo', geo_loc_bruto, 'nt', tamanho, 'titulo', titulo,
        'por_nome', rn_por_nome_cepa) order by data_coleta_inicio nulls last), '[]')
      from public.sequencia where uf_inferida = 'RN' or rn_por_nome_cepa),
    'composicao_brasil', (select coalesce(jsonb_agg(jsonb_build_object('a', ano, 's', soro, 'n', n) order by ano, soro), '[]')
      from (select extract(year from data_coleta_inicio)::int ano,
                   coalesce(sorotipo_declarado, 'não declarado') soro, count(*) n
            from public.sequencia where data_coleta_inicio >= '2010-01-01'
            group by 1, 2) q),
    'por_ano_brasil', (select coalesce(jsonb_agg(jsonb_build_object('a', ano, 'n', n, 'rn', rn) order by ano), '[]')
      from (select extract(year from data_coleta_inicio)::int ano, count(*) n,
                   count(*) filter (where uf_inferida = 'RN') rn
            from public.sequencia where data_coleta_inicio is not null group by 1) q),
    'indicadores', (select coalesce(jsonb_agg(jsonb_build_object(
        'g', geocodigo, 'nivel', nivel, 'p', periodo, 't', tipo, 'v', valor,
        'num', numerador, 'den', denominador, 'mot', motivo_nulo,
        'd', detalhe - 'accessions', 'em', calculado_em) order by tipo, periodo), '[]')
      from public.indicador where nivel <> 'municipio'),
    'cobertura_municipal_trimestre', (select coalesce(jsonb_agg(jsonb_build_object(
        'g', geocodigo, 'p', periodo, 'v', valor, 'num', numerador, 'den', denominador, 'mot', motivo_nulo)), '[]')
      from public.indicador
      where nivel = 'municipio' and tipo = 'cobertura_sequenciamento'
        and periodo = (select max(periodo) from public.indicador where nivel = 'municipio' and tipo = 'cobertura_sequenciamento')),
    'alertas', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'g', geocodigo, 'tipo', tipo, 'p', periodo_deteccao, 'status', status,
        'ev', evidencia, 'criado', criado_em, 'rev', revisado_em) order by criado_em desc), '[]')
      from public.alerta),
    'classificacao', (select jsonb_build_object('total', count(*)) from public.classificacao),
    'exclusoes_qc', (select coalesce(jsonb_object_agg(motivo, n), '{}') from
                      (select motivo, count(*) n from public.exclusao_qc group by 1) q)
  );
$$;

revoke all on function public.painel_malha() from public, anon;
revoke all on function public.painel_semana(text) from public, anon;
revoke all on function public.painel_serie(integer, text, integer) from public, anon;
revoke all on function public.painel_resumo() from public, anon;
grant execute on function public.painel_malha() to authenticated;
grant execute on function public.painel_semana(text) to authenticated;
grant execute on function public.painel_serie(integer, text, integer) to authenticated;
grant execute on function public.painel_resumo() to authenticated;
