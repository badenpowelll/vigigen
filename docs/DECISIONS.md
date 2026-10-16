# Registro de decisões técnicas

Cada decisão tem data, contexto, o que foi decidido e o que fica pendente de
confirmação do Baden. "Pendente" quer dizer que a implementação já segue a
decisão, mas ela pode ser revertida.

## D-001 · Ingestão em Supabase Edge Functions (16/10/2026)
**Contexto.** O contêiner de desenvolvimento não alcança IBGE, InfoDengue nem
NCBI (proxy responde 403). O Supabase alcança.
**Decisão.** A ingestão de produção roda em Edge Functions (Deno) disparadas
pelo pg_cron via pg_net. Elas só buscam e gravam a resposta crua em
`public.bruto`; a normalização é SQL (`003_ingestao.sql`), ligada ao `bruto_id`.
O CLI Python (`src/ingest/`) repete os mesmos endpoints para reprodução local.

## D-002 · Janela histórica 2020–2026 no InfoDengue (16/10/2026) · pendente
A carga inicial pediu `ey_start=2020` até o ano corrente para os 167
municípios e os 3 agravos. As cargas agendadas seguintes pedem só o ano
corrente (e o anterior até fevereiro). **Pergunta:** a tese precisa de antes de 2020?

## D-003 · Malha do IBGE pelo GeoServer oficial (16/10/2026) · pendente
**Contexto.** `servicodados.ibge.gov.br` (API de Localidades e de Malhas,
endpoint documentado no Prompt 1) falhou por certificado TLS
(`UnknownIssuer`) tanto do pg_net quanto do Deno. O erro real está em
`execucao_ingestao` (ids 1 e 3). Não desligamos a verificação TLS.
**Decisão provisória.** A função tenta primeiro o endpoint documentado e, se
falhar, usa o WFS oficial do IBGE em `geoservicos.ibge.gov.br`, camada
`CCAR:BC250_2025_lml_municipio_a` (Base Cartográfica Contínua 1:250.000,
2025), filtrada por `geocodigo LIKE '24%'`. Deu 167 municípios, o total
oficial do RN. **Pergunta:** aceita essa fonte, ou prefere esperar a API de Localidades?

## D-004 · Mapa em SVG com d3-geo, sem MapLibre (16/10/2026)
O painel publicado no claude.ai não pode buscar tiles externos (CSP), e o mapa
coroplético de 167 municípios não precisa de tiles. d3-geo desenha a malha do
IBGE em SVG: funciona sem rede, cada município é um elemento focável com
rótulo, e há uma tabela alternativa. Se um dia precisar de fundo de ruas, entra
MapLibre no painel web com login.

## D-005 · Indicadores antes do Nextclade (16/10/2026)
Cobertura e oportunidade não dependem da classificação, então já são
calculadas. O sorotipo usado até a classificação é o **declarado** pelo
depositante, rotulado assim no painel. Alertas de linhagem ficam "sem dado",
com o motivo, até o Nextclade rodar.

## D-006 · Oportunidade usa a data de criação do registro (16/10/2026)
Disponibilidade pública = `GBSeq_create-date`. Só entram coletas com data
completa (dia/mês/ano), para não inventar dia.

## D-007 · Origem RN pelo geo_loc; "/RN/" no nome da cepa à parte (16/10/2026) · pendente
Só 3 das 5.876 sequências brasileiras citam RN no `geo_loc_name`. Outras 4
têm "/RN/" no nome da cepa (1997–98). Elas aparecem no painel, marcadas, mas
não entram nos indicadores. **Pergunta:** contar como RN?

## D-008 · Cargas incrementais (16/10/2026)
A primeira carga do GenBank gravou ~170 MB de XML cru (≈ 70 MB compactado no
Postgres). Repetir isso toda semana estouraria o banco. Depois da primeira
carga: GenBank pede só registros modificados desde a última carga ok, menos 7
dias (`datetype=mdat`, `mindate`, `maxdate`, parâmetros documentados do
esearch); InfoDengue pede só o ano corrente. `{"completo": true}` e
`{"ey_start": 2020}` forçam a carga cheia.

## D-009 · Painel no claude.ai lê o banco pelo conector do próprio visitante (16/10/2026)
O artefato publicado não pode chamar o Supabase direto (CSP). Ele chama as
funções `painel_*` pelo conector Supabase de quem abre a página (capacidade
`mcp`, só `execute_sql`), e mostra um retrato embutido, com data, quando não
há conector. O retrato é uma cópia exata (md5 conferido) de
`public.painel_retrato()`. O painel web com login (`web/`, `npm run build`)
usa supabase-js e a RLS.

## D-010 · Cobertura municipal no último trimestre fechado (16/10/2026)
O trimestre corrente tem poucas semanas e o GenBank tem defasagem de meses,
então o resumo usa o último trimestre já encerrado.
