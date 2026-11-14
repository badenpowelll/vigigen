# Aplicações em produção (Supabase `tizmhihnggbvjzsmnpne`)

Cada linha só depois da autorização expressa do Baden.

| Data (UTC) | Migração | Como foi aplicada | Conferência |
|---|---|---|---|
| 2026-11-14 ~17:10 | 013_multiagravo | Em três partes (`013a_multiagravo_estrutura`, `013b_multiagravo_chave_indicador`, `013c_multiagravo_funcoes`), porque o conector pedia confirmação para o arquivo inteiro e o pedido expirava. Os `drop ... if exists` de gatilho e política foram omitidos (os objetos não existiam). **Os crons `vigigen-diario-genbank-chikungunya` e `-zika` não foram criados**: a Edge Function publicada ainda ignora `agravo` e dispararia cargas de dengue. Entram com a publicação da função nova. | Antes e depois: 7.203 sequências, assinatura md5(accession‖sorotipo) `33a22087c728d3b787be5e410f6744bb`; 7.203 com agravo = dengue; 5.163 indicadores, todos dengue; chave `indicador_chave_agravo`; `painel_resumo()` com bloco `genomica` (zika = 0 sequências). |
