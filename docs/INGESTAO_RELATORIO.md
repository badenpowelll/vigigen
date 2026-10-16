# Relatório da carga inicial (16/10/2026)

Números lidos do banco de produção (Supabase, projeto `tizmhihnggbvjzsmnpne`).

| Fonte | Respostas brutas | Tamanho cru | Registros | Situação |
|---|---|---|---|---|
| IBGE | 10 (WFS, 10 fatias) | 0,9 MB | 167 municípios | ok pela rota substituta (D-003); a rota documentada falhou por TLS |
| GenBank | 60 (esearch + 59 efetch) | 169,9 MB | 5.876 sequências | ok |
| InfoDengue | 501 (167 municípios × 3 agravos) | 91,4 MB | 154.308 semanas | ok, 0 falhas |

Tamanho do banco depois da carga: 147 MB (o `bruto` ocupa 70 MB compactado).

## InfoDengue
- Dengue e chikungunya: SE 01/2020 a SE 40/2026, 167 municípios.
- **Zika: a série do InfoDengue para o RN termina na SE 07/2024.** O painel
  mostra essa semana como a última publicada, com aviso.
- Casos de dengue notificados no RN: 31.143 em 2024, 16.780 em 2025 e 14.186 em 2026 até a SE 40.

## GenBank (Brasil, `"Dengue virus"[Organism] AND Brazil[All Fields]`)
- Sorotipo declarado: DENV-1 2.572 · DENV-2 1.844 · DENV-3 697 · DENV-4 736 · não declarado 27.
- Coleta de 1982 a 22/03/2025; 514 sem data de coleta.
- 1.507 (25,6%) só com "Brazil" no geo_loc, sem estado.
- **RN: 3 sequências pelo geo_loc** (KF672773 DENV-1 1997, HM450098 DENV-1 2001,
  OR501013 DENV-2 2022) e 4 com "/RN/" no nome da cepa (AF529073, AF529071,
  HQ012515, HQ012514), contadas à parte.
- Oportunidade (mediana Brasil, coleta até a publicação): 2.154 dias para coletas
  de 2020, 693 para 2022, 519 para 2023, 725 para 2024.

## Cobertura de sequenciamento no RN
1 sequência para 55.232 casos de dengue em 2022; 0 nos outros anos de 2020 a 2026.
Nenhum município do RN tem sequência com município identificado no último trimestre fechado.

## Isolamento por território
Ver `RLS_RESULTADO.md`: nenhuma falha.
