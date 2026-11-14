#!/usr/bin/env bash
# Aplica 001–020 em ordem num Postgres DESCARTÁVEL com PostGIS, sobre o stub do
# Supabase (tests/fixtures/sql/FIXTURE_supabase_stub.sql), e depois reaplica
# 013–020 para conferir idempotência. pg_net e pg_cron não existem fora do
# Supabase: as duas linhas `create extension` são puladas e o stub cria os
# schemas `net` e `cron` com as funções usadas. Uso:
#   scripts/homologar_migracoes.sh postgresql://postgres@localhost:5432/postgres
set -euo pipefail
BASE="${1:?url do Postgres descartável}"
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
DB="vigigen_homolog"
SEM_DB="${BASE%/*}"
psql "$BASE" -qc "drop database if exists $DB" -c "create database $DB"
U="$SEM_DB/$DB"
psql "$U" -q -v ON_ERROR_STOP=1 -f "$RAIZ/tests/fixtures/sql/FIXTURE_supabase_stub.sql" >/dev/null
aplicar() {
  sed -E '/create extension if not exists (pg_net|pg_cron)/d' "$1" | psql "$U" -q -v ON_ERROR_STOP=1 -f - >/dev/null 2>"$RAIZ/.homolog_err" \
    || { echo "FALHOU: $(basename "$1")"; grep -E "ERROR" "$RAIZ/.homolog_err" | head -3; rm -f "$RAIZ/.homolog_err"; exit 1; }
  echo "ok: $(basename "$1")"
}
for f in $(ls "$RAIZ"/src/db/migrations/*.sql | sort); do aplicar "$f"; done
echo "--- reaplicação (idempotência) de 013 a 020"
for f in $(ls "$RAIZ"/src/db/migrations/0{13,14,15,16,17,18,20}_*.sql | sort); do aplicar "$f"; done
rm -f "$RAIZ/.homolog_err"
psql "$U" -Atc "select 'tabelas public: '||count(*) from information_schema.tables where table_schema='public'"
psql "$U" -Atc "select 'tabelas sem RLS: '||coalesce(string_agg(relname, ', '), 'nenhuma') from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity"
psql "$U" -Atc "select 'agendamentos: '||string_agg(jobname||' ('||schedule||')', '; ' order by jobname) from cron.job"
