-- VigiGen — 020: módulo de detecção de focos (R4 e R5) e contrato de entrada
-- para resultados de exame agregados por território (D-022).
--
-- NÃO APLICADA EM PRODUÇÃO. Aplicar só com autorização expressa do Baden.
-- Depende de 001/002 (alerta, municipio, RLS) e da 013 (coluna alerta.agravo).
-- Os alertas R4/R5 usam a tabela public.alerta que já existe; esta migração
-- só acrescenta um índice para a checagem de episódio e o contrato de entrada.
--
-- Contrato de entrada (exame_territorial): fica VAZIO até existir acordo
-- institucional com o LAIS/UFRN (PEP) ou a SESAP-RN (GAL). Recebe apenas
-- contagens já agregadas na origem. Nenhuma linha individual, nenhum nome,
-- CPF, CNS, data de nascimento, número da casa, rua ou CEP chega aqui: o
-- endereço é convertido em setor censitário ou bairro no ambiente do
-- controlador e descartado. Contagens de 1 a 4 num setor sobem para o bairro
-- (supressão de células pequenas, feita na origem e conferida aqui).

-- 1) Índice para a regra de episódio (um alerta por foco, não um por semana)
create index if not exists alerta_focos_episodio
  on public.alerta (geocodigo, agravo, tipo, periodo_deteccao)
  where tipo in ('R4_aumento_local', 'R5_aglomerado');

-- 2) Contrato de entrada: resultados de exame agregados por território e semana
create table if not exists public.exame_territorial (
  id                    bigint generated always as identity primary key,
  fonte                 text not null check (fonte in ('lais_pep', 'lacen_gal', 'esus')),
  geocodigo             integer not null references public.municipio(geocodigo),
  territorio_tipo       text not null check (territorio_tipo in ('setor_censitario', 'bairro', 'municipio')),
  territorio_codigo     text not null,       -- código IBGE do setor (15 dígitos) ou do bairro; geocodigo no nível município
  semana_epidemiologica integer not null check (semana_epidemiologica between 200001 and 209953),
  agravo                text not null check (agravo in ('dengue', 'chikungunya', 'zika')),
  tipo_exame            text not null check (tipo_exame in ('ns1', 'igm', 'rt_pcr', 'outro')),
  resultado             text not null check (resultado in ('reagente', 'nao_reagente', 'inconclusivo')),
  sorotipo              text check (sorotipo in ('DENV1', 'DENV2', 'DENV3', 'DENV4')),
  qualidade_geocodigo   text not null check (qualidade_geocodigo in ('logradouro', 'bairro', 'localidade', 'nao_localizado')),
  n                     integer not null check (n >= 0),
  local_infeccao        text not null default 'residencia'
                        check (local_infeccao in ('residencia', 'investigado')),
  bruto_id              bigint references public.bruto(id),
  recebido_em           timestamptz not null default now(),
  -- célula pequena só existe no nível município (onde já não identifica ninguém)
  constraint exame_territorial_celula_pequena check (n = 0 or n >= 5 or territorio_tipo = 'municipio'),
  unique (fonte, territorio_tipo, territorio_codigo, semana_epidemiologica, agravo, tipo_exame, resultado,
          sorotipo, qualidade_geocodigo, local_infeccao)
);
comment on table public.exame_territorial is
  'Contrato de entrada (D-022): contagens de exames agregadas na origem por setor censitário ou bairro. '
  'Sem dado pessoal. Vazia até o acordo com LAIS/UFRN ou SESAP-RN.';

alter table public.exame_territorial enable row level security;
drop policy if exists exame_territorial_territorio on public.exame_territorial;
create policy exame_territorial_territorio on public.exame_territorial
  for select to authenticated using (app.pode_ver_geocodigo(geocodigo));
revoke insert, update, delete, truncate, references, trigger on public.exame_territorial from anon, authenticated;

-- a fonte 'bruto' só aceita as fontes atuais; a carga futura acrescenta a sua
-- com uma migração própria, junto com a Edge Function do convênio.

-- Reverter:
--   drop table public.exame_territorial;
--   drop index public.alerta_focos_episodio;
