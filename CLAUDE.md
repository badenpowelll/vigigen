# VigiGen

Plataforma de vigilância genômica integrada para gestão municipal de saúde.
Integra sequências genômicas de arbovírus a dados de notificação e de
território, e converte isso em indicadores e alertas para secretarias
municipais. Caso de uso: dengue, chikungunya e Zika no Rio Grande do Norte.

Este código sustenta um projeto de doutorado em Bioinformática (UFERSA). O
método é Design Science Research: o artefato é construído e avaliado, e a
avaliação precisa ser reproduzível por terceiros.

## Regras invioláveis

1. NUNCA invente dados. Se uma API não responder ou retornar vazio, registre
   isso e pare. Não gere dados sintéticos, de exemplo ou "ilustrativos" em
   nenhum ponto do fluxo de produção. Dados de teste, quando necessários,
   ficam em tests/fixtures/ e levam o prefixo FIXTURE_ no nome.
2. NUNCA invente endpoints, parâmetros ou nomes de datasets. Se um endpoint
   documentado aqui falhar, teste-o isoladamente, relate o erro real e peça
   confirmação antes de substituir por outro.
3. Toda consulta externa grava a resposta bruta com timestamp antes de
   qualquer transformação: em `public.bruto` no banco (Edge Functions) ou em
   `data/raw/` (CLI Python). Procedência é requisito da tese.
4. Nenhum dado pessoal identificável entra no repositório. As fontes desta
   fase são públicas e agregadas. Se em algum momento entrarem dados
   individuais, eles são pseudonimizados antes da ingestão e nunca versionados.
5. Toda análise registra as versões das ferramentas e dos datasets usados.

## Decisões técnicas

- Supabase (Postgres 17 + PostGIS) para persistência, autenticação e Row
  Level Security. Projeto `VigiGen`, região sa-east-1.
- Ingestão em produção: Supabase Edge Functions (Deno) em
  `supabase/functions/`, agendadas por pg_cron. Elas só buscam e gravam a
  resposta crua; a normalização é feita por funções SQL em
  `src/db/migrations/003_ingestao.sql`, ligadas ao `bruto_id`.
- Ingestão local/reprodutível: CLI Python 3.11+ em `src/ingest/`
  (`python -m src.ingest --fonte ...`), mesmos endpoints, grava em `data/raw/`.
- Node 20+ e React + TypeScript + Vite + Tailwind para o painel (`web/`).
  Visual segue o Padrão Digital de Governo (gov.br Design System 3.7.0, pacote @govbr-ds/core): tokens
  de cor, tipografia Rawline (Raleway como substituta) e superfícies; a marca
  do VigiGen continua a própria, sem a marca gov.br (D-014).
- Nextclade CLI para classificação de sorotipo e linhagem (`src/pipeline/`),
  executado no GitHub Actions ou localmente.
- Nextflow para orquestrar o pipeline quando ele estiver estável (fase
  posterior; até lá, scripts Python encadeados com make).
- Testes com pytest. Nada de mocks que simulem resposta de API em testes de
  integração: use respostas reais gravadas em tests/fixtures/.

## Estrutura

```
vigigen/
  data/
    raw/         # respostas brutas das APIs, com timestamp, não versionado
    interim/     # transformações intermediárias, não versionado
    processed/   # datasets finais, não versionado
    reference/   # códigos IBGE, malhas, datasets Nextclade (versionado)
  src/
    ingest/      # um módulo por fonte: genbank.py, infodengue.py, ibge.py
    pipeline/    # QC, classificação, agregação
    indicators/  # cobertura, oportunidade, detecção de mudança
    db/          # schema, migrações, carga
  supabase/
    functions/   # Edge Functions de ingestão (produção)
  web/           # painel React
  tests/
  docs/
    DATA_SOURCES.md  # cada fonte: endpoint, licença, data do acesso
    DECISIONS.md     # registro de decisões técnicas e por quê
```

## Escopo desta fase

Fase 1 apenas: ingestão, classificação, indicadores de cobertura e
oportunidade, detecção de mudança no perfil de linhagens, e um painel de
leitura. Fora de escopo agora: multi-município em produção, integração RNDS,
filogeografia completa, módulo de IA.

## Vocabulário

Os dados NÃO são de tempo real. Use "dados atualizados automaticamente, com a
origem e a data de cada número visíveis". InfoDengue é semanal; sequências
públicas chegam por lote, com defasagem de semanas a meses.
