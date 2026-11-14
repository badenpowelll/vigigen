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

## D-002 · Janela histórica 2020–2026 no InfoDengue (16/10/2026) · confirmada por Baden em 16/10/2026
A carga inicial pediu `ey_start=2020` até o ano corrente para os 167
municípios e os 3 agravos. As cargas agendadas seguintes pedem só o ano
corrente (e o anterior até fevereiro). Baden confirmou que 2020–2026 basta para a tese.

## D-003 · Malha do IBGE pelo GeoServer oficial (16/10/2026) · aceita por Baden em 16/10/2026
**Contexto.** `servicodados.ibge.gov.br` (API de Localidades e de Malhas,
endpoint documentado no Prompt 1) falhou por certificado TLS
(`UnknownIssuer`) tanto do pg_net quanto do Deno. O erro real está em
`execucao_ingestao` (ids 1 e 3). Não desligamos a verificação TLS.
**Decisão provisória.** A função tenta primeiro o endpoint documentado e, se
falhar, usa o WFS oficial do IBGE em `geoservicos.ibge.gov.br`, camada
`CCAR:BC250_2025_lml_municipio_a` (Base Cartográfica Contínua 1:250.000,
2025), filtrada por `geocodigo LIKE '24%'`. Deu 167 municípios, o total
oficial do RN. Baden aceitou essa fonte. A rota documentada continua sendo tentada primeiro.

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

## D-007 · Origem RN pelo geo_loc; "/RN/" no nome da cepa à parte (16/10/2026) · confirmada por Baden em 16/10/2026
Só 3 das 5.876 sequências brasileiras citam RN no `geo_loc_name`. Outras 4
têm "/RN/" no nome da cepa (1997–98). Elas aparecem no painel, marcadas, mas
não entram nos indicadores. Baden decidiu não contá-las como RN.

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

## D-011 · Sem chave de API do NCBI (16/10/2026)
Baden não tem chave. As funções seguem o limite sem chave (3 req/s; usamos
400 ms entre chamadas). Se a chave existir um dia, basta o segredo
`NCBI_API_KEY` na Edge Function, e o intervalo cai para 120 ms.

## D-012 · Nextclade no GitHub Actions (16/10/2026)
Baden aprovou. Workflow `.github/workflows/nextclade.yml`, semanal na terça
depois da carga do GenBank. Precisa do repositório no GitHub, do segredo
`DATABASE_URL` e da variável `NEXTCLADE_DATASET`.

## D-013 · Dataset do Nextclade (pendente de escolha do Baden)

Consulta real em 2026-10-16T12:01Z, Nextclade 3.25.0, `nextclade dataset list --search dengue`
(workflow `nextclade-datasets`, run 38897706764, artefato com a lista completa em JSON):

| dataset | o que classifica | versão mais recente |
|---|---|---|
| `nextstrain/dengue/all` | sorotipo (5 clados), referência NC_002640 | 2026-04-14--11-55-23Z |
| `community/v-gen-lab/dengue/denv1` | genótipo/linhagem DENV-1 (76 clados) | 2026-10-06--17-37-18Z |
| `community/v-gen-lab/dengue/denv2` | genótipo/linhagem DENV-2 (95 clados) | 2026-10-06--17-37-18Z |
| `community/v-gen-lab/dengue/denv3` | genótipo/linhagem DENV-3 (42 clados) | 2026-10-06--17-37-18Z |
| `community/v-gen-lab/dengue/denv4` | genótipo/linhagem DENV-4 (32 clados) | 2026-10-06--17-37-18Z |

Todos aparecem marcados como `experimental`. Nenhum dataset de chikungunya ou Zika apareceu nesta busca.

## D-014 · Metas de SLA de atualização dos dados (16/10/2026) · pendente de confirmação do Baden
A meta de cada fonte é o maior intervalo da agenda automática (`006_agendamento.sql`)
mais 24 h de tolerância: InfoDengue 120 h (seg e qui), GenBank 192 h (terça),
IBGE 768 h (mensal), Nextclade 192 h (terça, GitHub Actions); indicadores 7 h
(a cada 6 h + 1 h). Carga com status `vazio` conta como sucesso (a fonte
respondeu, sem registro novo). Cumprimento = % das horas dos últimos 30 dias em
que a última atualização bem-sucedida estava dentro da meta, contando a partir
da primeira. Calculado em `public.admin_sla()`, sem tabela intermediária.

## D-015 · Login fechado com código de uso único e trilha de uso do site (16/10/2026)
**Contexto.** Baden pediu um menu de Administrador com auditoria de tudo que o
site faz (login, cliques, quem, quando, de onde), SLA, alertas do sistema e
gestão de usuários. O Supabase Auth não tem SMTP próprio configurado, e o
envio padrão só entrega e-mail para a equipe do projeto.
**Decisão.** Cadastro fechado: um gatilho em `auth.users` só aceita e-mail
com convite liberado. O administrador gera um código de 12 caracteres (48 bits,
vale 7 dias, uma vez, 10 erros bloqueiam); o banco guarda só o hash. A pessoa
informa e-mail, código e a senha que ela escolhe na Edge Function `acesso`,
que cria a conta (ou troca a senha) com a service role. Nenhuma senha passa
pelo código, pelo banco do VigiGen ou pelo chat. O primeiro administrador foi
convidado fora do repositório, para não versionar e-mail pessoal.
Uso do site vai para `public.evento_uso` (append-only): sessão, login, login
que falhou, saída, navegação, clique (rótulo do elemento, nunca o que se
digita) e erro. IP, país e navegador vêm dos cabeçalhos da requisição lidos
pelo banco. Só administradores leem. Contas são desativadas, nunca apagadas,
para não quebrar a trilha.
**Pendente.** IP e e-mail de usuários são dados pessoais (LGPD): finalidade
de segurança e auditoria; prazo de retenção a definir (proposta: 12 meses).

## D-016 · Painel web no GitHub Pages (16/10/2026) · escolhido por Baden em 16/10/2026
O artefato do claude.ai não permite login próprio nem chamar o Supabase direto
(CSP). O painel web (`web/`, `npm run build`) passa a ser publicado pelo
workflow `pages` em https://badenpowelll.github.io/vigigen/. O artefato
continua existindo, sem login e sem menu Administração.

## D-017 · Visual no Padrão Digital de Governo (14/11/2026) · pedido por Baden
**Contexto.** Baden pediu o design system do governo federal (gov.br DS,
versão 3.7.0, https://www.gov.br/ds/) no painel, no lugar do visual IMD/UFRN.
**Decisão.** `web/src/tema.css` passa a usar os tokens do gov.br: primária
`blue-warm-vivid-70` (#1351b4), neutros `gray-2/5/20/60/80`, sucesso
`green-cool-vivid-50`, escala do mapa `blue-warm-vivid-10` a `-80`, cantos de
8 px e sombra `surface-shadow-sm`. Cabeçalho claro com abas sublinhadas, como
no padrão. Fonte Rawline quando instalada, com Raleway (Google Fonts) como
substituta. Valores conferidos no `core.css` 3.0.0 do GOVBR-DS servido pela
Receita Federal; amarelo (#ffcd07) e vermelho (#e52207) de alerta não
puderam ser conferidos nessa leitura. A marca do VigiGen continua a própria:
o painel não usa a marca gov.br, porque não é um serviço do governo federal.
**Complemento (14/11/2026).** Baden autorizou trocar todas as cores e botões.
O painel passa a depender do pacote oficial `@govbr-ds/core` 3.7.0 (MIT, npm),
do qual importa só `core-tokens` e os componentes `br-button` e `br-message`,
sem o reset global, que brigaria com o Tailwind. Todos os tokens acima foram
reconferidos na 3.7.0, inclusive o amarelo e o vermelho. Botões e
alternadores viram `br-button` (primário e secundário, tamanho small), notas
viram `br-message` (info e warning, com ícone SVG próprio no lugar do Font
Awesome), o seletor de território segue as medidas do `br-input` (o
`br-select` do DS depende de JS), o foco usa o padrão do DS (tracejado de
4 px, `gold-vivid-40`) e o rodapé segue o `br-footer` (fundo
`blue-warm-vivid-90`). No escuro, as variáveis equivalem à classe
`dark-mode` do DS.

## D-018 — Camada genômica multiagravo (14/11/2026)

**Contexto.** O seletor de agravo do painel trocava os dados do InfoDengue,
mas a camada genômica só tinha dengue: na aba Qualidade do dado,
chikungunya e Zika mostravam números de dengue. Baden pediu a integração
real de CHIKV e ZIKV pelo mesmo caminho do GenBank.

**Decisão.**
- Um termo por agravo no esearch, validados em 14/11/2026 15:24 UTC (resposta
  em `data/raw/genbank/`): `"Dengue virus"[Organism] AND Brazil[All Fields]`
  (7.203), `"Chikungunya virus"[Organism] AND Brazil[All Fields]` (1.839),
  `"Zika virus"[Organism] AND Brazil[All Fields]` (519).
- `sequencia.agravo` é coluna gerada a partir de `GBSeq_organism`
  (`app.agravo_de`). Nenhum outro campo decide o vírus. Sorotipo DENV-1..4 só
  é gravado para dengue (gatilho `sequencia_sorotipo_so_dengue`).
- `indicador` e `alerta` ganham `agravo` (default `dengue` para o legado). A
  chave única do indicador passa a incluir o agravo. `calcular_indicadores()`
  roda um agravo por vez, com casos do mesmo agravo no denominador; agravo sem
  sequência não grava indicador (o painel mostra "sem dado", não zero).
- Genoma quase completo por referência RefSeq conferida por esummary:
  NC_001477.1 (DENV-1, 10.735 nt), NC_004162.2 (CHIKV, 11.826 nt),
  NC_012532.1 (ZIKV, 10.794 nt). Dengue mantém 9.000 nt; CHIKV (9.914 nt) e
  ZIKV (9.046 nt) usam a mesma fração (83,8%) como critério **provisório**, a
  validar cientificamente.
- Nextclade continua só para dengue: `exportar-fasta` e `detectar-alertas`
  filtram dengue. Classificação de CHIKV e ZIKV fica pendente até verificar
  os datasets (o índice data.clades.nextstrain.org não é alcançável deste
  ambiente). Alertas R1–R3 de CHIKV/ZIKV ficam indisponíveis até lá.
- Ingestão: `ingest-genbank` aceita `{"agravo": ...}`; a carga incremental usa
  a última carga do mesmo termo (a primeira de um agravo novo é completa).
  Três agendamentos diários (10:00 dengue, 11:20 chikungunya, 12:40 Zika UTC).
  Uma execução por vez: disparo com outra em andamento responde 409.
- Painel: `painel_resumo()` mantém as chaves antigas só com dengue e ganha
  `genomica.{dengue,chikungunya,zika}` (`painel_genomica`). Todas as abas
  leem o bloco do agravo escolhido; sem bloco, a tela diz o motivo.

**Estado.** Código e migração 013 na PR #2, testados num Postgres local
(`tests/fixtures/sql/FIXTURE_teste_013.sql`). Nada aplicado em produção até autorização do
Baden: aplicar a 013, publicar a Edge Function e disparar a primeira carga.

> Nota de numeração (14/11/2026): a PR #1 (menu de administração) já usa D-014
> (metas de SLA), D-015 (acesso e trilha de uso) e D-016 (GitHub Pages). Para as
> duas PRs poderem ser juntadas sem colisão, as decisões desta linha foram
> renumeradas: gov.br passou de D-014 para D-017 e multiagravo de D-015 para D-018.

## D-019 — Auditoria corretiva, acessibilidade e SLA no painel (14/11/2026)

Pedido por Baden (auditorias de 14/11). O que mudou e por quê:

- **Nenhum número de um agravo aparece em outro.** Alertas e classificações são
  filtrados por agravo e território; o total global de classificações não é mais
  usado nas telas. Testes em `web/tests/multiagravo.test.ts` provam isso com
  dados FIXTURE_.
- **Estados explícitos da detecção**: sem sequências, aguardando classificação,
  QC insuficiente, detecção pendente, concluída sem alertas, alertas pendentes e
  revisados. "Sem alerta" só aparece com execução da detecção registrada
  (`painel_resumo().deteccao`, lida da auditoria).
- **Atualidade por agravo**: a última SE publicada de cada agravo é comparada
  com a SE corrente (em dia até 4 semanas, atrasada até 12, parada acima). A data
  de leitura do banco não conta como atualidade.
- **Nome do indicador**: "razão de sequências públicas identificáveis por casos
  notificados", para não ser lido como cobertura laboratorial. Mapa distingue
  indicador não calculado, zero observado e sem denominador.
- **Limiar de genoma quase completo** de CHIKV e ZIKV marcado como exploratório.
- **Relatórios** levam território, execução da fonte (nº), link verificável da
  fonte, versão do método e ressalvas.
- **Migrações 014 (procedência do IBGE), 015 (permissões) e 016 (SLA com meta
  de 95%)**, testadas em Postgres descartável e **não aplicadas**.
- **Acessibilidade** (meta WCAG 2.2 AA): pular para o conteúdo, tema claro,
  escuro ou do sistema, atalhos Alt+Shift (não de tecla única, critério 2.1.4),
  grupos de opção com setas, gráficos percorríveis pelo teclado com dica
  flutuante, dicas "i" nos indicadores, regiões roláveis focáveis. Verificado com
  axe-core 4.10.2 nas 8 abas, nos dois temas, em 1366 px e 390 px: zero violações.

## D-020 — SINAN (agregado) e CNES pela API de Dados Abertos do Ministério da Saúde (14/11/2026)

Pedido por Baden ("implementar essas apis https://apidadosabertos.saude.gov.br/v1/").
Swagger v1.8.32, sondado do GitHub Actions em 14/11/2026 (workflow `sondar-fontes`).

- **A rota do SINAN devolve microdados**: um registro por notificação, com
  idade, sexo, raça, escolaridade, gestação e datas. A regra 4 proíbe guardar
  isso. O parâmetro `campos`, que pediria só as colunas da chave, respondeu
  200 com `limit=5` (20 s) e **502 após 60 s** com `limit=1000` nos três agravos
  (sondagem de 14/11/2026), então não serve para a carga. A função soma na memória por uma chave sem coluna pessoal (ano, semana
  de notificação, município notificador, município de residência,
  classificação final, critério e sorotipo) e grava em `public.bruto` só essas
  contagens, com o sha256, o tamanho e o número de registros da resposta
  original. **Exceção à regra 3**: a resposta original não é gravada; o sha256
  prova qual resposta foi somada. Python e Edge Function agregam igual (teste).
- **Filtro por município da unidade notificadora** (`id_municip`), não da
  residência. Por isso a função percorre os 167 municípios do RN e o painel
  soma por residência (`id_mn_resi`), comparável ao InfoDengue. Residência
  fora do RN fica sem geocódigo (só estado).
- **Classificação final em código**, como o SINAN publica; o dicionário de
  dados do SINAN traduz. Nada é recodificado.
- **CNES**: cadastro público, gravado inteiro. Na tabela normalizada, o nome de
  estabelecimento sem CNPJ (pessoa física) fica nulo.
- **Volumes medidos**: dengue em Natal, 5.289 notificações em 2025 e 2.290 em
  2026 (páginas de 1000); 6.201 estabelecimentos ativos no RN (311 páginas de 20).
- **Licença**: os conjuntos de arboviroses no dados.gov.br estão sob CC BY-ND
  3.0; publicar contagens derivadas pede leitura jurídica antes do painel público.
- Migração 017 (tabelas, view da execução vigente, `painel_sinan`) e 019
  (agendamento) **não aplicadas**; dependem da aprovação do Baden.

## D-021 — Clima das estações do INMET no RN (14/11/2026)

Pedido por Baden ("conectar api do INMET").

- A rota `https://apitempo.inmet.gov.br/estacao/{inicio}/{fim}/{codigo}`
  respondeu **204 sem corpo** em 14/11/2026 para A304 (Natal); `/estacoes/T`
  respondeu 200. Sem token documentado, a rota de dados não é usada.
- Fonte usada: o arquivo anual oficial
  `https://portal.inmet.gov.br/uploads/dadoshistoricos/<ano>.zip` (2026: 82 MB,
  634 estações, até 31/10/2026). Sete estações do RN: A304 Natal, A316 Caicó,
  A317 Macau, A318 Mossoró, A340 Apodi, A367 Santa Cruz, A372 Ipanguaçu.
- O ZIP é grande demais para uma Edge Function; quem baixa é o CLI
  (`python -m src.ingest --fonte inmet --ano 2026 [--banco]`), que grava o ZIP
  em `data/raw/inmet/` e, com `--banco`, cada CSV do RN inteiro em
  `public.bruto`. A migração 018 normaliza chuva, temperatura e umidade
  horárias e soma por semana de domingo a sábado; semana com hora faltando não
  tem soma de chuva. Municípios sem estação não recebem valor interpolado.
- Migração 018 **não aplicada**.
