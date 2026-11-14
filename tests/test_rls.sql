-- Prova de isolamento territorial (RLS).
-- Cria usuários e organizações FIXTURE_, mede o que cada um enxerga como
-- `authenticated` e termina com RAISE EXCEPTION: tudo é desfeito (rollback)
-- e o resultado sai na mensagem de erro. Nada fica gravado no banco.
--
-- Esperado:
--   FIXTURE_natal    vê só Natal (2408102): 0 linhas de Mossoró, 0 de bruto/auditoria
--   FIXTURE_mossoro  vê só Mossoró (2408003): 0 linhas de Natal
--   FIXTURE_estado   vê os 167 municípios e o bruto
--   FIXTURE_leitura de Natal não consegue revisar alerta (UPDATE bloqueado)
--   anon             não lê nada
do $$
declare
  u_natal   uuid := 'f1000000-0000-4000-8000-000000000001';
  u_moss    uuid := 'f1000000-0000-4000-8000-000000000002';
  u_estado  uuid := 'f1000000-0000-4000-8000-000000000003';
  o_natal   uuid := 'f2000000-0000-4000-8000-000000000001';
  o_moss    uuid := 'f2000000-0000-4000-8000-000000000002';
  o_estado  uuid := 'f2000000-0000-4000-8000-000000000003';
  g_natal   int  := 2408102;
  g_moss    int  := 2408003;
  res       jsonb := '{}';
  r         jsonb;
  u         record;
  falhas    text[] := '{}';
begin
  -- desde a 011 o cadastro é fechado: auth.users só aceita e-mail com convite liberado
  perform app.novo_convite(e, 'FIXTURE', false, null, null, 'cadastro', null)
  from unnest(array['FIXTURE_natal@vigigen.invalid', 'FIXTURE_mossoro@vigigen.invalid', 'FIXTURE_estado@vigigen.invalid']) e;
  update public.convite set liberado_em = now() where email like 'fixture\_%@vigigen.invalid';
  insert into auth.users (id, email, aud, role, instance_id)
  values (u_natal,  'FIXTURE_natal@vigigen.invalid',   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (u_moss,   'FIXTURE_mossoro@vigigen.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (u_estado, 'FIXTURE_estado@vigigen.invalid',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  insert into public.organizacao (id, nome, tipo, geocodigo_ibge)
  values (o_natal, 'FIXTURE_SMS Natal', 'municipio', g_natal),
         (o_moss, 'FIXTURE_SMS Mossoró', 'municipio', g_moss),
         (o_estado, 'FIXTURE_SESAP RN', 'estado', null);
  insert into public.usuario_organizacao (user_id, organizacao_id, papel)
  values (u_natal, o_natal, 'leitura'), (u_moss, o_moss, 'vigilancia'), (u_estado, o_estado, 'vigilancia');

  -- um alerta FIXTURE_ em Natal, para testar a revisão
  insert into public.alerta (geocodigo, tipo, periodo_deteccao, evidencia)
  values (g_natal, 'FIXTURE_teste_rls', 'FIXTURE', '{"fixture": true}');

  for u in select * from (values ('natal', u_natal), ('mossoro', u_moss), ('estado', u_estado)) v(nome, id) loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u.id, 'role', 'authenticated')::text, true);
    set local role authenticated;
    r := jsonb_build_object(
      'caso_semanal_natal',   (select count(*) from public.caso_semanal where geocodigo = g_natal),
      'caso_semanal_mossoro', (select count(*) from public.caso_semanal where geocodigo = g_moss),
      'caso_semanal_total_municipios', (select count(distinct geocodigo) from public.caso_semanal),
      'indicador_municipal_outros', (select count(*) from public.indicador where nivel = 'municipio' and geocodigo not in (g_natal, g_moss)),
      'alerta_visivel', (select count(*) from public.alerta where tipo = 'FIXTURE_teste_rls'),
      'bruto', (select count(*) from public.bruto),
      'auditoria', (select count(*) from public.auditoria),
      'painel_semana_municipios', (select jsonb_array_length(public.painel_semana('dengue')->'municipios'))
    );
    -- tentativa de revisar o alerta FIXTURE de Natal
    update public.alerta set status = 'em_analise' where tipo = 'FIXTURE_teste_rls';
    r := r || jsonb_build_object('alerta_revisado', (select count(*) from public.alerta where tipo = 'FIXTURE_teste_rls' and status = 'em_analise'));
    reset role;
    update public.alerta set status = 'novo' where tipo = 'FIXTURE_teste_rls';
    res := res || jsonb_build_object(u.nome, r);
  end loop;

  set local role anon;
  begin
    res := res || jsonb_build_object('anon_caso_semanal', (select count(*) from public.caso_semanal));
  exception when insufficient_privilege then
    res := res || jsonb_build_object('anon_caso_semanal', 'permissão negada');
  end;
  reset role;

  -- verificações
  if (res->'natal'->>'caso_semanal_mossoro')::int <> 0 then falhas := falhas || 'natal vê Mossoró'; end if;
  if (res->'mossoro'->>'caso_semanal_natal')::int <> 0 then falhas := falhas || 'mossoró vê Natal'; end if;
  if (res->'natal'->>'caso_semanal_total_municipios')::int <> 1 then falhas := falhas || 'natal vê mais de 1 município'; end if;
  if (res->'natal'->>'indicador_municipal_outros')::int <> 0 then falhas := falhas || 'natal vê indicador de outro município'; end if;
  if (res->'natal'->>'bruto')::int <> 0 or (res->'natal'->>'auditoria')::int <> 0 then falhas := falhas || 'município vê bruto/auditoria'; end if;
  if (res->'mossoro'->>'alerta_visivel')::int <> 0 then falhas := falhas || 'mossoró vê alerta de Natal'; end if;
  if (res->'natal'->>'alerta_revisado')::int <> 0 then falhas := falhas || 'papel leitura revisou alerta'; end if;
  if (res->'estado'->>'caso_semanal_total_municipios')::int <> 167 then falhas := falhas || 'estado não vê os 167'; end if;
  if (res->'estado'->>'alerta_revisado')::int <> 1 then falhas := falhas || 'vigilância estadual não conseguiu revisar'; end if;
  if res->>'anon_caso_semanal' not in ('0', 'permissão negada') then falhas := falhas || 'anon lê casos'; end if;

  raise exception 'RLS_RESULTADO %', jsonb_build_object(
    'ok', cardinality(falhas) = 0, 'falhas', to_jsonb(falhas), 'medido', res);
end $$;
