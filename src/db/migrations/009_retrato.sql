-- 009: retrato do banco para embutir no painel publicado (web/src/dados/retrato.json).
-- É uma cópia do que as funções painel_* devolvem, com a malha mais simplificada
-- e sem o detalhe textual dos indicadores (exceto percentis da oportunidade),
-- para caber num arquivo único. Não cria nem estima nenhum valor.
create or replace function public.painel_retrato(p_tolerancia double precision default 0.01)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with r as (select public.painel_resumo() j),
  natal as (select geocodigo from public.municipio where app.norm(nome) = 'natal'),
  ult as (
    select doenca, array_agg(se order by se) ses from (
      select distinct doenca, semana_epidemiologica se,
             dense_rank() over (partition by doenca order by semana_epidemiologica desc) k
      from public.caso_semanal) q
    where k <= 12 group by doenca
  ),
  ult12 as (
    select u.doenca, jsonb_build_object('se', to_jsonb(u.ses), 'c', jsonb_object_agg(m.geocodigo::text, (
        select jsonb_agg(c.casos order by s.se)
        from unnest(u.ses) s(se)
        left join public.caso_semanal c
          on c.geocodigo = m.geocodigo and c.doenca = u.doenca and c.semana_epidemiologica = s.se))) j
    from ult u cross join public.municipio m group by u.doenca, u.ses
  )
  select jsonb_build_object(
    'gerado_em', now(),
    'resumo', (select jsonb_set(j, '{indicadores}', (
        select coalesce(jsonb_agg(case when x->>'t' like 'oportunidade%' then x
                                       else x || jsonb_build_object('d', '{}'::jsonb) end), '[]')
        from jsonb_array_elements(j->'indicadores') x)) from r),
    'malha', (select jsonb_build_object('type', 'FeatureCollection',
        'fonte', 'IBGE BC250 2025 (simplificada para o retrato)',
        'ano_referencia', max(ano_referencia_malha),
        'features', jsonb_agg(jsonb_build_object('type', 'Feature',
          'properties', jsonb_build_object('g', geocodigo, 'n', nome),
          'geometry', extensions.st_asgeojson(extensions.st_simplifypreservetopology(geometria, p_tolerancia), 3)::jsonb)
          order by geocodigo))
      from public.municipio),
    'semana', jsonb_build_object('dengue', public.painel_semana('dengue'),
                                 'chikungunya', public.painel_semana('chikungunya'),
                                 'zika', public.painel_semana('zika')),
    'serie_estado', jsonb_build_object('dengue', public.painel_serie(null, 'dengue', 202001),
                                       'chikungunya', public.painel_serie(null, 'chikungunya', 202001),
                                       'zika', public.painel_serie(null, 'zika', 202001)),
    'series_municipio', (select jsonb_build_object(geocodigo || ':dengue', public.painel_serie(geocodigo, 'dengue', 202001)) from natal),
    'ult12', (select jsonb_object_agg(doenca, j) from ult12)
  );
$$;

revoke all on function public.painel_retrato(double precision) from public, anon, authenticated;

-- Retratos gravados (lidos em partes pelo scripts/montar_retrato.py).
create table if not exists app.retrato (
  id bigint generated always as identity primary key,
  gerado_em timestamptz default now(),
  corpo text not null,
  md5 text not null
);
revoke all on app.retrato from public, anon, authenticated;
-- insert into app.retrato (corpo, md5) select x, md5(x) from (select public.painel_retrato()::text x) q;
