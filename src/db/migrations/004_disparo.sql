-- 004: disparo das Edge Functions a partir do banco (pg_net), com o token
-- de ingestão guardado no Vault ('vigigen_ingest_token'). Usado pelo pg_cron.
create or replace function app.disparar(funcao text, corpo jsonb default '{}'::jsonb)
returns bigint language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://tizmhihnggbvjzsmnpne.supabase.co/functions/v1/' || funcao,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-vigigen-token', (select decrypted_secret from vault.decrypted_secrets where name = 'vigigen_ingest_token')),
    body := corpo,
    timeout_milliseconds := 150000);
$$;
revoke all on function app.disparar(text, jsonb) from public, anon, authenticated;
