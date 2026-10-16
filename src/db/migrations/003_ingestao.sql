-- VigiGen — 003: transformação bruto -> tabelas, feita no banco.
-- As Edge Functions só buscam e gravam a resposta crua em public.bruto;
-- a normalização acontece aqui, rastreável pelo bruto_id.

create extension if not exists unaccent with schema extensions;

-- Normaliza nomes para casar texto livre (geo_loc_name) com nomes do IBGE.
create or replace function app.norm(t text)
returns text language sql immutable set search_path = '' as $$
  select lower(regexp_replace(extensions.unaccent(coalesce(t,'')), '[^a-zA-Z0-9 ]', ' ', 'g'));
$$;

-- Token das funções de ingestão (guardado no Vault; validado pela função).
create or replace function public.ingest_token_valido(t text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets
                 where name = 'vigigen_ingest_token' and decrypted_secret = t);
$$;
revoke all on function public.ingest_token_valido(text) from public, anon, authenticated;
grant execute on function public.ingest_token_valido(text) to service_role;

-- ---------------------------------------------------------------------------
-- IBGE: municípios (Localidades v1) + malha (Malhas v3) -> public.municipio
-- ---------------------------------------------------------------------------
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
  insert into public.municipio (geocodigo, nome, mesorregiao, microrregiao, geometria, ingerido_em)
  select m.geocodigo, m.nome, m.meso, m.micro, g.geom, now()
  from m left join g using (geocodigo)
  on conflict (geocodigo) do update
    set nome = excluded.nome, mesorregiao = excluded.mesorregiao,
        microrregiao = excluded.microrregiao,
        geometria = coalesce(excluded.geometria, public.municipio.geometria),
        ingerido_em = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- InfoDengue /api/alertcity -> public.caso_semanal
-- Campos conferidos na resposta real de Natal (SE 202501-02) em 2026-10-16:
-- data_iniSE (epoch ms), SE, casos, casos_est(_min/_max), p_inc100k, Rt,
-- p_rt1, nivel, pop, receptivo, transmissao.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_infodengue(p_bruto bigint, p_geocodigo int, p_doenca text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.caso_semanal as c (
    geocodigo, doenca, semana_epidemiologica, ano, data_inicio_se, casos,
    casos_estimados, casos_estimados_min, casos_estimados_max, incidencia_100k,
    rt, p_rt1, nivel_alerta, populacao, receptivo, transmissao, bruto_id, ingerido_em)
  select p_geocodigo, p_doenca, (r->>'SE')::int, (r->>'SE')::int / 100,
         (to_timestamp((r->>'data_iniSE')::bigint / 1000) at time zone 'UTC')::date,
         (r->>'casos')::numeric::int,
         (r->>'casos_est')::numeric, (r->>'casos_est_min')::numeric, (r->>'casos_est_max')::numeric,
         (r->>'p_inc100k')::numeric, (r->>'Rt')::numeric, (r->>'p_rt1')::numeric,
         (r->>'nivel')::smallint, nullif(r->>'pop','')::numeric,
         (r->>'receptivo')::smallint, (r->>'transmissao')::smallint, p_bruto, now()
  from public.bruto b, jsonb_array_elements(b.corpo::jsonb) r
  where b.id = p_bruto and r ? 'SE'
  on conflict (geocodigo, doenca, semana_epidemiologica) do update set
    casos = excluded.casos, casos_estimados = excluded.casos_estimados,
    casos_estimados_min = excluded.casos_estimados_min,
    casos_estimados_max = excluded.casos_estimados_max,
    incidencia_100k = excluded.incidencia_100k, rt = excluded.rt, p_rt1 = excluded.p_rt1,
    nivel_alerta = excluded.nivel_alerta, populacao = excluded.populacao,
    receptivo = excluded.receptivo, transmissao = excluded.transmissao,
    bruto_id = excluded.bruto_id, ingerido_em = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- GenBank (efetch rettype=gb retmode=xml, GBSet) -> public.sequencia
-- ---------------------------------------------------------------------------

-- Datas do GenBank: "2019", "Mar-2019", "15-Mar-2019", "2019-03", "2019-03-15".
create or replace function app.data_genbank(t text)
returns date language plpgsql immutable set search_path = '' as $$
begin
  if t is null or t = '' then return null; end if;
  t := split_part(t, '/', 1);  -- intervalos "2018/2019": usa o início
  if t ~ '^\d{4}-\d{2}-\d{2}$' then return t::date; end if;
  if t ~ '^\d{4}-\d{2}$' then return (t || '-01')::date; end if;
  if t ~ '^\d{4}$' then return (t || '-01-01')::date; end if;
  if t ~* '^\d{1,2}-[a-z]{3}-\d{4}$' then return to_date(t, 'DD-Mon-YYYY'); end if;
  if t ~* '^[a-z]{3}-\d{4}$' then return to_date('01-' || t, 'DD-Mon-YYYY'); end if;
  return null;
exception when others then return null;
end;
$$;

create or replace function app.sorotipo_de(t text)
returns text language sql immutable set search_path = '' as $$
  select case
    when t ~* '(dengue virus|denv)[ -]*(type[ -]*)?1\M' or t ~* '^\s*(type\s*)?1\s*$' or t ~* 'serotype[ -]*1\M' then 'DENV-1'
    when t ~* '(dengue virus|denv)[ -]*(type[ -]*)?2\M' or t ~* '^\s*(type\s*)?2\s*$' or t ~* 'serotype[ -]*2\M' then 'DENV-2'
    when t ~* '(dengue virus|denv)[ -]*(type[ -]*)?3\M' or t ~* '^\s*(type\s*)?3\s*$' or t ~* 'serotype[ -]*3\M' then 'DENV-3'
    when t ~* '(dengue virus|denv)[ -]*(type[ -]*)?4\M' or t ~* '^\s*(type\s*)?4\s*$' or t ~* 'serotype[ -]*4\M' then 'DENV-4'
  end;
$$;

create or replace function public.ingest_genbank(p_bruto bigint)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  with doc as (
    select xmlparse(document b.corpo) as x from public.bruto b where b.id = p_bruto
  ), seqs as (
    select unnest(xpath('/GBSet/GBSeq', doc.x)) as s from doc
  ), campos as (
    select
      (xpath('/GBSeq/GBSeq_primary-accession/text()', s))[1]::text as accession,
      (xpath('/GBSeq/GBSeq_organism/text()', s))[1]::text as organismo,
      (xpath('/GBSeq/GBSeq_definition/text()', s))[1]::text as titulo,
      (xpath('/GBSeq/GBSeq_length/text()', s))[1]::text::int as tamanho,
      (xpath('/GBSeq/GBSeq_create-date/text()', s))[1]::text as criado,
      upper((xpath('/GBSeq/GBSeq_sequence/text()', s))[1]::text) as seq,
      (xpath('/GBSeq/GBSeq_feature-table/GBFeature[GBFeature_key="source"][1]/GBFeature_quals/GBQualifier[GBQualifier_name="geo_loc_name"]/GBQualifier_value/text()', s))[1]::text as geo_loc_name,
      (xpath('/GBSeq/GBSeq_feature-table/GBFeature[GBFeature_key="source"][1]/GBFeature_quals/GBQualifier[GBQualifier_name="country"]/GBQualifier_value/text()', s))[1]::text as country,
      (xpath('/GBSeq/GBSeq_feature-table/GBFeature[GBFeature_key="source"][1]/GBFeature_quals/GBQualifier[GBQualifier_name="collection_date"]/GBQualifier_value/text()', s))[1]::text as collection_date,
      (xpath('/GBSeq/GBSeq_feature-table/GBFeature[GBFeature_key="source"][1]/GBFeature_quals/GBQualifier[GBQualifier_name="host"]/GBQualifier_value/text()', s))[1]::text as host,
      (xpath('/GBSeq/GBSeq_feature-table/GBFeature[GBFeature_key="source"][1]/GBFeature_quals/GBQualifier[GBQualifier_name="serotype"]/GBQualifier_value/text()', s))[1]::text as serotype
    from seqs
  ), enriquecido as (
    select c.*, coalesce(c.geo_loc_name, c.country) as geo,
           app.norm(coalesce(c.geo_loc_name, c.country)) as geo_norm
    from campos c
  )
  insert into public.sequencia as q (
    accession, organismo, sorotipo_declarado, data_coleta, data_coleta_inicio,
    data_publicacao, geocodigo, uf_inferida, pais, geo_loc_bruto, hospedeiro,
    tamanho, titulo, sequencia_fasta, bruto_id, ingerido_em)
  select e.accession, e.organismo,
         coalesce(app.sorotipo_de(e.serotype), app.sorotipo_de(e.organismo), app.sorotipo_de(e.titulo)),
         e.collection_date, app.data_genbank(e.collection_date),
         app.data_genbank(e.criado),
         -- município só quando o geo_loc cita RN e exatamente um nome de município do RN
         case when e.geo_norm ~ '\mrio grande do norte\M' or e.geo_norm ~ '\mrn\M' then (
           select case when count(*) = 1 then min(m.geocodigo) end
           from public.municipio m
           where (' ' || regexp_replace(e.geo_norm, '\mrio grande do norte\M', ' ', 'g') || ' ')
                 like '% ' || app.norm(m.nome) || ' %'
         ) end,
         case when e.geo_norm ~ '\mrio grande do norte\M' then 'RN' end,
         nullif(trim(split_part(e.geo, ':', 1)), ''),
         e.geo, e.host, e.tamanho, e.titulo,
         case when e.seq is not null then '>' || e.accession || E'\n' || e.seq end,
         p_bruto, now()
  from enriquecido e
  where e.accession is not null
  on conflict (accession) do update set
    organismo = excluded.organismo, sorotipo_declarado = excluded.sorotipo_declarado,
    data_coleta = excluded.data_coleta, data_coleta_inicio = excluded.data_coleta_inicio,
    data_publicacao = excluded.data_publicacao, geocodigo = excluded.geocodigo,
    uf_inferida = excluded.uf_inferida, pais = excluded.pais,
    geo_loc_bruto = excluded.geo_loc_bruto, hospedeiro = excluded.hospedeiro,
    tamanho = excluded.tamanho, titulo = excluded.titulo,
    sequencia_fasta = excluded.sequencia_fasta, bruto_id = excluded.bruto_id,
    ingerido_em = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.ingest_ibge(bigint, bigint) from public, anon, authenticated;
revoke all on function public.ingest_infodengue(bigint, int, text) from public, anon, authenticated;
revoke all on function public.ingest_genbank(bigint) from public, anon, authenticated;
grant execute on function public.ingest_ibge(bigint, bigint) to service_role;
grant execute on function public.ingest_infodengue(bigint, int, text) to service_role;
grant execute on function public.ingest_genbank(bigint) to service_role;
