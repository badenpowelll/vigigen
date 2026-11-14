# Homologação das migrações 015 e 021 (antes de produção)

Auditoria da autenticação de 14/11/2026. Nada aqui foi aplicado em produção.
Produção só com autorização expressa do Baden, depois deste roteiro passar.

| Migração | O que muda | Risco se der errado |
|---|---|---|
| `015_seguranca.sql` | Tira INSERT/UPDATE/DELETE/TRUNCATE de `anon` e `authenticated` em 12 tabelas (fica só leitura e `alerta.status`); `registrar_eventos` sem login aceita 1 evento por chamada e 20 por IP a cada 10 min | Painel sem conseguir revisar alerta; telemetria perdendo eventos |
| `021_acesso_limite.sql` | Tabela `acesso_tentativa` e limite de 10 tentativas por IP e 5 falhas por e-mail a cada 15 min na Edge Function `acesso` | Primeiro acesso recusado (503) se a função for publicada antes da 021 |

## 1. Ambiente de homologação

Um segundo projeto Supabase (o plano gratuito permite dois), só para teste, na
mesma região (sa-east-1). Não copiar `auth.users`, `perfil`, `convite`,
`evento_uso` nem `acesso_tentativa` de produção: têm e-mail e IP (LGPD). As
tabelas de dado (`municipio`, `caso_semanal`, `sequencia`, `indicador`) são
públicas e agregadas e podem ser copiadas.

```bash
# esquema de produção (sem dados)
pg_dump "$PROD_URL" --schema-only -n public -n app > /tmp/esquema.sql
# dados públicos agregados, para os testes de território terem o que medir
pg_dump "$PROD_URL" --data-only -t public.municipio -t public.caso_semanal \
        -t public.sequencia -t public.indicador > /tmp/dados.sql
psql "$HOMOLOG_URL" -f /tmp/esquema.sql
psql "$HOMOLOG_URL" -f /tmp/dados.sql
```

Conferir antes de seguir: `select count(*) from public.municipio` = 167 e os
gatilhos da 011 em `auth.users` (`vigigen_convite_obrigatorio`,
`vigigen_cria_perfil`) existem no projeto de homologação.

## 2. Linha de base (antes da 015)

```bash
DATABASE_URL="$HOMOLOG_URL" pytest tests/test_rls.py tests/test_acesso.py -k "homologacao or isolamento"
```

Os dois devem passar já antes da 015. Guardar a saída.

## 3. Aplicar e testar

```bash
psql "$HOMOLOG_URL" -v ON_ERROR_STOP=1 -f src/db/migrations/015_seguranca.sql
psql "$HOMOLOG_URL" -v ON_ERROR_STOP=1 -f src/db/migrations/021_acesso_limite.sql
DATABASE_URL="$HOMOLOG_URL" pytest tests/test_rls.py tests/test_acesso.py -k "homologacao or isolamento"
```

Conferência de privilégios (deve voltar vazio):

```sql
select table_name, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon','authenticated')
   and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER');
```

Exceção esperada: `UPDATE` na coluna `status` de `alerta` aparece em
`information_schema.column_privileges`, não nesta consulta.

## 4. Teste pelo painel (homologação)

1. Publicar a Edge Function `acesso` no projeto de homologação **depois** da 021.
2. Rodar o painel apontando para homologação (`VITE_SUPABASE_URL` e
   `VITE_SUPABASE_ANON_KEY` do projeto de teste) com `npm run dev`.
3. Criar um convite de teste (`select app.novo_convite('fixture_homolog@vigigen.invalid', 'FIXTURE', false, <org>, 'vigilancia')`)
   e fazer o primeiro acesso pela tela.
4. Errar o código 6 vezes seguidas: a 6ª tentativa deve responder
   "Muitas tentativas" (HTTP 429) e aparecer como `bloqueado_taxa` em `acesso_tentativa`.
5. Entrar, revisar um alerta (vigilância muda status; leitura não muda).
6. Desativar a conta pelo menu Administração com a sessão aberta noutra aba e
   recarregar: a tela "Conta desativada" aparece e o painel não abre.
7. Errar a senha algumas vezes sem login: os eventos `login_falha` entram em
   `evento_uso` até 20 por IP em 10 minutos.

## 5. Critério para levar à produção

Todos os testes do item 3 passam, a consulta de privilégios volta vazia e os
sete passos do item 4 se comportam como descrito. Registrar data, versão do
Postgres e o commit testado em `docs/RLS_RESULTADO.md`.

## 6. Produção (só com o ok do Baden)

Ordem: `015` → `021` → publicar a Edge Function `acesso` → `pytest tests/test_rls.py tests/test_acesso.py -k "homologacao or isolamento"`
contra produção (os dois testes desfazem tudo o que criam).

## 7. Reversão

As duas migrações trazem o bloco de reversão no fim do arquivo. A 021 só se
reverte depois de republicar a versão anterior da Edge Function `acesso`.

## 8. O que só se confere no painel do Supabase (não é SQL)

- **Senhas vazadas:** Authentication → Sign In / Providers → Email →
  "Prevent use of leaked passwords" ligado. Tamanho mínimo da senha: 10
  (o mesmo que o painel exige).
- **Sessões:** Authentication → Sessions (ou JWT Settings): validade do token
  de acesso (padrão 1 h), "Detect and revoke potentially compromised refresh
  tokens" ligado, e, se o plano permitir, tempo máximo de sessão e tempo de
  inatividade.
