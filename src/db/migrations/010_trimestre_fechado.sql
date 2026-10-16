-- 010: a cobertura municipal no resumo usa o último trimestre FECHADO.
-- O trimestre corrente tem poucas semanas e quase nenhuma sequência depositada
-- ainda (defasagem do GenBank), o que fazia todo município aparecer com 0%.
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
        and periodo = (select max(periodo) from public.indicador where nivel = 'municipio' and tipo = 'cobertura_sequenciamento'
                         and periodo < app.trimestre(current_date))),
    'alertas', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'g', geocodigo, 'tipo', tipo, 'p', periodo_deteccao, 'status', status,
        'ev', evidencia, 'criado', criado_em, 'rev', revisado_em) order by criado_em desc), '[]')
      from public.alerta),
    'classificacao', (select jsonb_build_object('total', count(*)) from public.classificacao),
    'exclusoes_qc', (select coalesce(jsonb_object_agg(motivo, n), '{}') from
                      (select motivo, count(*) n from public.exclusao_qc group by 1) q)
  );
$$;
