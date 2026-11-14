-- VigiGen — 014: procedência correta do território quando a carga vem da rota
-- documentada do IBGE (servicodados: Localidades v1 + Malhas v3).
--
-- NÃO APLICADA EM PRODUÇÃO. Aplicar só com autorização expressa (auditoria
-- GO/NO-GO de 14/11/2026).
--
-- Problema (diagnóstico só leitura, 14/11/2026): public.ingest_ibge (003)
-- atualiza nome, meso, micro e geometria a partir da Malhas v3, mas não toca em
-- fonte, ano_referencia_malha nem geometria_simplificada. Depois que a API
-- voltou a responder, a carga de 01/11 usou a rota servicodados, porém a tabela
-- continuou dizendo 'IBGE GeoServer CCAR:BC250_2025_lml_municipio_a', e a
-- geometria simplificada (a que o painel desenha) continuou sendo a do BC250,
-- enquanto a geometria completa passou a ser a da Malhas v3: mistura de duas
-- malhas sem registro.
--
-- Correção: a rota servicodados grava a própria fonte, recalcula a geometria
-- simplificada a partir da geometria que acabou de gravar e zera o ano de
-- referência, porque a Malhas v3 sem o parâmetro "periodo" não informa o ano
-- na resposta (não inventamos o ano). O bruto de cada carga continua em
-- public.bruto, ligado pelo id em execucao_ingestao.parametros->'bruto'.

create or replace function public.ingest_ibge(bruto_municipios bigint, bruto_malha bigint)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  with m as (
    select (e->>'id')::int as geocodigo,
           e->>'nome' as nome,
           e->'microrregiao'->>'nome' as micro,
           e->'microrregiao'->'mesorregiao'->>'nome' as meso
    from public.bruto b, jsonb_array_elements(b.corpo::jsonb) e
    where b.id = bruto_municipios
  ), g as (
    select (f->'properties'->>'codarea')::int as geocodigo,
           extensions.ST_Multi(extensions.ST_SetSRID(
             extensions.ST_GeomFromGeoJSON((f->'geometry')::text), 4674)) as geom
    from public.bruto b, jsonb_array_elements(b.corpo::jsonb->'features') f
    where b.id = bruto_malha
  )
  insert into public.municipio (geocodigo, nome, mesorregiao, microrregiao, geometria,
                                geometria_simplificada, ano_referencia_malha, fonte, ingerido_em)
  select m.geocodigo, m.nome, m.meso, m.micro, g.geom,
         extensions.ST_Multi(extensions.ST_SimplifyPreserveTopology(g.geom, 0.003)),
         null, 'IBGE Localidades v1 + Malhas v3 (qualidade mínima)', now()
  from m left join g using (geocodigo)
  on conflict (geocodigo) do update
    set nome = excluded.nome, mesorregiao = excluded.mesorregiao,
        microrregiao = excluded.microrregiao,
        -- se a malha não trouxe o município, a geometria anterior fica, com a fonte anterior
        geometria = coalesce(excluded.geometria, public.municipio.geometria),
        geometria_simplificada = case when excluded.geometria is null
          then public.municipio.geometria_simplificada else excluded.geometria_simplificada end,
        ano_referencia_malha = case when excluded.geometria is null
          then public.municipio.ano_referencia_malha else null end,
        fonte = case when excluded.geometria is null
          then public.municipio.fonte || ' (nomes: IBGE Localidades v1)' else excluded.fonte end,
        ingerido_em = now();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.ingest_ibge(bigint, bigint) from public, anon, authenticated;
grant execute on function public.ingest_ibge(bigint, bigint) to service_role;

-- Depois de aplicar, a próxima carga mensal do IBGE (ou um disparo manual
-- autorizado) regrava as 167 linhas com a fonte certa. Nada é reescrito aqui à
-- mão: a fonte só muda quando há bruto novo que a sustente.
--
-- Reversão: reaplicar a função de 003_ingestao.sql.
