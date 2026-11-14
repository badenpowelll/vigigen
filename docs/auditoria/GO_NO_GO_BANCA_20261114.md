# VigiGen: GO/NO-GO para a banca (auditoria de 14/11/2026)

Referência: `main` em `e26c349` (integração das PRs #1 a #8). Correções desta
auditoria estão na branch `claude/project-thread-8j8kg6`, sem merge.
Produção (Supabase `tizmhihnggbvjzsmnpne`) foi **só lida**. Nada foi aplicado,
publicado ou agendado.

## Decisão

**GO CONDICIONAL.**

- **Apresentação científica: GO.** Arquitetura, método, dados públicos
  ingeridos, teste real de classificação e plano de validação têm evidência.
- **Demonstração online pelo artefato do claude.ai (conector Supabase, conta do
  Baden): GO.** Lê o banco ao vivo; as 8 abas abrem sem erro de execução.
- **Demonstração no site `badenpowelll.github.io/vigigen`: NO-GO hoje.** O
  GitHub Pages não está ligado (erro 404 na publicação). Depois de ligado, ainda
  falta testar o login de fora deste ambiente.
- **Aba Administração: NO-GO.** Não há nenhuma conta administradora ativa no
  banco, então a aba não aparece para ninguém.
- **Contingência offline: obrigatória** (seção 9). O retrato embutido no build
  offline é de 29/10/2026 (InfoDengue até SE 42/2026) e precisa ser regerado.

## 1. Matriz de funcionalidades

Legenda: ✓ sim · ✗ não · parcial · n/a.

| Funcionalidade | No código (`main`) | Testado localmente | Publicado | Ativo no banco | Validado cientificamente |
|---|---|---|---|---|---|
| Ingestão InfoDengue (3 agravos) | ✓ | ✓ | ✓ Edge Function v2 | ✓ 155.644 linhas, 100% com `bruto_id` | n/a (fonte oficial) |
| Ingestão GenBank dengue | ✓ | ✓ | ✓ v2 (versão antiga, só dengue) | ✓ 7.203 sequências, 100% com `bruto_id` | n/a |
| GenBank chikungunya e Zika (013) | ✓ | ✓ | ✗ função nova não publicada | estrutura ✓ (013 aplicada), dados ✗ (0 sequências) | ✗ |
| Malha e municípios IBGE | ✓ | ✓ | ✓ | ✓ 167 municípios | n/a |
| Indicadores (razão sequências/casos) | ✓ | ✓ | n/a | ✓ 5.163 linhas, só dengue | exploratório |
| Classificação Nextclade (sorotipo) | ✓ | ✓ (GitHub Actions, 10 seq.) | workflow ✓ | ✗ 0 classificações (falta o segredo) | parcial: sorotipo concorda 5/5 no RN |
| Linhagem/genótipo | ✓ | ✓ | workflow ✓ | ✗ | ✗ nenhuma sequência do RN com cobertura ≥ 70% |
| Detecção R1–R3 (mudança de linhagem) | ✓ | ✓ | n/a | ✗ 0 alertas, nunca rodou | ✗ |
| Detecção de focos R4/R5 (020) | ✓ | ✓ | ✗ | ✗ 020 não aplicada | exploratório (retrospectivo, referência provisória) |
| SINAN agregado e CNES (017, 019) | ✓ | ✓ | ✗ | ✗ | n/a |
| Clima INMET (018) | ✓ | ✓ | ✗ | ✗ | n/a |
| Procedência IBGE (014) | ✓ | ✓ | n/a | ✗ | n/a |
| Permissões endurecidas (015) | ✓ | ✓ | n/a | ✗ | n/a |
| SLA 95% no painel (016) | ✓ | ✓ | n/a | ✗ (o painel mostra "SLA ainda não publicado") | n/a |
| Login por convite (011) | ✓ | ✓ | Edge Function `acesso` ✓ | ✓ | n/a |
| Administração (011) | ✓ | ✓ | site ✗ | funções ✓; nenhum admin ativo | n/a |
| Painel web (GitHub Pages) | ✓ | ✓ build | ✗ Pages desligado | n/a | n/a |
| Painel no artefato claude.ai | ✓ | ✓ | ✓ (privado, "Apenas você") | lê ao vivo | n/a |
| Dashboard Geral 360° | ✗ não existe | ✗ | ✗ | ✗ | ✗ **pendente** |

## 2. Testes realmente executados (14/11/2026)

| Teste | Onde | Resultado |
|---|---|---|
| `pytest` com Postgres descartável e Deno | local (PG 16) e CI (`testes`, PG 17) | 45 passaram, 1 pulado (`test_rls`, exige banco real) |
| `deno check supabase/functions/*/index.ts` | local e CI | 0 erros |
| `npm test` (painel) | local | 18/18 |
| `npm run build` e `npm run build:artefato` | local | ok; o build web não contém o retrato (valor de `gerado_em` ausente do JS) |
| Cadeia de migrações 001→020 em ordem, com PostGIS, e reaplicação de 013→020 | local (PG 16 + PostGIS 3) e CI (`postgis/postgis:17-3.5`) | ok depois da correção da 016; todas as tabelas `public` com RLS |
| Nextclade 3.29.0, 10 sequências públicas reais, sem banco | GitHub Actions `nextclade-teste`, run 43631782376 | seção 5 |
| Telas: 8 abas × Natal e RN × 3 agravos | local, Playwright, build offline | todas abrem, 0 erro de página; o filtro de agravo muda os números |
| RLS e permissões em produção | consultas só leitura com `set local role`, em transação de leitura | seção 7 |

O que **não** foi testado: login real no site (o Supabase não é alcançável
deste ambiente; a conta da banca entrou pela última vez em 14/11/2026 15:48
UTC, segundo `auth.users`); exportação PDF/XLSX aberta num leitor;
comportamento sem internet do artefato do claude.ai.

## 3. Falha de publicação (GitHub Pages)

Run 43630317900, job `deploy`, etapa `actions/deploy-pages@v4`:

```
Error: Failed to create deployment (status: 404) with build version e26c349…
Ensure GitHub Pages has been enabled: https://github.com/badenpowelll/vigigen/settings/pages
```

- O build passou. O artefato `github-pages` foi gerado.
- Causa: **o GitHub Pages não está ligado no repositório.** Não é erro de código.
- O workflow já tem `pages: write` e `id-token: write`, além do ambiente
  `github-pages`. O Vite usa `base: "./"`, então os arquivos JS e CSS carregam
  sob `/vigigen/`. A URL e a chave publicável do Supabase vão no build, e são
  públicas por desenho.
- **Correção (só o Baden):** Settings > Pages > Source = **GitHub Actions**.
  Depois, re-executar o workflow `pages` (Actions > pages > Re-run).
- **Depois de publicar, conferir:**
  - abrir o site;
  - entrar com a conta da banca;
  - ver se os números batem com o artefato;
  - adicionar `https://badenpowelll.github.io/vigigen/` às URLs de redirecionamento do Supabase Auth, se o login pedir.

## 4. Diagnóstico do Nextclade

As 6 falhas na `main` (20/10 a 10/11), todas na etapa "Exportar, classificar e
carregar", são a mesma: `##[error]Falta o segredo DATABASE_URL no repositório`.
O script para antes de exportar. Não houve falha de classificação.

| Etapa | Situação |
|---|---|
| 1. Conexão com o banco | ✗ falta o segredo `DATABASE_URL` (URI do Session pooler) |
| 2. Exportação FASTA | não chegou a rodar na `main`; o teste usou `efetch` do GenBank |
| 3. Validação dos arquivos | 10 de 10 cabeçalhos baixados; sha256 do lote `7caaa503…0921` |
| 4. Datasets | `nextstrain/dengue/all@2026-04-14--11-55-23Z`; `community/v-gen-lab/dengue/denv{1,2,3}@2026-10-06--17-37-18Z` |
| 5. Sorotipo | DENV1/2/3 atribuídos a 8 de 8 alinháveis, todos iguais ao declarado |
| 6. Linhagem | o Nextclade atribui clado a todos, mas **o QC do VigiGen só aceita com cobertura ≥ 70%** (`src/pipeline/qc.py`) |
| 7. QC | 2 excluídas por tamanho (240 nt < 1.000 nt); 5 do RN com cobertura de 10% a 22%, que seriam excluídas com o motivo "cobertura_baixa" |
| 8. Persistência | não testada contra produção (proibido sem autorização) |
| 9. Alertas | não executados |

Resultado do lote (Nextclade 3.29.0):

| Accession | Origem | Sorotipo | Clado proposto | Cobertura | QC Nextclade | Passa no QC do VigiGen? |
|---|---|---|---|---|---|---|
| HM450098 | RN (banco) | DENV1 | 1V_H | 21,7% | good | não (cobertura) |
| KF672773 | RN, 1997 | DENV1 | 1V_H | 21,7% | good | não (cobertura) |
| HQ012514 | RN, 1997 | DENV2 | 2III_B | 21,7% | good | não (cobertura) |
| HQ012515 | RN, 1997 | DENV2 | 2III_B | 21,7% | good | não (cobertura) |
| OR501013 | RN (banco), 2022 | DENV2 | 2III_C.1.1 | 10,2% | good | não (cobertura) |
| AF529071 | RN, 1998 | — | — | — | erro: 240 nt | não (erro) |
| AF529073 | RN, 1998 | — | — | — | erro: 240 nt | não (erro) |
| OZ570442 | Brasil, 2025 | DENV1 | 1V_E.1 | 90,3% | good | **sim** |
| PQ340826 | genoma de 2024 (EUA/FL) | DENV2 | 2II_F.1.1.2 | 98,5% | good | **sim** |
| PX470089 | Brasil, 2025 | DENV3 | 3III_B.3.2 | 86,3% | mediocre | **sim** |

**Leitura:** o pipeline classifica linhagem quando há genoma quase completo, e
o QC barra as sequências parciais. **Nenhuma linhagem do RN pode ser
afirmada.** O `classificacao.tsv` intermediário traz clados para sequências
parciais; só o que passa no QC entra no banco. Não mostrar esse arquivo como
resultado.

Divergência registrada: o teste anterior (`nextclade_teste_20261114.md`) usou
a versão 3.18.1. O workflow fixa a 3.29.0. Os dois concordam no sorotipo.

## 5. Migrações: aplicadas e pendentes

| Migração | Em produção | Homologada (cadeia em PG 17 + PostGIS) | Observação |
|---|---|---|---|
| 001–010 | ✓ | ✓ | |
| 011 (011a–011i) | ✓ | ✓ | `admin_salvar_usuario` não está em produção |
| 012 (GenBank diário) | ✓ (cron `vigigen-diario-genbank`) | ✓ | |
| 013 multiagravo | ✓ em 3 partes, **sem** os crons de chikungunya e Zika | ✓ | crons só junto com a Edge Function nova |
| 014 procedência IBGE | ✗ | ✓ | |
| 015 permissões | ✗ | ✓ | recomendada antes de abrir o site |
| 016 SLA | ✗ | ✓ **após correção** | não era reaplicável (`painel_resumo_base already exists`); corrigido |
| 017 SINAN/CNES | ✗ | ✓ | depende da leitura da licença CC BY-ND |
| 018 INMET | ✗ | ✓ | |
| 019 agendamentos SINAN/CNES | ✗ | ✓ | só com as funções publicadas |
| 020 focos | ✗ | ✓ | |

**Não foi possível homologar com os dados reais.** A cadeia roda em banco
vazio. Comparar contagens antes e depois exige uma cópia do banco (branch do
Supabase, que é paga, ou um dump), e isso pede autorização.

**Plano de implantação (cada passo só com "ok" do Baden):**

1. **Pré-condição:** backup ou PITR do projeto, e registrar as contagens de base:
   ```sql
   select count(*) from public.caso_semanal;   -- 155.644
   select count(*) from public.sequencia;      -- 7.203
   select count(*) from public.indicador;      -- 5.163
   select md5(string_agg(accession||coalesce(sorotipo_declarado,''), ',' order by accession))
     from public.sequencia;
   ```
2. **Aplicar 015** (permissões). Verificar:
   ```sql
   select has_table_privilege('authenticated','public.caso_semanal','insert');  -- false
   ```
3. **Aplicar 014 e 016.** Verificar que `select public.painel_resumo() ? 'sla'` dá verdadeiro.
4. **Repetir as contagens do passo 1.** Elas têm de ser iguais.
5. **Fase 2, depois da banca:**
   - publicar o `ingest-genbank` novo e criar os crons de chikungunya e Zika;
   - aplicar 020;
   - aplicar 017 e 018 e publicar `ingest-sinan` e `ingest-cnes`; a 019 vem por último.
6. **Rollback:** cada migração traz o seu bloco de reversão no cabeçalho. A 016 reverte com:
   ```sql
   drop function public.painel_resumo();
   alter function public.painel_resumo_base() rename to painel_resumo;
   ```

## 6. Segurança e RLS (evidências em produção, só leitura)

- `anon` lendo `caso_semanal` recebe `permission denied`.
- A conta da banca (não administradora, organização estadual) vê as 155.644
  linhas de `caso_semanal` e as 7.203 sequências, como esperado para o nível
  estadual. `painel_resumo()` responde.
- A mesma conta chamando `admin_sla()` recebe **`42501 apenas administradores`**.
- Advisors do Supabase:
  - `registrar_eventos` executável por `anon`. É intencional (telemetria
    antes do login), com limite por chamada e por IP na 015, ainda não aplicada.
  - 11 funções `SECURITY DEFINER` chamáveis por `authenticated`. Todas
    conferem `app.exigir_admin()` ou o próprio usuário.
  - `convite` com RLS e sem política: acesso só por função. É intencional.
  - Proteção contra senha vazada desligada. Recomendo ligar em Auth > Password
    security, que é uma mudança de autenticação e pede o "ok" do Baden.
- Contas: 2 em `auth.users`. Uma de teste está desativada. A outra é a da
  banca, ativa e não administradora. **Nenhum administrador ativo.**
- Nenhum segredo no repositório. A chave do `pages.yml` é a publicável.

## 7. Integridade e origem dos dados

- 100% de `caso_semanal` e de `sequencia` têm `bruto_id`, a resposta crua com
  data e sha256.
- Dengue e chikungunya vão até a SE 44/2026, ingeridas em 14/11/2026. A Zika
  termina na SE 07/2024, porque o InfoDengue parou de publicar. O painel mostra
  isso como "série parada".
- Sequências: só dengue (7.203). Só 3 têm UF = RN no `geo_loc`. As de
  chikungunya e Zika estão em 0, porque a Edge Function nova não foi publicada.
- 0 classificações e 0 alertas. O painel diz "aguardando classificação" e
  "sem sequências", nunca "zero alertas".
- IBGE: a procedência no banco ainda diz GeoServer BC250. A 014 corrige isso.

## 8. Plano de demonstração com internet (5 minutos)

Use o artefato do claude.ai na conta do Baden. É o único caminho online
testado. Selecione Natal e mostre os passos abaixo.

1. **Problema científico (1 min):** a vigilância genômica e a notificação
   chegam separadas, com defasagem, ao gestor municipal.
2. **Integração epidemiológica (1 min):**
   - Visão geral de Natal, com dengue: nível, casos, incidência, Rt, fonte e data;
   - troque para "Rio Grande do Norte (estado)";
   - troque para Zika e mostre o aviso de série parada desde a SE 07/2024.
3. **Informação genômica (1 min):**
   - Qualidade do dado: 7.203 sequências de dengue do Brasil, mas só 3 com UF RN;
   - o teste do Nextclade: sorotipo ok, linhagem sem cobertura no RN.
4. **Proveniência e qualidade (1 min):** Fontes e método. Cada número tem a
   resposta crua com data e sha256. Mostre também os relatórios exportáveis.
5. **Limitações e validação (1 min):**
   - alertas ainda não executados;
   - focos são retrospectivos e exploratórios;
   - a validação contra SaTScan e com gestores é objetivo do doutorado.

**Frase de fechamento:** "O VigiGen já demonstra a viabilidade técnica de
integrar dados epidemiológicos, genômicos e territoriais. O desafio científico
do doutorado é avaliar a qualidade, a reprodutibilidade e a utilidade dessa
integração para apoiar a vigilância em saúde."

## 9. Contingência offline

1. Regenerar o retrato com dado real atual: `scripts/montar_retrato.py` lendo
   `public.painel_retrato()` (só leitura). Depois, `npm run build:artefato`.
   O arquivo `web/dist-artefato/index.html` abre no navegador sem internet.
   - **Até lá, o retrato embutido é de 29/10/2026 (SE 42/2026).** Diga isso
     em voz alta se usá-lo.
2. Ter as capturas de tela no notebook, todas com fonte, SE de referência, data
   de extração, agravo e território visíveis no próprio painel.
3. Ter em PDF o relatório "Situação por município" (Natal e RN, dengue)
   exportado na véspera.
4. Se o artefato do claude.ai não abrir (sem rede ou sessão expirada), usar o
   item 1. Se o notebook falhar, usar os slides com as capturas.

## 10. Revisão científica

- Na interface não há afirmação de previsão, acurácia ou linhagem detectada.
  Os estados vazios dizem por que estão vazios.
- `docs/FOCOS_RESULTADO.md` usa "referências detectadas (70%)" e diz que esse
  "é o resultado a sustentar na defesa".
  - **Recomendo apresentar** como "sinal retrospectivo antes do pico em cerca
    de 2/3 dos municípios-ano de alta incidência, com referência provisória e
    sem avaliação de falsos alarmes". Não use acurácia, sensibilidade nem previsão.
- H1 e H2 são hipóteses a testar, não resultados. Isso está alinhado com a
  regra do projeto.
- "Sequências públicas / casos" não mede o sequenciamento laboratorial. Zero
  sequências públicas não significa que não houve sequenciamento.
- Linhagens: nenhuma do RN pode ser afirmada (seção 4).

## 11. Riscos que continuam

| Risco | Impacto na banca | Mitigação |
|---|---|---|
| Site do Pages não publicado | não dá para mostrar o login real | demo pelo artefato; ligar o Pages e testar antes de 23/11 |
| Nenhum administrador ativo | a aba Administração não aparece | criar convite de administrador para o Baden, que é mudança de autenticação e pede "ok"; ou mostrar só por captura |
| Artefato privado ("Apenas você") | a banca não abre sozinha | apresentar da tela do Baden |
| Retrato offline de 29/10 | dado desatualizado na contingência | regerar antes de 23/11 (seção 9) |
| `DATABASE_URL` ausente | Nextclade e alertas não rodam | Baden cadastra o segredo; primeira rodada só depois da banca |
| 014–020 não aplicadas | SLA, focos e novas fontes não aparecem no painel | apresentar como implementado e homologado, não como ativo |
| Licença CC BY-ND 3.0 (SINAN) | publicação de contagens | nota em https://claude.ai/artifact/XBD55W7Ry45XSU4hBSAkqT; consulta jurídica |
| Proteção contra senha vazada desligada | segurança de login | ligar no Supabase Auth, com "ok" |
| PR #9 (mapa interativo) em rascunho | conflito se entrar às pressas | congelar o painel depois do merge da #9 e refazer os testes desta auditoria |
