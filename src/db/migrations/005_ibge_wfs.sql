-- VigiGen — 005: rota alternativa oficial do IBGE para o território.
-- Motivo: em 2026-10-16 o servicodados.ibge.gov.br recusou a verificação TLS
-- a partir do Supabase ("invalid peer certificate: UnknownIssuer"). Não
-- desligamos a verificação. Usamos outro serviço oficial do IBGE com TLS
-- válido: o GeoServer geoservicos.ibge.gov.br, camada
-- CCAR:BC250_2025_lml_municipio_a (Base Cartográfica Contínua 1:250.000,
-- edição 2025), que traz geocodigo, nome e geometria. O endpoint documentado
-- continua sendo tentado primeiro; ver docs/DECISIONS.md (D-003).

alter table public.municipio
  add column if not exists geometria_simplificada extensions.geometry(MultiPolygon, 4674),
  add column if not exists ano_referencia_malha integer;

alter table public.sequencia
  add column if not exists rn_por_nome_cepa boolean not null default false;

create or replace function public.ingest_ibge_wfs(p_bruto bigint)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  with f as (
    select (x->'properties'->>'geocodigo')::int as geocodigo,
           x->'properties'->>'nome' as nome,
           (x->'properties'->>'anodereferencia')::int as ano,
           extensions.ST_Multi(extensions.ST_SetSRID(
             extensions.ST_GeomFromGeoJSON((x->'geometry')::text), 4674)) as geom
    from public.bruto b, jsonb_array_elements(b.corpo::jsonb->'features') x
    where b.id = p_bruto and x->'properties'->>'geocodigo' like '24%'
  )
  insert into public.municipio (geocodigo, nome, geometria, geometria_simplificada,
                                ano_referencia_malha, fonte, ingerido_em)
  select geocodigo, nome, geom,
         extensions.ST_Multi(extensions.ST_SimplifyPreserveTopology(geom, 0.003)),
         ano, 'IBGE GeoServer CCAR:BC250_2025_lml_municipio_a', now()
  from f
  on conflict (geocodigo) do update set
    nome = excluded.nome, geometria = excluded.geometria,
    geometria_simplificada = excluded.geometria_simplificada,
    ano_referencia_malha = excluded.ano_referencia_malha,
    fonte = excluded.fonte, ingerido_em = now();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.ingest_ibge_wfs(bigint) from public, anon, authenticated;
grant execute on function public.ingest_ibge_wfs(bigint) to service_role;

-- Cepas com "/RN/" no nome mas sem RN no geo_loc: sinal secundário, contado à parte.
update public.sequencia set rn_por_nome_cepa = true
where titulo ~ '/RN/' and uf_inferida is null;

create or replace function app.sequencia_uf_rn()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.uf_inferida is null and app.norm(new.geo_loc_bruto) ~ '\mrn\M' then
    new.uf_inferida := 'RN';
  end if;
  new.rn_por_nome_cepa := (new.uf_inferida is null and coalesce(new.titulo, '') ~ '/RN/');
  return new;
end;
$$;
