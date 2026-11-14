# Fontes de dados

Todas públicas e agregadas. Toda resposta é gravada crua (corpo, sha256,
parâmetros, data) em `public.bruto` antes de qualquer transformação.

| Fonte | Endpoint usado | Parâmetros | Licença / termos | Primeiro acesso |
|---|---|---|---|---|
| InfoDengue (Fiocruz/FGV) | `https://info.dengue.mat.br/api/alertcity` | `geocode`, `disease` (dengue, chikungunya, zika), `format=json`, `ew_start`, `ew_end`, `ey_start`, `ey_end` | Dados abertos do InfoDengue; citar o projeto | 16/10/2026 02:40 UTC |
| NCBI GenBank (E-utilities) | `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` e `efetch.fcgi` | `db=nuccore`, um termo por agravo (D-018): `"Dengue virus"[Organism] AND Brazil[All Fields]`, `"Chikungunya virus"[Organism] AND Brazil[All Fields]` e `"Zika virus"[Organism] AND Brazil[All Fields]` (validados em 14/11/2026: 7.203, 1.839 e 519 registros); `efetch` com `rettype=gb&retmode=xml` (GBSet), 100 IDs por POST, 400 ms entre chamadas; incremental com `datetype=mdat&mindate&maxdate` | Política de uso das E-utilities do NCBI (até 3 req/s sem chave) | 16/10/2026 02:28 UTC |
| IBGE Localidades e Malhas (documentado) | `https://servicodados.ibge.gov.br/api/v1/localidades/estados/24/municipios` e `/api/v3/malhas/estados/24` | `formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio` | Dados públicos IBGE | 16/10/2026: **falhou** (TLS UnknownIssuer), erro gravado |
| IBGE GeoServer (substituto, D-003) | `https://geoservicos.ibge.gov.br/geoserver/ows` | `service=WFS`, `version=2.0.0`, `request=GetFeature`, `typeNames=CCAR:BC250_2025_lml_municipio_a`, `outputFormat=application/json`, `srsName=EPSG:4674`, `CQL_FILTER=geocodigo LIKE '24<d>%'` em 10 fatias (d = 0..9) | Dados públicos IBGE (BC250, 2025) | 16/10/2026 02:40 UTC |

## Campos aproveitados

**InfoDengue.** `data_iniSE`, `SE`, `casos`, `casos_est` (+ `casos_est_min/max`),
`p_inc100k`, `Rt`, `p_rt1`, `nivel`, `pop`, `receptivo`, `transmissao`,
`casprov`, `casconf`, `notif_accum_year`, `versao_modelo`, temperatura e umidade.

**GenBank.** accession, `GBSeq_create-date` (disponibilidade), `GBSeq_update-date`,
qualificadores `geo_loc_name`/`country`, `collection_date`, `serotype`, `host`,
`strain`/`isolate`, título, tamanho e sequência (FASTA).
Município e UF são inferidos do texto de `geo_loc_name`; nada é completado à mão.

**IBGE.** `geocodigo`, `nome`, `anodereferencia` e a geometria (SIRGAS 2000, EPSG:4674).

## Agendamento (pg_cron)
- InfoDengue: segunda e quinta 09:00 UTC (ano corrente)
- GenBank: todo dia 10:00 UTC (registros modificados desde a última carga; era terça até 14/11/2026, migração 012)
- IBGE: dia 1 de cada mês, 08:00 UTC
- Indicadores: a cada 6 h
