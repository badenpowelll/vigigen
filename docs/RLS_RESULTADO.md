# Prova de isolamento territorial (RLS)

Executado em 16/10/2026 contra o banco de produção do VigiGen (Supabase), com
`tests/test_rls.sql`. O script cria três usuários e três organizações com
prefixo `FIXTURE_`, mede o que cada um enxerga no papel `authenticated` e
termina com `RAISE EXCEPTION`, o que desfaz tudo. Nada ficou gravado.

Resultado: **ok, nenhuma falha**.

| Medida | SMS Natal (papel leitura) | SMS Mossoró (vigilância) | SESAP RN (vigilância) |
|---|---|---|---|
| semanas de casos de Natal | 924 | **0** | 924 |
| semanas de casos de Mossoró | **0** | 924 | 924 |
| municípios distintos visíveis | 1 | 1 | 167 |
| indicadores de outros municípios | 0 | 0 | 4.785 |
| alerta FIXTURE de Natal visível | 1 | **0** | 1 |
| conseguiu revisar o alerta | **não** (papel leitura) | não (não enxerga) | sim |
| respostas brutas (`bruto`) | 0 | 0 | 571 |
| auditoria | 0 | 0 | 4 |

Visitante anônimo (`anon`): permissão negada em `caso_semanal`.

Observação: `painel_semana()` devolve a lista dos 167 municípios para qualquer
usuário porque nome e malha são públicos (IBGE), mas os números de casos dos
municípios fora do território chegam vazios, filtrados pela RLS de
`caso_semanal`; no painel eles aparecem como "sem dado".
