# Detecção de focos: rodada retrospectiva 2020–2026

Gerada em 2026-11-14T17:59:58+00:00 com `scripts/focos_retrospectivo.py` (commit `9f00e59`, Python 3.13.18, NumPy 2.5.3, 999 réplicas, semente 20261114).
Dados: extração de `public.caso_semanal` e `public.municipio` feita em 2026-11-14 17:51:56 UTC (InfoDengue `/api/alertcity`, SE 01/2020 a 44/2026, 167 municípios do RN; IBGE BC250 2025). Cada semana foi avaliada só com as semanas anteriores a ela.

**Como ler.** "Referência" é um município-ano com incidência anual ≥ 300 por 100 mil (critério provisório, ver `docs/FOCOS.md`). Ela conta como detectada se um episódio R4/R5 começou entre 8 semanas antes do pico daquele município e o pico. "Episódios em baixa incidência" são aberturas em município-ano com incidência < 100 por 100 mil: um indicador aproximado de alarme sem surto, não uma contagem de falsos positivos confirmados. R5 só começa em 2021, porque precisa de 52 semanas de período de estudo; 2026 vai até a SE 44.

## Dengue

Total: 332 de 477 referências detectadas (70%), mediana de 3 semanas entre o início do episódio e o pico do município; 1296 episódios em 7 anos para 167 municípios.

| Ano | Casos no RN | Pico do RN (SE) | Sinais R4 | Aglomerados R5 | Episódios | Em baixa incidência | Referências | Detectadas | Antecedência média (sem.) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2020 | 12.872 | 202010 | 118 | 2 | 61 | 2 | 48 | 30 | 1,7 |
| 2021 | 7.136 | 202122 | 96 | 200 | 188 | 117 | 22 | 15 | 5,5 |
| 2022 | 55.232 | 202222 | 532 | 401 | 273 | 29 | 130 | 86 | 4,1 |
| 2023 | 12.151 | 202315 | 121 | 207 | 156 | 57 | 49 | 28 | 3,0 |
| 2024 | 31.143 | 202411 | 348 | 273 | 211 | 28 | 119 | 99 | 3,6 |
| 2025 | 16.917 | 202517 | 135 | 228 | 234 | 90 | 58 | 42 | 2,0 |
| 2026 (até SE 44) | 15.184 | 202624 | 144 | 224 | 173 | 61 | 51 | 32 | 2,9 |

## Chikungunya

Total: 146 de 228 referências detectadas (64%), mediana de 3 semanas entre o início do episódio e o pico do município; 1066 episódios em 7 anos para 167 municípios.

| Ano | Casos no RN | Pico do RN (SE) | Sinais R4 | Aglomerados R5 | Episódios | Em baixa incidência | Referências | Detectadas | Antecedência média (sem.) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2020 | 7.794 | 202027 | 69 | 4 | 36 | 10 | 20 | 15 | 2,8 |
| 2021 | 5.738 | 202116 | 87 | 211 | 160 | 115 | 18 | 9 | 5,6 |
| 2022 | 19.373 | 202222 | 350 | 358 | 290 | 88 | 85 | 60 | 3,4 |
| 2023 | 3.666 | 202315 | 59 | 148 | 115 | 78 | 20 | 7 | 0,6 |
| 2024 | 6.150 | 202411 | 134 | 142 | 186 | 84 | 48 | 34 | 2,7 |
| 2025 | 4.745 | 202531 | 71 | 130 | 137 | 79 | 24 | 13 | 1,8 |
| 2026 (até SE 44) | 1.985 | 202609 | 28 | 105 | 142 | 105 | 13 | 8 | 1,5 |

## Leitura

- R4 e R5 juntos sinalizaram antes do pico em cerca de dois terços dos municípios-ano de alta incidência, com cerca de 3 semanas de antecedência. É o resultado a sustentar na defesa, com o critério de referência declarado como provisório.
- O volume de episódios (150 a 290 por ano no estado, cerca de 1 a 2 por município por ano) é administrável para revisão humana, mas uma parte relevante cai em municípios de baixa incidência, sobretudo por R5 em chikungunya. Calibrar R5 (tamanho máximo do círculo, mínimo de casos) e validar contra o SaTScan é trabalho do doutorado.
- Não é avaliação de acurácia: falta a referência documentada (`data/reference/eventos_conhecidos.csv`, ainda vazio).
