# Fontes de dados

Todas públicas e agregadas. Toda resposta é gravada crua (corpo, sha256,
parâmetros, data) em `public.bruto` antes de qualquer transformação.

| Fonte | Endpoint usado | Parâmetros | Licença / termos | Primeiro acesso |
|---|---|---|---|---|
| InfoDengue (Fiocruz/FGV) | `https://info.dengue.mat.br/api/alertcity` | `geocode`, `disease` (dengue, chikungunya, zika), `format=json`, `ew_start`, `ew_end`, `ey_start`, `ey_end` | Dados abertos do InfoDengue; citar o projeto | 16/10/2026 02:40 UTC |
| NCBI GenBank (E-utilities) | `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` e `efetch.fcgi` | `db=nuccore`, um termo por agravo (D-018): `"Dengue virus"[Organism] AND Brazil[All Fields]`, `"Chikungunya virus"[Organism] AND Brazil[All Fields]` e `"Zika virus"[Organism] AND Brazil[All Fields]` (validados em 14/11/2026: 7.203, 1.839 e 519 registros); `efetch` com `rettype=gb&retmode=xml` (GBSet), 100 IDs por POST, 400 ms entre chamadas; incremental com `datetype=mdat&mindate&maxdate` | Política de uso das E-utilities do NCBI (até 3 req/s sem chave) | 16/10/2026 02:28 UTC |
| IBGE Localidades e Malhas (documentado) | `https://servicodados.ibge.gov.br/api/v1/localidades/estados/24/municipios` e `/api/v3/malhas/estados/24` | `formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio` | Dados públicos IBGE | 16/10/2026: **falhou** (TLS UnknownIssuer), erro gravado |
| IBGE GeoServer (substituto, D-003) | `https://geoservicos.ibge.gov.br/geoserver/ows` | `service=WFS`, `version=2.0.0`, `request=GetFeature`, `typeNames=CCAR:BC250_2025_lml_municipio_a`, `outputFormat=application/json`, `srsName=EPSG:4674`, `CQL_FILTER=geocodigo LIKE '24<d>%'` em 10 fatias (d = 0..9) | Dados públicos IBGE (BC250, 2025) | 16/10/2026 02:40 UTC |
| SINAN via API DEMAS (Ministério da Saúde), D-020 | `https://apidadosabertos.saude.gov.br/arboviroses/{dengue,chikungunya,zikavirus}` | `nu_ano`, `id_municip` (6 dígitos, município da unidade notificadora), `limit=1000`, `offset` (número da página) | Dados abertos do Ministério da Saúde; conjuntos de arboviroses no dados.gov.br sob CC BY-ND 3.0 | 14/11/2026 17:37 UTC (sondagem) |
| CNES via API DEMAS, D-020 | `https://apidadosabertos.saude.gov.br/cnes/estabelecimentos` | `codigo_uf=24`, `status=1`, `limit=20`, `offset` (número da página) | Dados abertos do Ministério da Saúde | 14/11/2026 17:38 UTC (sondagem) |
| INMET, dados históricos das estações automáticas, D-021 | `https://portal.inmet.gov.br/uploads/dadoshistoricos/<ano>.zip` | nenhum; CSVs `INMET_NE_RN_*` do ZIP | Dados públicos do INMET | 14/11/2026 17:43 UTC (sondagem) |

## Campos aproveitados

**InfoDengue.** `data_iniSE`, `SE`, `casos`, `casos_est` (+ `casos_est_min/max`),
`p_inc100k`, `Rt`, `p_rt1`, `nivel`, `pop`, `receptivo`, `transmissao`,
`casprov`, `casconf`, `notif_accum_year`, `versao_modelo`, temperatura e umidade.

**GenBank.** accession, `GBSeq_create-date` (disponibilidade), `GBSeq_update-date`,
qualificadores `geo_loc_name`/`country`, `collection_date`, `serotype`, `host`,
`strain`/`isolate`, título, tamanho e sequência (FASTA).
Município e UF são inferidos do texto de `geo_loc_name`; nada é completado à mão.

**SINAN (D-020).** Só a contagem por `nu_ano`, `sem_not`, `id_municip`,
`id_mn_resi`, `classi_fin`, `criterio`, `sorotipo`. Nenhuma coluna pessoal é
lida para a contagem nem gravada; a resposta original fica representada pelo
sha256, tamanho e número de registros.

**CNES.** `codigo_cnes`, `codigo_municipio`, `nome_fantasia` (só com CNPJ),
`codigo_tipo_unidade`, esfera, natureza jurídica, gestão, atendimento SUS,
latitude, longitude e `data_atualizacao`.

**INMET (D-021).** Do cabeçalho: código WMO, estação, UF, latitude, longitude,
altitude. Por hora: precipitação total, temperatura do ar (bulbo seco) e
umidade relativa. -9999 e vazio viram nulo.

**IBGE.** `geocodigo`, `nome`, `anodereferencia` e a geometria (SIRGAS 2000, EPSG:4674).

## Agendamento (pg_cron)
- InfoDengue: segunda e quinta 09:00 UTC (ano corrente)
- GenBank: todo dia 10:00 UTC (registros modificados desde a última carga; era terça até 14/11/2026, migração 012)
- IBGE: dia 1 de cada mês, 08:00 UTC
- Indicadores: a cada 6 h
- SINAN e CNES (migração 019, **não aplicada**): SINAN toda terça 06:00 UTC; CNES dia 2 de cada mês 07:00 UTC
- INMET: sem agendamento no banco; carga pelo CLI quando o INMET publica o arquivo do mês

## Imagens do vetor e dos vírus (painel, aba Mapa)

Baixadas do Wikimedia Commons em 2026-11-14 (API `imageinfo` com `extmetadata` para licença e autor), redimensionadas para 360 px e embutidas em `web/src/componentes/vetorImagens.ts`. Uso ilustrativo, sem dado.

| Imagem | Autor | Licença | Página |
|---|---|---|---|
| *Aedes aegypti* | James Gathany, CDC (PHIL #9258) | Domínio público | https://commons.wikimedia.org/wiki/File:Aedes_aegypti_CDC-Gathany.jpg |
| Partículas de DENV (TEM colorizada) | CDC e NIAID | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Dengue_Virus_Particles_(53253718295).jpg |
| Partículas de CHIKV (TEM) | Cynthia Goldsmith, CDC (PHIL #17369) | Domínio público | https://commons.wikimedia.org/wiki/File:Chikungunya_virus_particles-PHIL-17369.jpg |
| Partículas de ZIKV (TEM colorizada) | NIAID, Rocky Mountain Laboratories | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Zika_Virus_Particles.jpg |
