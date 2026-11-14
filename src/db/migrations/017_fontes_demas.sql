-- VigiGen — 017: notificações do SINAN (agregadas) e estabelecimentos do CNES,
-- pela API de Dados Abertos do Ministério da Saúde (DEMAS), D-020.
--
-- Só acrescenta: duas tabelas, uma view, funções de normalização e leitura.
-- Não apaga nem altera dado existente. A única alteração de objeto existente é
-- ampliar a lista de fontes aceitas em public.bruto (check refeito com os
-- valores antigos + 'sinan', 'cnes', 'inmet'). Não muda RLS, papéis nem login.
-- Os agendamentos (pg_cron) ficam em 019, aplicados só com aprovação.
--
-- SINAN: a resposta original tem dado pessoal e não é gravada (exceção à
-- regra 3, decidida em D-020). public.bruto recebe, por página, só a contagem
-- por chave não pessoal (ano, semana de notificação, municípios de notificação
-- e residência, classificação final, critério, sorotipo), com o sha256, o
-- tamanho e o número de registros da resposta original em `parametros`.
--
-- Reversão: drop function public.painel_sinan, public.ingest_sinan,
-- public.ingest_cnes; drop view public.notificacao_sinan_vigente;
-- drop table public.notificacao_sinan, public.estabelecimento; e o check de
-- bruto volta à lista antiga (só se não houver linhas das fontes novas).

-- 1) Fontes aceitas em bruto -------------------------------------------------
alter table public.bruto drop constraint if exists bruto_fonte_check;
alter table public.bruto add constraint bruto_fonte_check
  check (fonte in ('ibge','infodengue','genbank','nextclade','sinan','cnes','inmet'));

-- 2) SINAN: contagens por página ---------------------------------------------
create table if not exists public.notificacao_sinan (
  id                     bigint generated always as identity primary key,
  execucao_id            bigint not null references public.execucao_ingestao(id),
  bruto_id               bigint not null references public.bruto(id),
  agravo                 text not null check (agravo in ('dengue','chikungunya','zika')),
  ano                    integer not null,               -- nu_ano
  semana_notificacao     integer,                        -- sem_not, AAAASS
  mun_notificacao6       text,                           -- id_municip (6 dígitos)
  mun_residencia6        text,                           -- id_mn_resi (6 dígitos)
  geocodigo_notificacao  integer references public.municipio(geocodigo),
  geocodigo_residencia   integer references public.municipio(geocodigo),  -- nulo se fora do RN
  classi_fin             text,                           -- código, como veio (dicionário do SINAN)
  criterio               text,
  sorotipo               text,
  n                      integer not null check (n > 0),
  ingerido_em            timestamptz not null default now()
);
create index if not exists notificacao_sinan_exec on public.notificacao_sinan (execucao_id, agravo, ano);
create index if not exists notificacao_sinan_resid on public.notificacao_sinan (geocodigo_residencia, agravo, semana_notificacao);
create index if not exists notificacao_sinan_bruto on public.notificacao_sinan (bruto_id);

-- Normaliza uma página já agregada (corpo = {"agravo", "registros_originais",
-- "chave", "contagens": [{nu_ano, sem_not, id_municip, id_mn_resi, classi_fin,
-- criterio, sorotipo, n}]}). Idempotente por bruto_id.
create or replace function public.ingest_sinan(p_bruto bigint, p_execucao bigint)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if exists (select 1 from public.notificacao_sinan where bruto_id = p_bruto) then
    return 0;
  end if;
  insert into public.notificacao_sinan (execucao_id, bruto_id, agravo, ano, semana_notificacao,
    mun_notificacao6, mun_residencia6, geocodigo_notificacao, geocodigo_residencia,
    classi_fin, criterio, sorotipo, n)
  select p_execucao, b.id, b.corpo::jsonb->>'agravo',
         (c->>'nu_ano')::int,
         case when c->>'sem_not' ~ '^\d{6}$' then (c->>'sem_not')::int end,
         c->>'id_municip', c->>'id_mn_resi',
         (select m.geocodigo from public.municipio m where m.geocodigo / 10 = (c->>'id_municip')::int
            and c->>'id_municip' ~ '^\d{6}$'),
         (select m.geocodigo from public.municipio m where m.geocodigo / 10 = (c->>'id_mn_resi')::int
            and c->>'id_mn_resi' ~ '^\d{6}$'),
         c->>'classi_fin', c->>'criterio', c->>'sorotipo', (c->>'n')::int
  from public.bruto b, jsonb_array_elements(b.corpo::jsonb->'contagens') c
  where b.id = p_bruto and b.fonte = 'sinan' and b.status_http = 200 and c->>'nu_ano' ~ '^\d{4}$';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Só a execução concluída sem falha mais recente de cada (ano, agravo) vale;
-- execuções com erro ou em andamento nunca aparecem no painel.
create or replace view public.notificacao_sinan_vigente with (security_invoker = true) as
  with ultima as (
    select distinct on ((e.parametros->>'ano')::int, a.agravo)
           e.id, (e.parametros->>'ano')::int as ano, a.agravo
    from public.execucao_ingestao e
    cross join lateral jsonb_array_elements_text(e.parametros->'agravos') a(agravo)
    where e.fonte = 'sinan' and e.status = 'ok'
    order by (e.parametros->>'ano')::int, a.agravo, e.id desc
  )
  select s.* from public.notificacao_sinan s
  join ultima u on u.id = s.execucao_id and u.agravo = s.agravo and u.ano = s.ano;

-- Série semanal por município de RESIDÊNCIA (comparável ao InfoDengue), com a
-- classificação final em códigos, como o SINAN publica, e a procedência.
create or replace function public.painel_sinan(p_geocodigo integer, p_agravo text default 'dengue')
returns jsonb language sql stable security invoker set search_path = '' as $$
  with base as (
    select * from public.notificacao_sinan_vigente
    where agravo = p_agravo and geocodigo_residencia = p_geocodigo
  ), semana as (
    select se, sum(n_cf) total, jsonb_object_agg(cf, n_cf) por_classificacao
    from (select semana_notificacao se, coalesce(classi_fin, 'sem código') cf, sum(n) n_cf
          from base group by 1, 2) x
    group by se
  )
  select jsonb_build_object(
    'geocodigo', p_geocodigo, 'agravo', p_agravo,
    'fonte', 'SINAN via API DEMAS (Ministério da Saúde), contagens por município de residência',
    'semanas', coalesce((select jsonb_agg(jsonb_build_object('se', se, 'n', total, 'classi_fin', por_classificacao) order by se) from semana), '[]'),
    'sorotipos', coalesce((select jsonb_object_agg(sorotipo, n) from
                   (select sorotipo, sum(n) n from base where sorotipo is not null group by 1) q), '{}'),
    'execucoes', coalesce((select jsonb_agg(distinct execucao_id) from base), '[]'),
    'brutos', (select count(distinct bruto_id) from base),
    'ingerido_em', (select max(ingerido_em) from base));
$$;

-- 3) CNES: estabelecimentos --------------------------------------------------
create table if not exists public.estabelecimento (
  codigo_cnes            integer primary key,
  geocodigo              integer references public.municipio(geocodigo),
  codigo_municipio6      text,
  nome                   text,          -- nome fantasia; nulo para estabelecimento sem CNPJ (pessoa física)
  codigo_tipo_unidade    integer,
  esfera_administrativa  text,
  natureza_juridica      text,
  tipo_gestao            text,
  atende_sus             text,
  latitude               numeric,
  longitude              numeric,
  data_atualizacao       date,
  fonte                  text not null default 'CNES via API DEMAS /cnes/estabelecimentos',
  bruto_id               bigint references public.bruto(id),
  ingerido_em            timestamptz not null default now()
);
create index if not exists estabelecimento_geocodigo on public.estabelecimento (geocodigo, codigo_tipo_unidade);

create or replace function public.ingest_cnes(p_bruto bigint)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.estabelecimento as t (codigo_cnes, geocodigo, codigo_municipio6, nome,
    codigo_tipo_unidade, esfera_administrativa, natureza_juridica, tipo_gestao, atende_sus,
    latitude, longitude, data_atualizacao, bruto_id, ingerido_em)
  select (e->>'codigo_cnes')::int,
         (select m.geocodigo from public.municipio m where m.geocodigo / 10 = (e->>'codigo_municipio')::int),
         e->>'codigo_municipio',
         case when nullif(e->>'numero_cnpj', '') is not null or nullif(e->>'numero_cnpj_entidade', '') is not null
              then e->>'nome_fantasia' end,
         nullif(e->>'codigo_tipo_unidade', '')::int,
         e->>'descricao_esfera_administrativa',
         e->>'descricao_natureza_juridica_estabelecimento',
         e->>'tipo_gestao',
         e->>'estabelecimento_faz_atendimento_ambulatorial_sus',
         case when e->>'latitude_estabelecimento_decimo_grau' ~ '^-?\d+(\.\d+)?$' then (e->>'latitude_estabelecimento_decimo_grau')::numeric end,
         case when e->>'longitude_estabelecimento_decimo_grau' ~ '^-?\d+(\.\d+)?$' then (e->>'longitude_estabelecimento_decimo_grau')::numeric end,
         case when e->>'data_atualizacao' ~ '^\d{4}-\d{2}-\d{2}' then left(e->>'data_atualizacao', 10)::date end,
         p_bruto, now()
  from public.bruto b, jsonb_array_elements(b.corpo::jsonb->'estabelecimentos') e
  where b.id = p_bruto and b.fonte = 'cnes' and b.status_http = 200 and e->>'codigo_cnes' ~ '^\d+$'
  on conflict (codigo_cnes) do update set
    geocodigo = excluded.geocodigo, codigo_municipio6 = excluded.codigo_municipio6, nome = excluded.nome,
    codigo_tipo_unidade = excluded.codigo_tipo_unidade, esfera_administrativa = excluded.esfera_administrativa,
    natureza_juridica = excluded.natureza_juridica, tipo_gestao = excluded.tipo_gestao,
    atende_sus = excluded.atende_sus, latitude = excluded.latitude, longitude = excluded.longitude,
    data_atualizacao = excluded.data_atualizacao, bruto_id = excluded.bruto_id, ingerido_em = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 4) RLS das tabelas novas (as existentes não mudam) ---------------------------
alter table public.notificacao_sinan enable row level security;
alter table public.estabelecimento enable row level security;
-- contagem por residência: mesmo recorte territorial de caso_semanal
-- (residência fora do RN = geocódigo nulo = só estado e laboratório)
drop policy if exists notificacao_sinan_territorio on public.notificacao_sinan;
create policy notificacao_sinan_territorio on public.notificacao_sinan
  for select to authenticated using (app.pode_ver_geocodigo(geocodigo_residencia));
-- cadastro público de estabelecimentos, como a malha do IBGE
drop policy if exists estabelecimento_leitura on public.estabelecimento;
create policy estabelecimento_leitura on public.estabelecimento
  for select to authenticated using (true);

revoke all on public.notificacao_sinan, public.estabelecimento from anon;
revoke all on public.notificacao_sinan_vigente from anon;
revoke all on function public.ingest_sinan(bigint, bigint) from public, anon, authenticated;
revoke all on function public.ingest_cnes(bigint) from public, anon, authenticated;
grant execute on function public.ingest_sinan(bigint, bigint) to service_role;
grant execute on function public.ingest_cnes(bigint) to service_role;
revoke all on function public.painel_sinan(integer, text) from public, anon;
grant execute on function public.painel_sinan(integer, text) to authenticated;
