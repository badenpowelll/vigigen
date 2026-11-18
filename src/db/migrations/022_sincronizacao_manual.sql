-- VigiGen — 022: sincronização manual (botão "Sincronizar" do painel).
-- NÃO APLICAR sem a aprovação do Baden.
--
-- O botão dispara, fora de hora, as MESMAS cargas que o agendamento já roda:
-- as tarefas do pg_cron de início de carga ('vigigen-semanal-*', 'vigigen-diario-*',
-- 'vigigen-mensal-*') que chamam app.disparar(...). A lista é lida de cron.job
-- no momento do pedido, então o botão acompanha o que estiver agendado em
-- produção (com ou sem 013/019 aplicadas) sem repetir endpoints aqui.
--
-- Por que uma fila e não um disparo único: as funções guardam uma execução em
-- andamento por fonte (execucao_ingestao); o GenBank responde 409 "ocupado" se
-- outro vírus estiver carregando. A fila dispara uma tarefa por fonte de cada vez
-- e espera a anterior terminar. Uma tarefa temporária do pg_cron
-- ('vigigen-sincronizar-manual', a cada minuto) avança a fila e se desliga ao
-- final, depois de recalcular os indicadores. Assim a sincronização termina
-- mesmo que quem clicou feche o navegador.
--
-- Segurança: nada de chave de serviço no navegador. O painel web chama
-- public.sincronizar_fontes() / public.sincronizacao_estado(), que exigem
-- administrador (app.exigir_admin). O artefato do claude.ai chama
-- app.sincronizar_pedir() / app.sincronizacao_json() pelo conector Supabase do
-- próprio visitante (que já tem acesso de dono ao banco); o esquema app não é
-- exposto pela API e essas funções não têm grant para anon/authenticated.
-- Proteção contra cliques repetidos: enquanto houver sincronização aberta, um novo
-- pedido devolve a mesma; e há intervalo mínimo de 10 min entre sincronizações.
--
-- Reversão:
--   select cron.unschedule('vigigen-sincronizar-manual')
--     where exists (select 1 from cron.job where jobname = 'vigigen-sincronizar-manual');
--   drop function public.sincronizar_fontes(), public.sincronizacao_estado(),
--     app.sincronizar_pedir(text, text), app.sincronizacao_avancar(), app.sincronizacao_json(bigint);
--   drop table app.sincronizacao;

create table if not exists app.sincronizacao (
  id            bigint generated always as identity primary key,
  pedido_em     timestamptz not null default now(),
  pedido_por    text not null,                 -- auth.uid() no painel web; 'conector:<usuário do banco>' no artefato
  origem        text not null check (origem in ('web', 'conector')),
  -- itens: [{tarefa, fonte, agravo, comando, estado, request_id, disparado_em,
  --          execucao_id, http_status, mensagem, finalizado_em}]
  -- estado: pendente | disparado | ok | vazio | erro
  itens         jsonb not null,
  indicadores_em timestamptz,
  concluida_em  timestamptz,
  mensagem      text
);
alter table app.sincronizacao enable row level security;   -- sem política: só funções definer leem
revoke all on table app.sincronizacao from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Avança a fila: dispara o que pode, confere respostas e execuções, fecha.
-- ---------------------------------------------------------------------------
create or replace function app.sincronizacao_avancar()
returns void language plpgsql security definer set search_path = '' as $$
declare
  s        app.sincronizacao%rowtype;
  it       jsonb;
  novos    jsonb;
  i        integer;
  resp     record;
  ex       record;
  req      bigint;
  ocupadas text[];
begin
  for s in select * from app.sincronizacao where concluida_em is null order by id for update skip locked loop
    novos := s.itens;

    -- 1. itens já disparados: resposta HTTP e execução correspondente
    for i in 0 .. jsonb_array_length(novos) - 1 loop
      it := novos -> i;
      continue when it->>'estado' <> 'disparado';

      select r.status_code, r.timed_out, r.error_msg, left(r.content, 300) as conteudo
        into resp from net._http_response r where r.id = (it->>'request_id')::bigint;

      -- a execução aberta pela função depois do disparo (mesma fonte; mesmo vírus, se houver)
      select e.id, e.status, e.registros, left(e.mensagem, 300) as mensagem, e.finalizado_em
        into ex from public.execucao_ingestao e
       where e.fonte = it->>'fonte'
         and e.iniciado_em >= (it->>'disparado_em')::timestamptz - interval '5 seconds'
         and (it->>'agravo' is null or coalesce(e.parametros->>'agravo', 'dengue') = it->>'agravo')
       order by e.id limit 1;

      if ex.id is not null then
        it := it || jsonb_build_object('execucao_id', ex.id);
        if ex.status <> 'em_andamento' then
          it := it || jsonb_build_object('estado', ex.status, 'registros', ex.registros,
                                         'mensagem', ex.mensagem, 'finalizado_em', coalesce(ex.finalizado_em, now()));
        end if;
      elsif resp.status_code = 409 then
        -- fonte ocupada por uma carga que começou depois do nosso pedido: volta para a fila
        it := it || jsonb_build_object('estado', 'pendente', 'request_id', null, 'disparado_em', null,
                                       'mensagem', 'fonte ocupada; aguardando a vez');
      elsif resp.timed_out or resp.error_msg is not null or resp.status_code >= 400 then
        it := it || jsonb_build_object('estado', 'erro', 'http_status', resp.status_code,
                                       'mensagem', coalesce(resp.error_msg, resp.conteudo, 'tempo esgotado'),
                                       'finalizado_em', now());
      elsif now() - (it->>'disparado_em')::timestamptz > interval '10 minutes' then
        it := it || jsonb_build_object('estado', 'erro', 'http_status', resp.status_code,
                                       'mensagem', 'a função não abriu execução em 10 minutos; resposta: ' || coalesce(resp.conteudo, 'nenhuma'),
                                       'finalizado_em', now());
      end if;
      novos := jsonb_set(novos, array[i::text], it);
    end loop;

    -- 2. dispara pendentes cuja fonte está livre (nada em andamento, nem desta fila)
    select coalesce(array_agg(distinct e.fonte), '{}') into ocupadas
      from public.execucao_ingestao e where e.status = 'em_andamento';
    select ocupadas || coalesce(array_agg(distinct x->>'fonte'), '{}') into ocupadas
      from jsonb_array_elements(novos) x where x->>'estado' = 'disparado';

    for i in 0 .. jsonb_array_length(novos) - 1 loop
      it := novos -> i;
      continue when it->>'estado' <> 'pendente' or (it->>'fonte') = any (ocupadas);
      execute it->>'comando' into req;
      it := it || jsonb_build_object('estado', 'disparado', 'request_id', req, 'disparado_em', now());
      ocupadas := ocupadas || (it->>'fonte');
      novos := jsonb_set(novos, array[i::text], it);
    end loop;

    update app.sincronizacao set itens = novos where id = s.id;

    -- 3. tudo terminado: recalcula indicadores e fecha
    if not exists (select 1 from jsonb_array_elements(novos) x where x->>'estado' in ('pendente', 'disparado')) then
      begin
        perform public.calcular_indicadores();
        update app.sincronizacao set indicadores_em = now(), concluida_em = now() where id = s.id;
      exception when others then
        update app.sincronizacao set concluida_em = now(),
               mensagem = 'cargas terminadas, mas o recálculo dos indicadores falhou: ' || left(sqlerrm, 300)
         where id = s.id;
      end;
      insert into public.auditoria (ator, acao, entidade, entidade_id, detalhe)
      values ('sql:sincronizacao_manual', 'concluir', 'sincronizacao', s.id::text,
              jsonb_build_object('itens', (select jsonb_agg(jsonb_build_object('tarefa', x->>'tarefa', 'estado', x->>'estado',
                                                                               'execucao_id', x->'execucao_id'))
                                           from jsonb_array_elements(novos) x)));
    elsif now() - s.pedido_em > interval '6 hours' then
      update app.sincronizacao set concluida_em = now(),
             mensagem = 'encerrada após 6 horas sem terminar; as cargas em andamento seguem pelo agendamento'
       where id = s.id;
    end if;
  end loop;

  if not exists (select 1 from app.sincronizacao where concluida_em is null)
     and exists (select 1 from cron.job where jobname = 'vigigen-sincronizar-manual') then
    perform cron.unschedule('vigigen-sincronizar-manual');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Estado legível de uma sincronização (a última, se p_id for nulo).
-- ---------------------------------------------------------------------------
create or replace function app.sincronizacao_json(p_id bigint default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when s.id is null then null else jsonb_build_object(
    'id', s.id, 'pedido_em', s.pedido_em, 'origem', s.origem,
    'concluida_em', s.concluida_em, 'indicadores_em', s.indicadores_em, 'mensagem', s.mensagem,
    'agora', now(),
    'itens', (select jsonb_agg(x - 'comando' - 'request_id' order by n) from jsonb_array_elements(s.itens) with ordinality t(x, n)))
  end
  from (select 1) um
  left join lateral (select * from app.sincronizacao
                      where (p_id is null or id = p_id) order by id desc limit 1) s on true;
$$;

-- ---------------------------------------------------------------------------
-- Pedido de sincronização.
-- ---------------------------------------------------------------------------
create or replace function app.sincronizar_pedir(p_origem text, p_por text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  aberta  app.sincronizacao%rowtype;
  itens   jsonb;
  novo_id bigint;
begin
  -- serializa pedidos simultâneos
  perform pg_advisory_xact_lock(hashtext('vigigen-sincronizacao-manual'));

  select * into aberta from app.sincronizacao where concluida_em is null order by id desc limit 1;
  if aberta.id is not null then
    return app.sincronizacao_json(aberta.id) || jsonb_build_object('aviso', 'já havia uma sincronização em andamento');
  end if;
  select * into aberta from app.sincronizacao
   where concluida_em > now() - interval '10 minutes' order by id desc limit 1;
  if aberta.id is not null then
    return app.sincronizacao_json(aberta.id)
           || jsonb_build_object('aviso', 'a última sincronização terminou há menos de 10 minutos');
  end if;

  select jsonb_agg(jsonb_build_object(
           'tarefa', j.jobname,
           'fonte', substring(j.command from 'ingest-([a-z]+)'),
           'agravo', substring(j.command from '"agravo":\s*"([a-z]+)"'),
           'comando', j.command,
           'estado', 'pendente') order by j.jobname)
    into itens
    from cron.job j
   where j.active
     and j.jobname ~ '^vigigen-(semanal|diario|mensal)-'
     and j.command ~ 'app\.disparar\(''ingest-[a-z]+'''
     and j.jobname <> 'vigigen-sincronizar-manual';

  if itens is null then
    raise exception 'nenhuma carga agendada encontrada em cron.job' using errcode = 'P0002';
  end if;

  insert into app.sincronizacao (pedido_por, origem, itens) values (p_por, p_origem, itens)
  returning id into novo_id;
  insert into public.auditoria (ator, acao, entidade, entidade_id, detalhe)
  values (case when p_origem = 'web' then 'usuario:' || p_por else p_por end,
          'pedir', 'sincronizacao', novo_id::text,
          jsonb_build_object('origem', p_origem, 'tarefas', (select jsonb_agg(x->>'tarefa') from jsonb_array_elements(itens) x)));

  perform cron.schedule('vigigen-sincronizar-manual', '* * * * *', 'select app.sincronizacao_avancar()');
  perform app.sincronizacao_avancar();          -- primeiros disparos já, sem esperar o minuto
  return app.sincronizacao_json(novo_id);
end;
$$;

revoke all on function app.sincronizacao_avancar() from public, anon, authenticated;
revoke all on function app.sincronizacao_json(bigint) from public, anon, authenticated;
revoke all on function app.sincronizar_pedir(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Entradas do painel web (supabase-js, sessão autenticada): só administrador.
-- ---------------------------------------------------------------------------
create or replace function public.sincronizar_fontes()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app.exigir_admin();
  return app.sincronizar_pedir('web', (select auth.uid())::text);
end;
$$;

create or replace function public.sincronizacao_estado()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.exigir_admin();
  return app.sincronizacao_json(null);
end;
$$;

revoke all on function public.sincronizar_fontes() from public, anon;
revoke all on function public.sincronizacao_estado() from public, anon;
grant execute on function public.sincronizar_fontes() to authenticated;
grant execute on function public.sincronizacao_estado() to authenticated;
