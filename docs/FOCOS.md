# Detecção de focos (R4 e R5)

Decisão: D-022. Código: `src/indicators/focos.py` (método),
`src/indicators/focos_db.py` (banco), `scripts/focos_retrospectivo.py`
(avaliação), `src/db/migrations/020_focos.sql` (contrato de entrada).

O módulo responde a duas perguntas, a cada carga nova do InfoDengue:

- **R4, aumento local**: este município passou do esperado nesta semana?
- **R5, aglomerado**: há um grupo de municípios vizinhos crescendo junto agora?

Os dados são atualizados automaticamente, com a origem e a data de cada número
visíveis. Não são de tempo real: o InfoDengue chega duas vezes por semana e as
últimas semanas ainda são corrigidas pelo atraso de notificação. Nenhum sinal
se confirma sozinho: cada um vira alerta com status "novo" em `public.alerta`
e a equipe de vigilância do território revisa (em análise, confirmado,
descartado), com a RLS e a auditoria que já existem.

## Dados usados hoje

| Dado | Origem | Nível |
| --- | --- | --- |
| casos estimados por semana (nowcast) e notificados | InfoDengue `/api/alertcity`, em `public.caso_semanal` (bruto em `public.bruto`) | município × semana epidemiológica |
| centroide (ponto na superfície) e vizinhança | IBGE BC250 2025, em `public.municipio` | município |
| população | InfoDengue (`pop`), última semana | município |

Agravos: dengue e chikungunya. O InfoDengue de Zika para o RN termina na SE
07/2024, então Zika não entra na detecção.

## Métodos e parâmetros

Todos os parâmetros estão no topo de `src/indicators/focos.py` e são gravados
na evidência de cada alerta e em cada saída.

**R4, EARS C2** (Hutwagner et al., 2003, J Urban Health 80(2 Suppl 1):i89-96).
C2 = (x_t − média)/desvio, com linha de base nas semanas t−3 a t−9. Sinal se
C2 > 3 e x_t ≥ 5 casos. O desvio tem piso de 1 caso, para séries com linha de
base constante (muito comum em municípios pequenos) não gerarem divisões por zero.

**R5, varredura espaço-temporal prospectiva, modelo de permutação** (Kulldorff
et al., 2005, PLoS Med 2(3):e59). Cilindros com base circular (município e
seus vizinhos mais próximos, de 2 a 10) e altura de 1 a 4 semanas terminando
na semana avaliada, dentro de um período de estudo de 52 semanas. Esperado
μ = C_z·C_d/C (não precisa de população em risco). Estatística: razão de
verossimilhança só para excesso. Significância por Monte Carlo com 999
réplicas, sorteando as semanas dos casos com as margens fixas. Sinal se o
intervalo de recorrência for ≥ 52 semanas (p ≤ 1/52), com pelo menos 5 casos
no cilindro. Aglomerados secundários são reportados quando não se sobrepõem
a um mais forte. **Em validação**: a comparação com o SaTScan nos mesmos dados
fica para o doutorado.

**Episódio.** Um sinal (R4 ou R5) abre episódio se o município ficou 4 semanas
sem sinal do mesmo agravo; senão prolonga o episódio aberto. Só a abertura gera
alerta. Um aglomerado R5 gera um alerta por município participante (cada equipe
vê o seu pela RLS), com o mesmo aglomerado descrito na evidência.

## Escala de bairro: contrato de entrada e LGPD

Resultados individuais de exame (PEP do LAIS/UFRN, GAL/LACEN-RN, e-SUS) ainda
não estão acessíveis: dependem de acordo institucional. O módulo já tem o
encaixe, vazio:

1. O endereço entra na origem sem número da casa (rua ou avenida, bairro, CEP,
   localidade, conjunto, loteamento ou terreno, município, região, estado).
2. No ambiente do controlador, o endereço vira setor censitário ou bairro e é
   descartado. Rua e CEP não saem de lá: numa rua pequena ou num conjunto,
   "rua + exame positivo + semana" pode apontar para uma única família.
3. Ao VigiGen chegam só contagens: território, semana, agravo, tipo de exame,
   resultado, sorotipo, qualidade da geocodificação e n
   (`public.exame_territorial`). Abaixo do município, contagem de 1 a 4 é
   recusada pelo banco: o dado sobe para o bairro ou o município na origem.
4. Leitura só por quem tem papel no território (RLS); nenhuma escrita pelo painel.
5. Base legal: tutela da saúde por autoridade sanitária (LGPD art. 11, II, f) na
   operação e estudos em saúde pública (art. 13) na pesquisa, com relatório de
   impacto (RIPD), CEP e termo com o controlador antes do primeiro dado.

**Margem de erro do local de infecção.** A pessoa mora num lugar e pode ter se
infectado em outro. `faixa_por_territorio()` reparte cada caso entre a
residência, os vizinhos imediatos e, quando houver, os destinos de deslocamento
para trabalho e estudo (matriz do Censo do IBGE), em três cenários: 100%, 70% e
50% na residência. Cada território mostra a faixa mínimo–máximo; R4/R5 rodam em
cada cenário e `robustez()` marca o sinal como "robusto" (todos os cenários) ou
"sinal fraco" (só alguns). Quando a investigação registrar o local provável de
infecção, ele substitui a repartição para aquele caso (`local_infeccao =
'investigado'`). Os pesos são parâmetros da tese, a calibrar no doutorado com
casos de local investigado.

## Como rodar

```
# testes (os de banco precisam de um Postgres descartável)
VIGIGEN_PG_TESTE=postgresql://postgres@localhost:5432/t python -m pytest tests/test_focos.py

# avaliação retrospectiva sobre uma extração do banco
python scripts/focos_retrospectivo.py data/interim/focos/extracao_<carimbo>.json

# detecção sobre o banco (grava alertas; só com autorização para produção)
DATABASE_URL=... python -m src.indicators.focos_db detectar data/interim/focos/relatorio.json
```

O workflow `.github/workflows/focos.yml` roda só manualmente; o agendamento
(segunda e quinta, 11:00 UTC) fica comentado até autorização.

## Limites declarados

- Escala mínima hoje: município. Bairro e setor dependem do acordo de dados.
- A rodada retrospectiva usa a versão atual das séries do InfoDengue, já
  revisadas; em operação, as últimas semanas são estimativas que ainda mudam.
- A população usada na avaliação é a da última semana do InfoDengue para todos
  os anos.
- O critério de referência da avaliação (município-ano com incidência anual
  ≥ 300 por 100 mil) é provisório. A referência definitiva são eventos
  documentados em `data/reference/eventos_conhecidos.csv`, ainda vazio, a
  preencher só com fonte (boletins da SESAP-RN, artigos).
- R5 depende da vizinhança por centroides; municípios grandes e de forma
  irregular podem ter vizinhos mal representados.
