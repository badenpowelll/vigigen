-- VigiGen — 001: schema base
-- Tabelas do Prompt 3 + procedência (bruto) + execuções de ingestão.
-- Geometria em PostGIS, SRID 4674 (SIRGAS 2000, o datum do IBGE).

create extension if not exists postgis with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Procedência: toda resposta externa é gravada aqui ANTES de transformar.
-- (Regra 3 do CLAUDE.md: "data/raw" no banco.)
-- ---------------------------------------------------------------------------
create table public.bruto (
  id            bigint generated always as identity primary key,
  fonte         text not null check (fonte in ('ibge','infodengue','genbank','nextclade')),
  endpoint      text not null,
  parametros    jsonb not null default '{}'::jsonb,
  status_http   integer,
  obtido_em     timestamptz not null default now(),
  sha256        text,
  tamanho_bytes integer,
  corpo         text            -- resposta crua, sem transformação
);
create index on public.bruto (fonte, obtido_em desc);

create table public.execucao_ingestao (
  id            bigint generated always as identity primary key,
  fonte         text not null,
  parametros    jsonb not null default '{}'::jsonb,
  iniciado_em   timestamptz not null default now(),
  finalizado_em timestamptz,
  status        text not null default 'em_andamento'
                check (status in ('em_andamento','ok','vazio','erro')),
  registros     integer,
  mensagem      text
);

-- ---------------------------------------------------------------------------
-- Território
-- ---------------------------------------------------------------------------
create table public.municipio (
  geocodigo     integer primary key,          -- id IBGE, 7 dígitos
  nome          text not null,
  uf            text not null default 'RN',
  mesorregiao   text,
  microrregiao  text,
  geometria     extensions.geometry(MultiPolygon, 4674),
  fonte         text not null default 'IBGE Localidades v1 + Malhas v3',
  ingerido_em   timestamptz not null default now()
);
create index on public.municipio using gist (geometria);

-- ---------------------------------------------------------------------------
-- Organizações e papéis (multi-tenant)
-- ---------------------------------------------------------------------------
create table public.organizacao (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  tipo           text not null check (tipo in ('municipio','estado','laboratorio')),
  geocodigo_ibge integer references public.municipio(geocodigo),
  uf             text not null default 'RN',
  check ((tipo = 'municipio') = (geocodigo_ibge is not null))
);

create table public.usuario_organizacao (
  user_id         uuid not null references auth.users(id) on delete cascade,
  organizacao_id  uuid not null references public.organizacao(id) on delete cascade,
  papel           text not null check (papel in ('gestor','vigilancia','laboratorio','leitura')),
  primary key (user_id, organizacao_id)
);

-- ---------------------------------------------------------------------------
-- Epidemiologia (InfoDengue)
-- ---------------------------------------------------------------------------
create table public.caso_semanal (
  geocodigo             integer not null references public.municipio(geocodigo),
  doenca                text not null check (doenca in ('dengue','chikungunya','zika')),
  semana_epidemiologica integer not null,      -- SE no formato AAAASS
  ano                   integer not null,
  data_inicio_se        date not null,
  casos                 integer,
  casos_estimados       numeric,
  casos_estimados_min   numeric,
  casos_estimados_max   numeric,
  incidencia_100k       numeric,
  rt                    numeric,
  p_rt1                 numeric,
  nivel_alerta          smallint check (nivel_alerta between 1 and 4),
  populacao             numeric,
  receptivo             smallint,
  transmissao           smallint,
  fonte                 text not null default 'InfoDengue (Fiocruz/FGV) /api/alertcity',
  bruto_id              bigint references public.bruto(id),
  ingerido_em           timestamptz not null default now(),
  primary key (geocodigo, doenca, semana_epidemiologica)
);
create index on public.caso_semanal (doenca, semana_epidemiologica);

-- ---------------------------------------------------------------------------
-- Genômica
-- ---------------------------------------------------------------------------
create table public.sequencia (
  accession            text primary key,
  organismo            text,
  sorotipo_declarado   text,                  -- DENV-1..4 quando o registro declara
  data_coleta          text,                  -- como veio (pode ser só ano ou ano-mês)
  data_coleta_inicio   date,                  -- primeiro dia compatível com data_coleta
  data_publicacao      date,                  -- GBSeq_create-date (disponibilidade pública)
  geocodigo            integer references public.municipio(geocodigo),
  uf_inferida          text,                  -- 'RN' quando geo_loc cita Rio Grande do Norte
  pais                 text,
  geo_loc_bruto        text,
  hospedeiro           text,
  tamanho              integer,
  titulo               text,
  sequencia_fasta      text,                  -- só para registros com origem no RN
  fonte                text not null default 'NCBI GenBank (E-utilities)',
  bruto_id             bigint references public.bruto(id),
  ingerido_em          timestamptz not null default now()
);
create index on public.sequencia (uf_inferida);
create index on public.sequencia (geocodigo);

create table public.classificacao (
  accession         text primary key references public.sequencia(accession) on delete cascade,
  sorotipo          text,
  genotipo          text,
  linhagem          text,
  cobertura         numeric,
  qc_status         text,
  dataset_nome      text not null,
  dataset_tag       text not null,
  nextclade_versao  text not null,
  classificado_em   timestamptz not null default now()
);

create table public.exclusao_qc (
  id           bigint generated always as identity primary key,
  accession    text not null references public.sequencia(accession) on delete cascade,
  motivo       text not null,
  detalhe      text,
  avaliado_em  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indicadores, alertas e auditoria
-- ---------------------------------------------------------------------------
create table public.indicador (
  id            bigint generated always as identity primary key,
  geocodigo     integer references public.municipio(geocodigo),  -- null = nível estadual
  nivel         text not null default 'municipio' check (nivel in ('municipio','estado')),
  periodo       text not null,                 -- ex.: 2025T3, 2025
  tipo          text not null,                 -- cobertura_sequenciamento | oportunidade_mediana_dias ...
  valor         numeric,                       -- null quando não calculável
  numerador     numeric,
  denominador   numeric,
  motivo_nulo   text,
  detalhe       jsonb not null default '{}'::jsonb,
  calculado_em  timestamptz not null default now(),
  unique nulls not distinct (geocodigo, nivel, periodo, tipo)
);

create table public.alerta (
  id                uuid primary key default gen_random_uuid(),
  geocodigo         integer references public.municipio(geocodigo),
  tipo              text not null,           -- R1_linhagem_nova | R2_crescimento_proporcao | R3_queda_cobertura
  periodo_deteccao  text not null,
  evidencia         jsonb not null,
  status            text not null default 'novo'
                    check (status in ('novo','em_analise','confirmado','descartado')),
  revisado_por      uuid references auth.users(id),
  revisado_em       timestamptz,
  criado_em         timestamptz not null default now()
);

create table public.auditoria (
  id           bigint generated always as identity primary key,
  ator         text not null,
  acao         text not null,
  entidade     text not null,
  entidade_id  text,
  ocorrido_em  timestamptz not null default now(),
  detalhe      jsonb not null default '{}'::jsonb
);
