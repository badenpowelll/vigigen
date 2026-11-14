-- Teste da migração 021 (limite de tentativas da Edge Function `acesso`).
-- IPs de documentação (RFC 5737) e e-mails FIXTURE_. Roda num Postgres
-- descartável depois da cadeia de migrações (ver tests/test_acesso.py).
\set ON_ERROR_STOP on
do $$
declare r jsonb; i int; id1 bigint;
begin
  -- 10 tentativas por IP passam; a 11ª é bloqueada
  for i in 1..10 loop
    r := public.acesso_pode_tentar('198.51.100.7', format('fixture_ip%s@vigigen.invalid', i));
    assert (r->>'ok')::boolean, 'tentativa ' || i || ' deveria passar';
    perform public.acesso_registrar_resultado((r->>'id')::bigint, 'ok', null);
  end loop;
  r := public.acesso_pode_tentar('198.51.100.7', 'fixture_ip11@vigigen.invalid');
  assert not (r->>'ok')::boolean and (r->>'espera_s')::int >= 60, 'limite por IP: ' || r::text;
  assert (select resultado from public.acesso_tentativa order by id desc limit 1) = 'bloqueado_taxa', 'bloqueio registrado';

  -- por e-mail: 5 falhas, de IPs diferentes, bloqueiam a 6ª
  for i in 1..5 loop
    r := public.acesso_pode_tentar(format('203.0.113.%s', i), 'fixture_alvo@vigigen.invalid');
    assert (r->>'ok')::boolean, 'falha ' || i || ' deveria passar';
    perform public.acesso_registrar_resultado((r->>'id')::bigint, 'recusado', 'convite inválido');
  end loop;
  r := public.acesso_pode_tentar('203.0.113.99', 'FIXTURE_ALVO@vigigen.invalid ');
  assert not (r->>'ok')::boolean, 'limite por e-mail (normaliza caixa e espaço)';

  -- outro e-mail num IP limpo segue livre
  r := public.acesso_pode_tentar('203.0.113.200', 'fixture_outro@vigigen.invalid');
  assert (r->>'ok')::boolean, 'outro e-mail livre';
  id1 := (r->>'id')::bigint;
  perform public.acesso_registrar_resultado(id1, 'ok', 'cadastro');
  perform public.acesso_registrar_resultado(id1, 'erro', 'segunda escrita');   -- não sobrescreve
  assert (select resultado from public.acesso_tentativa where id = id1) = 'ok', 'resultado só é gravado uma vez';

  -- tentativas antigas expiram da janela e são apagadas depois de 90 dias
  update public.acesso_tentativa set ocorrido_em = now() - interval '91 days' where ip = '198.51.100.7';
  r := public.acesso_pode_tentar('198.51.100.7', 'fixture_volta@vigigen.invalid');
  assert (r->>'ok')::boolean, 'IP liberado depois da janela';
  assert (select count(*) from public.acesso_tentativa where ocorrido_em < now() - interval '90 days') = 0, 'retenção de 90 dias';

  -- ninguém além da service role chama as funções
  assert not has_function_privilege('anon', 'public.acesso_pode_tentar(text, text)', 'execute'), 'anon sem acesso';
  assert not has_function_privilege('authenticated', 'public.acesso_pode_tentar(text, text)', 'execute'), 'authenticated sem acesso';
  assert has_function_privilege('service_role', 'public.acesso_pode_tentar(text, text)', 'execute'), 'service_role com acesso';
  assert not has_table_privilege('authenticated', 'public.acesso_tentativa', 'INSERT'), 'sem escrita direta';
  raise notice 'OK: migração 021 passou em todos os testes';
end $$;
