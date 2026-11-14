-- VigiGen — 018: clima das estações automáticas do INMET no RN (D-021).
--
-- Fonte: arquivo anual de dados históricos do INMET
-- (https://portal.inmet.gov.br/uploads/dadoshistoricos/<ano>.zip). A rota
-- apitempo /estacao/{inicio}/{fim}/{codigo} respondeu 204 sem corpo em
-- 14/11/2026 (sem token), então não é usada. O ZIP é baixado pelo CLI Python
-- (src/ingest/inmet.py); cada CSV de estação do RN é gravado inteiro em
-- public.bruto (fonte 'inmet', aceita desde a 017) e normalizado aqui.
--
-- Só acrescenta: três tabelas, uma view e funções. Não muda RLS existente,
-- papéis nem login. Reversão: drop function public.painel_clima,
-- public.ingest_inmet; drop view public.clima_semanal; drop table
-- public.clima_horario, public.estacao_meteorologica.

create table if not exists public.estacao_meteorologica (
  codigo        text primary key,                 -- código WMO, ex. A304
  nome          text not null,
  uf            text not null,
  latitude      numeric,
  longitude     numeric,
  altitude      numeric,
  geocodigo     integer references public.municipio(geocodigo),  -- município pelo nome da estação
  bruto_id      bigint references public.bruto(id),
  ingerido_em   timestamptz not null default now()
);

create table if not exists public.clima_horario (
  estacao          text not null references public.estacao_meteorologica(codigo),
  data_hora_utc    timestamptz not null,
  precipitacao_mm  numeric,      -- PRECIPITAÇÃO TOTAL, HORÁRIO (mm)
  temperatura_c    numeric,      -- TEMPERATURA DO AR - BULBO SECO, HORARIA (°C)
  umidade_pct      numeric,      -- UMIDADE RELATIVA DO AR, HORARIA (%)
  bruto_id         bigint not null references public.bruto(id),
  primary key (estacao, data_hora_utc)
);

-- Lê um CSV do INMET (texto já em UTF-8): 8 linhas de cabeçalho "CHAVE:;valor",
-- depois a linha de títulos e as medições horárias separadas por ';' com
-- vírgula decimal. As colunas são achadas pelo título, não pela posição,
-- porque o leiaute mudou entre anos. -9999 e vazio viram nulo.
create or replace function public.ingest_inmet(p_bruto bigint)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_corpo text; linhas text[]; meta jsonb := '{}'; i int; h int; titulos text[];
  c_prec int; c_temp int; c_umid int; v_cod text; n int;
begin
  select corpo into v_corpo from public.bruto
   where id = p_bruto and fonte = 'inmet' and status_http = 200;
  if v_corpo is null then
    raise exception 'bruto % não é um CSV do INMET com HTTP 200', p_bruto;
  end if;
  linhas := regexp_split_to_array(v_corpo, E'\r?\n');
  for i in 1 .. least(array_length(linhas, 1), 20) loop
    if upper(linhas[i]) like 'DATA%;HORA%' then h := i; exit; end if;  -- não confundir com "DATA DE FUNDACAO:"
    meta := meta || jsonb_build_object(upper(rtrim(split_part(linhas[i], ';', 1), ':')),
                                       split_part(linhas[i], ';', 2));
  end loop;
  if h is null then raise exception 'bruto %: linha de títulos não encontrada', p_bruto; end if;
  titulos := string_to_array(upper(linhas[h]), ';');
  for i in 1 .. array_length(titulos, 1) loop
    if titulos[i] like 'PRECIPITA%TOTAL%' then c_prec := i;
    elsif titulos[i] like '%BULBO SECO%' then c_temp := i;
    elsif titulos[i] like 'UMIDADE RELATIVA DO AR%' then c_umid := i;
    end if;
  end loop;
  if c_prec is null or c_temp is null or c_umid is null then
    raise exception 'bruto %: colunas de chuva, temperatura ou umidade não encontradas', p_bruto;
  end if;
  v_cod := meta->>'CODIGO (WMO)';

  insert into public.estacao_meteorologica as t (codigo, nome, uf, latitude, longitude, altitude, geocodigo, bruto_id, ingerido_em)
  select v_cod, meta->>'ESTACAO', meta->>'UF',
         nullif(replace(meta->>'LATITUDE', ',', '.'), '')::numeric,
         nullif(replace(meta->>'LONGITUDE', ',', '.'), '')::numeric,
         nullif(replace(meta->>'ALTITUDE', ',', '.'), '')::numeric,
         (select m.geocodigo from public.municipio m
           where m.uf = meta->>'UF'
             and upper(translate(m.nome, 'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç''', 'AAAAEEIOOOUCaaaaeeiooouc ')) =
                 upper(translate(meta->>'ESTACAO', 'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç''', 'AAAAEEIOOOUCaaaaeeiooouc '))),
         p_bruto, now()
  on conflict (codigo) do update set nome = excluded.nome, uf = excluded.uf, latitude = excluded.latitude,
    longitude = excluded.longitude, altitude = excluded.altitude, geocodigo = excluded.geocodigo,
    bruto_id = excluded.bruto_id, ingerido_em = now();

  insert into public.clima_horario as t (estacao, data_hora_utc, precipitacao_mm, temperatura_c, umidade_pct, bruto_id)
  select v_cod,
         (replace(c[1], '/', '-') || ' ' || left(regexp_replace(c[2], '\D', '', 'g'), 2) || ':'
            || substr(regexp_replace(c[2], '\D', '', 'g'), 3, 2) || ':00+00')::timestamptz,
         nullif(nullif(replace(c[c_prec], ',', '.'), ''), '-9999')::numeric,
         nullif(nullif(replace(c[c_temp], ',', '.'), ''), '-9999')::numeric,
         nullif(nullif(replace(c[c_umid], ',', '.'), ''), '-9999')::numeric,
         p_bruto
  from (select string_to_array(l, ';') c from unnest(linhas[h + 1:]) l
        where l ~ '^\d{4}[-/]\d{2}[-/]\d{2};') x
  on conflict (estacao, data_hora_utc) do update set precipitacao_mm = excluded.precipitacao_mm,
    temperatura_c = excluded.temperatura_c, umidade_pct = excluded.umidade_pct, bruto_id = excluded.bruto_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Semana de domingo a sábado (mesma partida da semana epidemiológica), por
-- estação. Só soma a chuva de semanas com as 168 horas medidas; nas demais
-- a soma sai nula e o número de horas aparece.
create or replace view public.clima_semanal with (security_invoker = true) as
  select h.estacao, e.geocodigo,
         (date_trunc('week', (h.data_hora_utc at time zone 'UTC')::date + 1) - interval '1 day')::date as semana_inicio,
         count(*) filter (where h.precipitacao_mm is not null) as horas_chuva,
         case when count(*) filter (where h.precipitacao_mm is not null) = 168 then sum(h.precipitacao_mm) end as chuva_mm,
         round(avg(h.temperatura_c), 1) as temperatura_media_c,
         min(h.temperatura_c) as temperatura_min_c, max(h.temperatura_c) as temperatura_max_c,
         round(avg(h.umidade_pct), 0) as umidade_media_pct,
         max(h.bruto_id) as bruto_id
  from public.clima_horario h join public.estacao_meteorologica e on e.codigo = h.estacao
  group by 1, 2, 3;

create or replace function public.painel_clima(p_geocodigo integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'geocodigo', p_geocodigo,
    'fonte', 'INMET, dados históricos das estações automáticas (portal.inmet.gov.br/dadoshistoricos)',
    'estacoes', coalesce((select jsonb_agg(jsonb_build_object('codigo', codigo, 'nome', nome)) from public.estacao_meteorologica
                          where geocodigo = p_geocodigo), '[]'),
    'semanas', coalesce((select jsonb_agg(to_jsonb(s) - 'geocodigo' order by s.semana_inicio, s.estacao)
                         from public.clima_semanal s where s.geocodigo = p_geocodigo), '[]'),
    'ingerido_em', (select max(ingerido_em) from public.estacao_meteorologica where geocodigo = p_geocodigo));
$$;

alter table public.estacao_meteorologica enable row level security;
alter table public.clima_horario enable row level security;
-- dado público de clima, como a malha do IBGE
drop policy if exists estacao_meteorologica_leitura on public.estacao_meteorologica;
create policy estacao_meteorologica_leitura on public.estacao_meteorologica for select to authenticated using (true);
drop policy if exists clima_horario_leitura on public.clima_horario;
create policy clima_horario_leitura on public.clima_horario for select to authenticated using (true);

revoke all on public.estacao_meteorologica, public.clima_horario, public.clima_semanal from anon;
revoke all on function public.ingest_inmet(bigint) from public, anon, authenticated;
grant execute on function public.ingest_inmet(bigint) to service_role;
revoke all on function public.painel_clima(integer) from public, anon;
grant execute on function public.painel_clima(integer) to authenticated;
