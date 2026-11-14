# VigiGen

Vigilância genômica integrada para a gestão municipal de saúde. Junta casos
semanais de arboviroses (InfoDengue), sequências públicas de vírus dengue
(GenBank) e o território (IBGE) em indicadores e alertas para secretarias
municipais do Rio Grande do Norte. Artefato da tese de doutorado em
Bioinformática de Baden (UFRN/IMD), construído com Design Science Research.

Os dados não são instantâneos: são atualizados automaticamente, com a origem e
a data de cada número visíveis.

## O que roda hoje
- **Banco** Supabase (Postgres 17 + PostGIS), projeto `tizmhihnggbvjzsmnpne`,
  sa-east-1, com RLS por território e auditoria que não pode ser apagada.
- **Ingestão** em Edge Functions (`supabase/functions/`) agendadas pelo pg_cron.
  Toda resposta crua fica em `public.bruto` com sha256.
- **Indicadores** (`public.calcular_indicadores()`, a cada 6 h): cobertura de
  sequenciamento por município e estado, oportunidade por sorotipo e ano,
  qualidade dos metadados.
- **Painel** (`web/`): visão geral, mapa de calor, séries, alertas, qualidade do
  dado, perfil do município e fontes.

## Como verificar
```sql
select fonte, status, registros, finalizado_em from execucao_ingestao order by id;
select doenca, count(*), max(semana_epidemiologica) from caso_semanal group by 1;
select count(*), count(*) filter (where uf_inferida = 'RN') from sequencia;
```
Isolamento por território: rode `tests/test_rls.sql` (desfaz tudo ao fim) e veja
`docs/RLS_RESULTADO.md`.

## Estrutura
```
src/db/migrations/   esquema, RLS, ingestão SQL, agenda, indicadores, painel
supabase/functions/  ingest-ibge, ingest-infodengue, ingest-genbank
src/ingest/          CLI Python com os mesmos endpoints (reprodução local)
src/pipeline/        Nextclade (classify.py) e controle de qualidade (qc.py)
src/indicators/      regras de detecção R1, R2, R3 (deteccao.py)
src/db/load.py       exporta FASTA e carrega a classificação no banco
web/                 painel React + TypeScript + Vite + Tailwind
tests/               RLS, detecção (fixtures com prefixo FIXTURE_)
docs/                fontes, decisões, relatório de carga, marca
```

## Comandos
```bash
pip install -r requirements.txt
python -m src.ingest --fonte ibge|infodengue|genbank   # local, grava em data/raw/
python -m pytest -q
cd web && npm ci && npm run build            # painel web (precisa de web/.env)
cd web && npm run build:artefato && node scripts/fragmento-artefato.mjs   # painel claude.ai
```

## Pendências
Ver `docs/DECISIONS.md` (itens "pendente") e o workflow `.github/workflows/nextclade.yml`,
que precisa de `DATABASE_URL` e `NEXTCLADE_DATASET` no repositório.
