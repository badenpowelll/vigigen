-- Testes de acesso indevido entre organizações (auditoria de 14/11/2026).
--
-- Complementa tests/test_rls.sql: além do recorte territorial dos dados, prova
-- que um usuário de uma organização não lê perfil, vínculo, organização,
-- convite, trilha de uso nem tentativas de acesso de outra; que funções admin_*
-- recusam quem não é administrador; que conta desativada e conta sem vínculo
-- não veem nada; e que anon não chama nada.
--
-- Usuários e organizações FIXTURE_ são criados pelo fluxo real de convite (o
-- gatilho da 011 recusa auth.users sem convite liberado). O bloco termina com
-- RAISE EXCEPTION: tudo é desfeito e o resultado sai na mensagem
-- (ACESSO_RESULTADO {...}). Nada fica gravado.
--
-- Onde rodar: banco de homologação com as migrações aplicadas (ver
-- docs/HOMOLOGACAO_015.md). Em Postgres local, via tests/test_acesso.py.
do $$
declare
  u_natal  uuid := 'f1000000-0000-4000-8000-0000000000a1';
  u_moss   uuid := 'f1000000-0000-4000-8000-0000000000a2';
  u_estado uuid := 'f1000000-0000-4000-8000-0000000000a3';
  u_admin  uuid := 'f1000000-0000-4000-8000-0000000000a4';
  u_desat  uuid := 'f1000000-0000-4000-8000-0000000000a5';
  u_semv   uuid := 'f1000000-0000-4000-8000-0000000000a6';
  o_natal  uuid; o_moss uuid; o_estado uuid;
  g_natal  int := 2408102;
  g_moss   int := 2408003;
  tem_tentativa boolean := to_regclass('public.acesso_tentativa') is not null;
  res jsonb := '{}'; r jsonb; u record; falhas text[] := '{}';
  negado boolean; n int;
  fn text;
begin
  -- municípios (já existem em produção/homologação; no Postgres local, não)
  insert into public.municipio (geocodigo, nome, uf)
  select v.g, v.nm, 'RN' from (values (g_natal, 'FIXTURE_Natal'), (g_moss, 'FIXTURE_Mossoró')) v(g, nm)
  where not exists (select 1 from public.municipio m where m.geocodigo = v.g);

  insert into public.organizacao (nome, tipo, geocodigo_ibge) values ('FIXTURE_SMS Natal', 'municipio', g_natal) returning id into o_natal;
  insert into public.organizacao (nome, tipo, geocodigo_ibge) values ('FIXTURE_SMS Mossoró', 'municipio', g_moss) returning id into o_moss;
  insert into public.organizacao (nome, tipo, geocodigo_ibge) values ('FIXTURE_SESAP', 'estado', null) returning id into o_estado;

  for u in select * from (values
      (u_natal,  'fixture_natal@vigigen.invalid',  false, o_natal,  'leitura'),
      (u_moss,   'fixture_moss@vigigen.invalid',   false, o_moss,   'vigilancia'),
      (u_estado, 'fixture_estado@vigigen.invalid', false, o_estado, 'vigilancia'),
      (u_admin,  'fixture_admin@vigigen.invalid',  true,  null::uuid, null::text),
      (u_desat,  'fixture_desat@vigigen.invalid',  false, o_natal,  'vigilancia'),
      (u_semv,   'fixture_semv@vigigen.invalid',   false, null::uuid, null::text)) v(id, email, adm, org, papel) loop
    perform app.novo_convite(u.email, 'FIXTURE', u.adm, u.org, u.papel, 'cadastro', null);
    update public.convite set liberado_em = now() where email = u.email;
    insert into auth.users (id, email) values (u.id, u.email);
  end loop;
  update public.perfil set ativo = false where user_id = u_desat;

  insert into public.alerta (geocodigo, tipo, periodo_deteccao, evidencia)
  values (g_natal, 'FIXTURE_acesso', 'FIXTURE', '{"fixture": true}'),
         (g_moss,  'FIXTURE_acesso', 'FIXTURE', '{"fixture": true}');
  insert into public.evento_uso (user_id, email, tipo, alvo)
  values (u_natal, 'fixture_natal@vigigen.invalid', 'clique', 'FIXTURE'),
         (u_moss,  'fixture_moss@vigigen.invalid',  'clique', 'FIXTURE');
  if tem_tentativa then
    insert into public.acesso_tentativa (ip, email, resultado) values ('192.0.2.1', 'fixture_moss@vigigen.invalid', 'recusado');
  end if;

  for u in select * from (values ('natal', u_natal), ('mossoro', u_moss), ('estado', u_estado),
                                 ('admin', u_admin), ('desativado', u_desat), ('sem_vinculo', u_semv)) v(nome, id) loop
    -- auth.uid() do Supabase lê request.jwt.claims; o stub local lê teste.uid
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u.id, 'role', 'authenticated')::text, true);
    perform set_config('teste.uid', u.id::text, true);
    set local role authenticated;

    r := jsonb_build_object(
      'perfil_de_outros',   (select count(*) from public.perfil where user_id <> u.id and email like 'fixture\_%'),
      'vinculo_de_outros',  (select count(*) from public.usuario_organizacao where user_id <> u.id),
      'org_de_outros',      (select count(*) from public.organizacao o where o.nome like 'FIXTURE\_%'
                               and not exists (select 1 from public.usuario_organizacao uo where uo.organizacao_id = o.id and uo.user_id = u.id)),
      'alerta_natal',       (select count(*) from public.alerta where tipo = 'FIXTURE_acesso' and geocodigo = g_natal),
      'alerta_mossoro',     (select count(*) from public.alerta where tipo = 'FIXTURE_acesso' and geocodigo = g_moss),
      'caso_natal',         (select count(*) from public.caso_semanal where geocodigo = g_natal),
      'caso_mossoro',       (select count(*) from public.caso_semanal where geocodigo = g_moss),
      'evento_de_outros',   (select count(*) from public.evento_uso where alvo = 'FIXTURE' and user_id <> u.id),
      'meu_perfil_ativo',   (select public.meu_perfil()->>'ativo'));

    begin
      r := r || jsonb_build_object('convite', (select count(*) from public.convite));
    exception when insufficient_privilege then r := r || jsonb_build_object('convite', 'negado');
    end;
    if tem_tentativa then
      begin
        execute 'select count(*) from public.acesso_tentativa' into n;
        r := r || jsonb_build_object('acesso_tentativa', n);
      exception when insufficient_privilege then r := r || jsonb_build_object('acesso_tentativa', 'negado');
      end;
    end if;

    -- funções de administração: todas devem recusar quem não é administrador
    negado := true;
    foreach fn in array array['select public.admin_usuarios()', 'select public.admin_eventos()',
                              'select public.admin_resumo_uso()',
                              'select public.admin_convidar(''fixture_x@vigigen.invalid'', ''FIXTURE'', true, null, null)',
                              format('select public.admin_codigo_redefinicao(%L::uuid)', u_moss)] loop
      begin
        execute fn;
        negado := false;
      exception when insufficient_privilege or raise_exception or undefined_function then null;
      end;
    end loop;
    r := r || jsonb_build_object('admin_negado', negado);

    -- escrita direta: tentar se promover a administrador e se ligar a outra organização
    begin
      update public.perfil set administrador = true where user_id = u.id;
      r := r || jsonb_build_object('autopromocao', (select count(*) from public.perfil where user_id = u.id and administrador));
    exception when insufficient_privilege then r := r || jsonb_build_object('autopromocao', 'negado');
    end;
    begin
      insert into public.usuario_organizacao (user_id, organizacao_id, papel) values (u.id, o_moss, 'vigilancia');
      r := r || jsonb_build_object('autovinculo', 'gravou');
    exception when insufficient_privilege or check_violation or unique_violation then
      r := r || jsonb_build_object('autovinculo', 'negado');
    end;

    reset role;
    res := res || jsonb_build_object(u.nome, r);
  end loop;

  -- anon: nenhuma leitura nem função do painel/administração
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('teste.uid', '', true);
  set local role anon;
  negado := true;
  foreach fn in array array['select count(*) from public.perfil', 'select count(*) from public.convite',
                            'select count(*) from public.evento_uso', 'select public.meu_perfil()',
                            'select public.admin_usuarios()'] loop
    begin
      execute fn into n;
      if n is not null and n > 0 then negado := false; end if;
    exception when insufficient_privilege or raise_exception then null;
    end;
  end loop;
  reset role;
  res := res || jsonb_build_object('anon_negado', negado);

  -- verificações
  foreach fn in array array['natal', 'mossoro', 'estado', 'desativado', 'sem_vinculo'] loop
    r := res -> fn;
    if (r->>'perfil_de_outros')::int <> 0 then falhas := falhas || (fn || ': vê perfil de outros'); end if;
    if (r->>'vinculo_de_outros')::int <> 0 then falhas := falhas || (fn || ': vê vínculo de outros'); end if;
    if (r->>'org_de_outros')::int <> 0 then falhas := falhas || (fn || ': vê organização de outros'); end if;
    if (r->>'evento_de_outros')::int <> 0 then falhas := falhas || (fn || ': vê trilha de uso de outros'); end if;
    if r->>'convite' not in ('0', 'negado') then falhas := falhas || (fn || ': lê convites'); end if;
    if tem_tentativa and r->>'acesso_tentativa' not in ('0', 'negado') then falhas := falhas || (fn || ': lê tentativas de acesso'); end if;
    if not (r->>'admin_negado')::boolean then falhas := falhas || (fn || ': função admin_* não recusou'); end if;
    if r->>'autopromocao' not in ('0', 'negado') then falhas := falhas || (fn || ': virou administrador'); end if;
    if r->>'autovinculo' <> 'negado' then falhas := falhas || (fn || ': se vinculou a outra organização'); end if;
  end loop;
  if (res->'natal'->>'alerta_mossoro')::int <> 0 or (res->'natal'->>'caso_mossoro')::int <> 0 then falhas := falhas || 'natal vê Mossoró'::text; end if;
  if (res->'mossoro'->>'alerta_natal')::int <> 0 or (res->'mossoro'->>'caso_natal')::int <> 0 then falhas := falhas || 'mossoró vê Natal'::text; end if;
  if (res->'natal'->>'alerta_natal')::int <> 1 then falhas := falhas || 'natal não vê o próprio alerta'::text; end if;
  if (res->'estado'->>'alerta_natal')::int <> 1 or (res->'estado'->>'alerta_mossoro')::int <> 1 then falhas := falhas || 'estado não vê os dois municípios'::text; end if;
  if (res->'desativado'->>'alerta_natal')::int <> 0 or (res->'desativado'->>'caso_natal')::int <> 0 then falhas := falhas || 'conta desativada vê dado'::text; end if;
  if (res->'sem_vinculo'->>'alerta_natal')::int <> 0 or (res->'sem_vinculo'->>'alerta_mossoro')::int <> 0 then falhas := falhas || 'conta sem vínculo vê dado'::text; end if;
  if res->'desativado'->>'meu_perfil_ativo' <> 'false' then falhas := falhas || 'meu_perfil não informa a desativação'::text; end if;
  if (res->'admin'->>'admin_negado')::boolean then falhas := falhas || 'administrador recusado nas funções admin_*'::text; end if;
  if (res->'admin'->>'perfil_de_outros')::int < 5 then falhas := falhas || 'administrador não vê os perfis'::text; end if;
  if not (res->>'anon_negado')::boolean then falhas := falhas || 'anon lê algo'::text; end if;

  raise exception 'ACESSO_RESULTADO %', jsonb_build_object('ok', cardinality(falhas) = 0, 'falhas', to_jsonb(falhas), 'medido', res);
end $$;
