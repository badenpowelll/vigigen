# Teste real do Nextclade em lote pequeno (14/11/2026)

Objetivo: comprovar, com sequências públicas reais e versões registradas, que a
etapa de classificação funciona, e medir o que ela consegue dizer sobre o
material genômico do RN. Nada foi gravado no banco de produção.

## Entrada

- As 7 sequências do banco associadas ao RN (`uf_inferida = 'RN'` ou
  `rn_por_nome_cepa`), exportadas por consulta só leitura em 14/11/2026 ~16:00 UTC.
- Conferência: md5 de cada FASTA exportado igual ao `md5(sequencia_fasta)` no banco (7 de 7).
- Arquivo local (não versionado): `data/interim/nextclade_teste_20261114/rn.fasta`,
  sha256 `fdaf34f901494b6123bcda262f931cc5cdba618046f969eafab9eed8bba690ad`.

| Accession | Organismo declarado | Coleta | Tamanho (nt) |
|---|---|---|---|
| HM450098 | dengue virus type 1 | 2001 | 2.326 |
| KF672773 | dengue virus type 1 | 1997 | 2.325 |
| HQ012514 | dengue virus type 2 | 1997 | 2.325 |
| HQ012515 | dengue virus type 2 | 1997 | 2.325 |
| OR501013 | dengue virus type 2 | 21-Apr-2022 | 1.096 |
| AF529071 | dengue virus type 2 | sem data | 240 |
| AF529073 | dengue virus type 2 | sem data | 240 |

## Ferramentas e dataset

- Nextclade CLI **3.18.1**, binário oficial `nextclade-x86_64-unknown-linux-gnu` do
  release do GitHub (sha256 `f08e23f8b73da60453b70356326cea75b56c46ed13f3e9ce694d6b1f590df7c1`).
- Dataset **nextstrain/dengue/all** ("Dengue virus All serotypes", referência
  NC_002640, marcado como experimental), arquivos baixados de
  `raw.githubusercontent.com/nextstrain/nextclade_data/master/data/nextstrain/dengue/all/`
  em 14/11/2026. O `pathogen.json` desse caminho traz `tag: unreleased`; o
  CHANGELOG termina em 2026-04-14T11:55:23Z. sha256:
  - pathogen.json `fa33d486121ac73e8afa687750a132828f90e44c225b740b0660a7c9ac4b72e8`
  - reference.fasta `4882b77967e897fcbc5893ee8c4dd84eb5851c762c1dc4ddd47e887cbeab8517`
  - tree.json `bba510dedc4f42f3db7db2b9bfce539756a4587924b999270ff8401ce87abc83`
  - genome_annotation.gff3 `97fe105d8d08a33089964fd02c1874d3c2d229a23b0055323574d896111d79dd`
- O servidor oficial de datasets (`data.clades.nextstrain.org`) foi recusado pelo
  proxy deste ambiente (HTTP 403), por isso o dataset veio do repositório oficial
  no GitHub. No GitHub Actions o workflow usa `nextclade dataset get` normalmente.
- Comando: `nextclade run --input-dataset ds/dengue-all --output-tsv rn.tsv --output-json rn.json rn.fasta`

## Resultado

| Accession | Clado Nextclade | Bate com o declarado? | QC | Cobertura do genoma |
|---|---|---|---|---|
| HM450098 | DENV1 | sim | good (0) | 21,8% |
| KF672773 | DENV1 | sim | good (0) | 21,8% |
| HQ012514 | DENV2 | sim | good (0) | 21,8% |
| HQ012515 | DENV2 | sim | good (0) | 21,8% |
| OR501013 | DENV2 | sim | good (0) | 10,3% |
| AF529071 | — | não classificada | excluída: 240 nt, mínimo do dataset 1.000 nt | — |
| AF529073 | — | não classificada | excluída: 240 nt, mínimo do dataset 1.000 nt | — |

## Leitura

1. A classificação de sorotipo funciona e concorda com o sorotipo declarado em 5 de 5.
2. Nenhuma sequência do RN chega à cobertura mínima de 70% do genoma que o
   pipeline do VigiGen exige para genótipo e linhagem (máximo observado: 21,8%).
   Pela regra do projeto, as 7 seriam excluídas da detecção de linhagem, com motivo.
3. A classificação em genótipo/linhagem depende dos datasets por sorotipo. Os
   nomes exatos desses datasets saem de `nextclade dataset list` (D-013) e não
   foram adivinhados aqui; o teste ficou no dataset de todos os sorotipos.
4. Consequência para a banca: o pipeline está comprovado de ponta a ponta no
   nível de sorotipo, mas o material público do RN não sustenta detecção de
   linhagem municipal. Isso é resultado, não falha do código.
