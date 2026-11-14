-- VigiGen — 011: administração do sistema.
-- Perfis e convites (cadastro fechado), trilha de uso do site (login, cliques,
-- navegação, erros, com IP e navegador), SLA de atualização dos dados e
-- alertas do sistema. Tudo que é administrativo só é lido por administrador,
-- e isso é garantido no banco (RLS + funções que conferem o papel).
--
-- Acesso por código de uso único, sem depender de e-mail: o administrador
-- convida um e-mail e recebe um código; a pessoa abre o site, informa e-mail,
-- código e a senha que ela mesma escolhe. A Edge Function `acesso` confere o
-- código (public.liberar_convite) e cria a conta com a service role. O mesmo
-- fluxo redefine senha esquecida. Só o hash do código fica no banco.
--
-- O primeiro administrador NÃO está aqui: o convite dele é criado à parte com
-- app.novo_convite(...), para que nenhum e-mail pessoal fique versionado
-- (regra 4 do CLAUDE.md). Nenhuma senha passa pelo banco nem pelo código.
--
-- Aplicado no projeto em partes (011a a 011i em supabase_migrations), porque o
-- conector recusa lotes grandes; o conteúdo é o deste arquivo.

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table public.perfil (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  email          text not null,
  nome           text,
  administrador  boolean not null default false,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- Só entra quem foi convidado. O convite já diz o perfil que a pessoa terá.
-- tipo 'redefinicao' reaproveita a tabela para trocar a senha de quem esqueceu.
create table public.convite (
  email           text primary key check (email = lower(btrim(email)) and email like '%_@_%'),
  tipo            text not null default 'cadastro' check (tipo in ('cadastro','redefinicao')),
  nome            text,
  administrador   boolean not null default false,
  organizacao_id  uuid references public.organizacao(id) on delete set null,
  papel           text check (papel in ('gestor','vigilancia','laboratorio','leitura')),
  codigo_hash     text not null,
  tentativas      integer not null default 0,
  criado_por      uuid references auth.users(id) on delete set null,
  criado_em       timestamptz not null default now(),
  expira_em       timestamptz not null default now() + interval '7 days',
  liberado_em     timestamptz,
  usado_em        timestamptz,
  check ((organizacao_id is null) = (papel is null))
);

-- Trilha de uso do site. Append-only, como public.auditoria.
create table public.evento_uso (
  id           bigint generated always as identity primary key,
  ocorrido_em  timestamptz not null default now(),
  user_id      uuid references auth.users(id) on delete set null,
  email        text,
  sessao       text,
  tipo         text not null check (tipo in ('sessao','login','login_falha','logout','navegacao','clique','acao','erro')),
  alvo         text,
  rota         text,
  detalhe      jsonb not null default '{}'::jsonb,
  ip           text,
  pais         text,
  user_agent   text
);
create index on public.evento_uso (ocorrido_em desc);
create index on public.evento_uso (user_id, ocorrido_em desc);
create index on public.evento_uso (tipo, ocorrido_em desc);

create trigger evento_uso_sem_update_delete
  before update or delete on public.evento_uso
  for each row execute function app.auditoria_append_only();
create trigger evento_uso_sem_truncate
  before truncate on public.evento_uso
  for each statement execute function app.auditoria_append_only();

alter table public.perfil     enable row level security;
alter table public.convite    enable row level security;
alter table public.evento_uso enable row level security;

-- ---------------------------------------------------------------------------
-- Papel de administrador
-- ---------------------------------------------------------------------------
create or replace function app.eh_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfil p
                 where p.user_id = (select auth.uid()) and p.administrador and p.ativo);
$$;
grant execute on function app.eh_admin() to authenticated;

create or replace function app.exigir_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.eh_admin() then
    raise exception 'apenas administradores' using errcode = '42501';
  end if;
end;
$$;

-- Administrador enxerga todo o território (sem precisar de organização).
create or replace function app.pode_ver_geocodigo(g integer)
returns boolean
language sql stable security definer set search_path = '' as $$
  select app.eh_admin() or exists (
    select 1
    from public.usuario_organizacao uo
    join public.organizacao o on o.id = uo.organizacao_id
    join public.perfil p on p.user_id = uo.user_id and p.ativo
    where uo.user_id = (select auth.uid())
      and (
        o.tipo in ('estado','laboratorio')
        or (o.tipo = 'municipio' and g is not null and o.geocodigo_ibge = g)
      )
  );
$$;

-- RLS das tabelas novas: leitura do próprio perfil ou de tudo, se admin.
-- Nenhuma escrita direta: tudo passa pelas funções abaixo.
create policy perfil_leitura on public.perfil
  for select to authenticated using (user_id = (select auth.uid()) or app.eh_admin());
-- convite: nenhuma leitura direta (tem hash de código); só por admin_usuarios().
create policy evento_uso_leitura on public.evento_uso
  for select to authenticated using (app.eh_admin());

revoke all on public.perfil, public.convite, public.evento_uso from anon, authenticated;
grant select on public.perfil, public.evento_uso to authenticated;

-- ---------------------------------------------------------------------------
-- Convites e códigos de uso único
-- ---------------------------------------------------------------------------
create or replace function app.novo_convite(
  p_email text, p_nome text, p_administrador boolean, p_organizacao_id uuid, p_papel text,
  p_tipo text default 'cadastro', p_criado_por uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  codigo text := upper(encode(extensions.gen_random_bytes(6), 'hex'));   -- 12 caracteres, 48 bits
begin
  insert into public.convite (email, tipo, nome, administrador, organizacao_id, papel, codigo_hash, criado_por)
  values (lower(btrim(p_email)), p_tipo, nullif(btrim(p_nome), ''), coalesce(p_administrador, false),
          p_organizacao_id, p_papel, encode(extensions.digest(codigo, 'sha256'), 'hex'), p_criado_por)
  on conflict (email) do update
    set tipo = excluded.tipo, nome = excluded.nome, administrador = excluded.administrador,
        organizacao_id = excluded.organizacao_id, papel = excluded.papel, codigo_hash = excluded.codigo_hash,
        tentativas = 0, criado_por = excluded.criado_por, criado_em = now(),
        expira_em = now() + interval '7 days', liberado_em = null, usado_em = null;
  insert into public.auditoria (ator, acao, entidade, entidade_id, detalhe)
  values (coalesce(p_criado_por::text, current_user), 'convite.' || p_tipo, 'convite', lower(btrim(p_email)),
          jsonb_build_object('administrador', p_administrador, 'organizacao_id', p_organizacao_id, 'papel', p_papel));
  return substr(codigo, 1, 4) || '-' || substr(codigo, 5, 4) || '-' || substr(codigo, 9, 4);
end;
$$;
revoke all on function app.novo_convite(text, text, boolean, uuid, text, text, uuid) from public, anon, authenticated;

-- Chamada só pela Edge Function `acesso` (service role). Confere o código,
-- conta tentativas (10 erros bloqueiam o convite) e libera por 2 minutos.
create or replace function public.liberar_convite(p_email text, p_codigo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.convite; uid uuid;
begin
  select * into c from public.convite where email = lower(btrim(p_email)) for update;
  if not found or c.usado_em is not null or c.expira_em < now() or c.tentativas >= 10 then
    return jsonb_build_object('ok', false, 'motivo', 'convite inexistente, usado, expirado ou bloqueado');
  end if;
  if c.codigo_hash <> encode(extensions.digest(upper(regexp_replace(p_codigo, '[^0-9A-Fa-f]', '', 'g')), 'sha256'), 'hex') then
    update public.convite set tentativas = tentativas + 1 where email = c.email;
    return jsonb_build_object('ok', false, 'motivo', 'código incorreto');
  end if;
  update public.convite set liberado_em = now() where email = c.email;
  if c.tipo = 'redefinicao' then
    select id into uid from auth.users where lower(email) = c.email;
  end if;
  return jsonb_build_object('ok', true, 'tipo', c.tipo, 'user_id', uid);
end;
$$;

-- Fecha a redefinição de senha (o cadastro é fechado pelo gatilho de auth.users).
create or replace function public.concluir_convite(p_email text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.convite set usado_em = now() where email = lower(btrim(p_email)) and usado_em is null;
  insert into public.auditoria (ator, acao, entidade, entidade_id, detalhe)
  values ('edge:acesso', 'senha.redefinida', 'convite', lower(btrim(p_email)), '{}'::jsonb);
end;
$$;
revoke all on function public.liberar_convite(text, text) from public, anon, authenticated;
revoke all on function public.concluir_convite(text) from public, anon, authenticated;
grant execute on function public.liberar_convite(text, text) to service_role;
grant execute on function public.concluir_convite(text) to service_role;

-- ---------------------------------------------------------------------------
-- Cadastro fechado: auth.users só aceita e-mail com convite de cadastro
-- liberado há menos de 2 minutos pela Edge Function `acesso` (que conferiu o
-- código). Isso vale também para o /signup público do Auth. Depois da
-- inserção, cria o perfil e o vínculo com a organização.
-- ---------------------------------------------------------------------------
create or replace function app.usuario_antes_de_criar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null or not exists (
       select 1 from public.convite c
       where c.email = lower(new.email) and c.tipo = 'cadastro' and c.usado_em is null
         and c.liberado_em > now() - interval '2 minutes') then
    raise exception 'cadastro fechado: este e-mail não tem convite liberado no VigiGen' using errcode = '42501';
  end if;
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end;
$$;

create or replace function app.usuario_depois_de_criar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.convite;
begin
  select * into c from public.convite where email = lower(new.email);
  insert into public.perfil (user_id, email, nome, administrador)
  values (new.id, lower(new.email), c.nome, coalesce(c.administrador, false))
  on conflict (user_id) do nothing;
  if c.organizacao_id is not null then
    insert into public.usuario_organizacao (user_id, organizacao_id, papel)
    values (new.id, c.organizacao_id, c.papel) on conflict do nothing;
  end if;
  update public.convite set usado_em = now() where email = lower(new.email);
  insert into public.auditoria (ator, acao, entidade, entidade_id, detalhe)
  values ('edge:acesso', 'usuario.criado', 'perfil', new.id::text,
          jsonb_build_object('administrador', coalesce(c.administrador, false),
                             'organizacao_id', c.organizacao_id, 'papel', c.papel));
  return new;
end;
$$;

create trigger vigigen_convite_obrigatorio
  before insert on auth.users
  for each row execute function app.usuario_antes_de_criar();
create trigger vigigen_cria_perfil
  after insert on auth.users
  for each row execute function app.usuario_depois_de_criar();

-- ---------------------------------------------------------------------------
-- Registro de eventos de uso (chamado pelo site).
-- IP, país e navegador vêm dos cabeçalhos da própria requisição, não do cliente.
-- Anônimo só registra tentativa de login que falhou.
-- ---------------------------------------------------------------------------
create or replace function app.cabecalho(nome text)
returns text language sql stable set search_path = '' as $$
  select nullif(btrim(coalesce(current_setting('request.headers', true), '{}')::json ->> nome), '');
$$;

create or replace function public.registrar_eventos(p_eventos jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  mail text;
  ip text := coalesce(app.cabecalho('cf-connecting-ip'), app.cabecalho('x-real-ip'),
                      btrim(split_part(app.cabecalho('x-forwarded-for'), ',', 1)));
  pais text := app.cabecalho('cf-ipcountry');
  ua text := left(app.cabecalho('user-agent'), 400);
  e jsonb;
  n integer := 0;
begin
  if jsonb_typeof(p_eventos) <> 'array' or jsonb_array_length(p_eventos) > 100 then
    raise exception 'esperado um array de até 100 eventos';
  end if;
  if uid is not null then
    select email into mail from public.perfil where user_id = uid;
  end if;
  for e in select * from jsonb_array_elements(p_eventos) loop
    continue when coalesce(e ->> 'tipo', '') not in ('sessao','login','login_falha','logout','navegacao','clique','acao','erro');
    continue when uid is null and (e ->> 'tipo') <> 'login_falha';
    continue when length(coalesce(e ->> 'detalhe', '')) > 4000;
    insert into public.evento_uso (ocorrido_em, user_id, email, sessao, tipo, alvo, rota, detalhe, ip, pais, user_agent)
    values (
      -- o relógio do cliente só é aceito se estiver a menos de 10 min do servidor
      case when (e ->> 'em') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$'
           then case when abs(extract(epoch from now() - (e ->> 'em')::timestamptz)) < 600
                     then (e ->> 'em')::timestamptz else now() end
           else now() end,
      uid,
      coalesce(mail, case when uid is null then lower(left(e ->> 'email', 200)) end),
      left(e ->> 'sessao', 64), e ->> 'tipo', left(e ->> 'alvo', 200), left(e ->> 'rota', 200),
      coalesce(e -> 'detalhe', '{}'::jsonb), ip, pais, ua);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.registrar_eventos(jsonb) from public;
grant execute on function public.registrar_eventos(jsonb) to anon, authenticated;

-- Quem sou eu (o site usa para decidir se mostra o menu Administração).
create or replace function public.meu_perfil()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', p.user_id, 'email', p.email, 'nome', p.nome,
    'administrador', p.administrador, 'ativo', p.ativo,
    'vinculos', coalesce((select jsonb_agg(jsonb_build_object('papel', uo.papel, 'organizacao', o.nome, 'tipo', o.tipo))
                          from public.usuario_organizacao uo join public.organizacao o on o.id = uo.organizacao_id
                          where uo.user_id = p.user_id), '[]'::jsonb))
  from public.perfil p where p.user_id = (select auth.uid());
$$;
revoke all on function public.meu_perfil() from public, anon;
grant execute on function public.meu_perfil() to authenticated;

-- ---------------------------------------------------------------------------
-- Administração: auditoria
-- ---------------------------------------------------------------------------
create or replace function public.admin_eventos(
  p_desde timestamptz default now() - interval '7 days',
  p_ate timestamptz default now(),
  p_tipo text default null,
  p_user_id uuid default null,
  p_busca text default null,
  p_limite integer default 500)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.exigir_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.ocorrido_em desc) from (
      select e.id, e.ocorrido_em, e.user_id, e.email, e.sessao, e.tipo, e.alvo, e.rota,
             e.detalhe, e.ip, e.pais, e.user_agent
      from public.evento_uso e
      where e.ocorrido_em >= p_desde and e.ocorrido_em <= p_ate
        and (p_tipo is null or e.tipo = p_tipo)
        and (p_user_id is null or e.user_id = p_user_id)
        and (p_busca is null or concat_ws(' ', e.email, e.alvo, e.rota, e.ip) ilike '%' || p_busca || '%')
      order by e.ocorrido_em desc
      limit least(greatest(p_limite, 1), 5000)) t), '[]'::jsonb);
end;
$$;

create or replace function public.admin_resumo_uso(p_dias integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare desde timestamptz := now() - make_interval(days => least(greatest(p_dias, 1), 365));
begin
  perform app.exigir_admin();
  return jsonb_build_object(
    'desde', desde, 'ate', now(),
    'por_tipo', (select coalesce(jsonb_object_agg(tipo, n), '{}'::jsonb)
                 from (select tipo, count(*) n from public.evento_uso where ocorrido_em >= desde group by tipo) x),
    'usuarios_distintos', (select count(distinct user_id) from public.evento_uso where ocorrido_em >= desde),
    'sessoes', (select count(distinct sessao) from public.evento_uso where ocorrido_em >= desde),
    'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'eventos', n, 'usuarios', u) order by dia), '[]'::jsonb)
                from (select (ocorrido_em at time zone 'America/Fortaleza')::date dia, count(*) n, count(distinct user_id) u
                      from public.evento_uso where ocorrido_em >= desde group by 1) x),
    'top_alvos', (select coalesce(jsonb_agg(jsonb_build_object('alvo', alvo, 'n', n) order by n desc), '[]'::jsonb)
                  from (select alvo, count(*) n from public.evento_uso
                        where ocorrido_em >= desde and tipo in ('clique','acao','navegacao') and alvo is not null
                        group by alvo order by n desc limit 15) x),
    'top_usuarios', (select coalesce(jsonb_agg(jsonb_build_object('email', email, 'n', n, 'ultimo', ultimo) order by n desc), '[]'::jsonb)
                     from (select email, count(*) n, max(ocorrido_em) ultimo from public.evento_uso
                           where ocorrido_em >= desde and user_id is not null
                           group by email order by n desc limit 15) x),
    -- trilha de dados (cargas, cálculos, revisões, mudanças de usuário)
    'trilha_dados', (select coalesce(jsonb_agg(to_jsonb(a) order by a.ocorrido_em desc), '[]'::jsonb)
                     from (select * from public.auditoria where ocorrido_em >= desde
                           order by ocorrido_em desc limit 200) a));
end;
$$;

-- ---------------------------------------------------------------------------
-- Administração: usuários e perfis
-- ---------------------------------------------------------------------------
create or replace function public.admin_usuarios()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.exigir_admin();
  return jsonb_build_object(
    'usuarios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', p.user_id, 'email', p.email, 'nome', p.nome,
        'administrador', p.administrador, 'ativo', p.ativo,
        'criado_em', p.criado_em, 'atualizado_em', p.atualizado_em,
        'ultimo_login', u.last_sign_in_at,
        'ultimo_evento', (select max(ocorrido_em) from public.evento_uso e where e.user_id = p.user_id),
        'ultimo_ip', (select e.ip from public.evento_uso e where e.user_id = p.user_id and e.ip is not null
                      order by e.ocorrido_em desc limit 1),
        'vinculos', coalesce((select jsonb_agg(jsonb_build_object('organizacao_id', o.id, 'organizacao', o.nome,
                                                                  'tipo', o.tipo, 'papel', uo.papel))
                              from public.usuario_organizacao uo join public.organizacao o on o.id = uo.organizacao_id
                              where uo.user_id = p.user_id), '[]'::jsonb)
      ) order by p.email)
      from public.perfil p join auth.users u on u.id = p.user_id), '[]'::jsonb),
    'convites', coalesce((
      select jsonb_agg(jsonb_build_object('email', c.email, 'tipo', c.tipo, 'nome', c.nome, 'administrador', c.administrador,
                                          'organizacao', o.nome, 'papel', c.papel, 'tentativas', c.tentativas,
                                          'criado_em', c.criado_em, 'expira_em', c.expira_em, 'usado_em', c.usado_em)
                       order by c.criado_em desc)
      from public.convite c left join public.organizacao o on o.id = c.organizacao_id), '[]'::jsonb),
    'organizacoes', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.nome, 'tipo', o.tipo, 'geocodigo', o.geocodigo_ibge)
                       order by o.tipo, o.nome)
      from public.organizacao o), '[]'::jsonb));
end;
$$;

create or replace function public.admin_salvar_usuario(
  p_user_id uuid, p_nome text, p_administrador boolean, p_ativo boolean,
  p_organizacao_id uuid default null, p_papel text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare antes public.perfil;
begin
  perform app.exigir_admin();
  select * into antes from public.perfil where user_id = p_user_id;
  if not found then raise exception 'usuário não encontrado'; end if;
  if p_user_id = auth.uid() and (not p_administrador or not p_ativo) then
    raise exception 'você não pode remover o seu próprio acesso de administrador';
  end if;
  if (p_organizacao_id is null) <> (p_papel is null) then
    raise exception 'organização e papel vão juntos';
  end if;

  update public.perfil
     set nome = nullif(btrim(p_nome), ''), administrador = p_administrador, ativo = p_ativo, atualizado_em = now()
   where user_id = p_user_id;
  -- conta desativada não entra mais (o Auth recusa o login), reativada volta a entrar
  update auth.users set banned_until = case when p_ativo then null else now() + interval '100 years' end
   where id = p_user_id;
  -- um vínculo por pessoa nesta fase
  delete from public.usuario_organizacao where user_id = p_user_id;
  if p_organizacao_id is not null then
    insert into public.usuario_organizacao (user_id, organizacao_id, papel) values (p_user_id, p_organizacao_id, p_papel);
  end if;

  insert into public.auditoria (ator, acao, entidade, entidade_id, detalhe)
  values (auth.uid()::text, 'usuario.atualizado', 'perfil', p_user_id::text,
          jsonb_build_object('de', jsonb_build_object('nome', antes.nome, 'administrador', antes.administrador, 'ativo', antes.ativo),
                             'para', jsonb_build_object('nome', p_nome, 'administrador', p_administrador, 'ativo', p_ativo,
                                                        'organizacao_id', p_organizacao_id, 'papel', p_papel)));
end;
$$;

-- Devolve o código de uso único UMA vez; só o hash fica guardado.
create or replace function public.admin_convidar(
  p_email text, p_nome text default null, p_administrador boolean default false,
  p_organizacao_id uuid default null, p_papel text default null)
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform app.exigir_admin();
  if exists (select 1 from auth.users where lower(email) = lower(btrim(p_email))) then
    raise exception 'este e-mail já tem conta; para trocar a senha, gere um código de redefinição';
  end if;
  return app.novo_convite(p_email, p_nome, p_administrador, p_organizacao_id, p_papel, 'cadastro', auth.uid());
end;
$$;

create or replace function public.admin_codigo_redefinicao(p_user_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare p public.perfil;
begin
  perform app.exigir_admin();
  select * into p from public.perfil where user_id = p_user_id;
  if not found then raise exception 'usuário não encontrado'; end if;
  return app.novo_convite(p.email, p.nome, p.administrador, null, null, 'redefinicao', auth.uid());
end;
$$;

create or replace function public.admin_revogar_convite(p_email text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.exigir_admin();
  -- convite usado vira histórico; o pendente expira agora
  update public.convite set expira_em = now() where email = lower(btrim(p_email)) and usado_em is null;
  insert into public.auditoria (ator, acao, entidade, entidade_id, detalhe)
  values (auth.uid()::text, 'convite.revogado', 'convite', lower(btrim(p_email)), '{}'::jsonb);
end;
$$;

create or replace function public.admin_criar_organizacao(p_nome text, p_tipo text, p_geocodigo integer default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare novo uuid;
begin
  perform app.exigir_admin();
  insert into public.organizacao (nome, tipo, geocodigo_ibge) values (btrim(p_nome), p_tipo, p_geocodigo)
  returning id into novo;
  insert into public.auditoria (ator, acao, entidade, entidade_id, detalhe)
  values (auth.uid()::text, 'organizacao.criada', 'organizacao', novo::text,
          jsonb_build_object('nome', p_nome, 'tipo', p_tipo, 'geocodigo', p_geocodigo));
  return novo;
end;
$$;

-- ---------------------------------------------------------------------------
-- SLA de atualização dos dados.
-- Meta = maior intervalo da agenda do pg_cron (006_agendamento.sql) + tolerância
-- de 24 h (indicadores: 6 h + 1 h). Ver D-014 em docs/DECISIONS.md.
-- "vazio" conta como sucesso: a fonte respondeu e não havia registro novo.
-- Cumprimento = % das horas dos últimos 30 dias em que o dado estava dentro da
-- meta, contando a partir da primeira atualização bem-sucedida.
-- ---------------------------------------------------------------------------
create or replace function app.sla_metas()
returns table (fonte text, rotulo text, agenda text, meta interval)
language sql immutable set search_path = '' as $$
  values ('infodengue', 'Casos semanais (InfoDengue)', 'seg e qui, 09h UTC', interval '4 days' + interval '24 hours'),
         ('genbank',    'Sequências (GenBank)',        'ter, 10h UTC',        interval '7 days' + interval '24 hours'),
         ('ibge',       'Malha municipal (IBGE)',      'dia 1, 08h UTC',      interval '31 days' + interval '24 hours'),
         ('indicadores','Indicadores calculados',      'a cada 6 h',          interval '7 hours'),
         ('nextclade',  'Classificação Nextclade',     'ter (GitHub Actions)', interval '7 days' + interval '24 hours');
$$;

create or replace function app.sla_sucessos()
returns table (fonte text, em timestamptz)
language sql stable security definer set search_path = '' as $$
  select fonte, finalizado_em from public.execucao_ingestao where status in ('ok','vazio') and finalizado_em is not null
  union all
  select 'indicadores', ocorrido_em from public.auditoria where ator = 'sql:calcular_indicadores'
  union all
  select 'nextclade', ocorrido_em from public.auditoria where ator = 'pipeline:nextclade';
$$;

create or replace function public.admin_sla()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.exigir_admin();
  return jsonb_build_object(
    'calculado_em', now(),
    'fontes', (
      select jsonb_agg(jsonb_build_object(
        'fonte', m.fonte, 'rotulo', m.rotulo, 'agenda', m.agenda,
        'meta_horas', extract(epoch from m.meta) / 3600,
        'ultima_ok', u.ultima,
        'idade_horas', round((extract(epoch from now() - u.ultima) / 3600)::numeric, 1),
        'dentro', u.ultima is not null and now() - u.ultima <= m.meta,
        'ultima_falha', f.em, 'ultima_falha_msg', f.msg,
        'cumprimento_30d', c.pct, 'horas_medidas_30d', c.horas
      ) order by m.fonte)
      from app.sla_metas() m
      left join lateral (select max(s.em) ultima from app.sla_sucessos() s where s.fonte = m.fonte) u on true
      left join lateral (select e.finalizado_em em, left(e.mensagem, 300) msg from public.execucao_ingestao e
                         where e.fonte = m.fonte and e.status = 'erro' order by e.id desc limit 1) f on true
      left join lateral (
        select round(100.0 * count(*) filter (where ok) / nullif(count(*), 0), 1) pct, count(*) horas
        from (select h, exists (select 1 from app.sla_sucessos() s
                                where s.fonte = m.fonte and s.em <= h and s.em > h - m.meta) ok
              from generate_series(date_trunc('hour', now()) - interval '30 days', date_trunc('hour', now()), interval '1 hour') h
              where h >= (select min(s.em) from app.sla_sucessos() s where s.fonte = m.fonte)) x
      ) c on true),
    'agendador', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'tarefa', j.jobname, 'agenda', j.schedule, 'ativa', j.active,
        'execucoes_7d', r.n, 'falhas_7d', r.falhas, 'ultima', r.ultima, 'ultimo_status', r.ultimo_status,
        'ultimo_erro', r.ultimo_erro) order by j.jobname), '[]'::jsonb)
      from cron.job j
      left join lateral (
        select count(*) n, count(*) filter (where d.status = 'failed') falhas, max(d.start_time) ultima,
               (array_agg(d.status order by d.start_time desc))[1] ultimo_status,
               (array_agg(left(d.return_message, 300) order by d.start_time desc) filter (where d.status = 'failed'))[1] ultimo_erro
        from cron.job_run_details d where d.jobid = j.jobid and d.start_time >= now() - interval '7 days') r on true
      where j.jobname like 'vigigen-%'),
    'revisao_alertas', (
      select jsonb_build_object(
        'pendentes', count(*) filter (where status in ('novo','em_analise')),
        'pendente_mais_antigo', min(criado_em) filter (where status in ('novo','em_analise')),
        'mediana_horas_revisao', round((percentile_cont(0.5) within group (
             order by extract(epoch from revisado_em - criado_em) / 3600)
             filter (where revisado_em is not null))::numeric, 1))
      from public.alerta));
end;
$$;

-- ---------------------------------------------------------------------------
-- Alertas do sistema: calculados na hora, a partir do que o banco registra.
-- ---------------------------------------------------------------------------
create or replace function public.admin_alertas_sistema()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.exigir_admin();
  return coalesce((select jsonb_agg(a order by (a ->> 'gravidade') = 'critico' desc, (a ->> 'desde') desc nulls last) from (
    -- SLA estourado
    select jsonb_build_object('gravidade', 'critico', 'origem', 'sla', 'titulo', 'Atualização atrasada: ' || m.rotulo,
             'detalhe', case when u.ultima is null then 'Nenhuma atualização bem-sucedida registrada.'
                             else 'Última atualização bem-sucedida há ' || round(extract(epoch from now() - u.ultima) / 3600) ||
                                  ' h; meta de ' || extract(epoch from m.meta) / 3600 || ' h.' end,
             'desde', u.ultima + m.meta) a
    from app.sla_metas() m
    left join lateral (select max(s.em) ultima from app.sla_sucessos() s where s.fonte = m.fonte) u on true
    where u.ultima is null or now() - u.ultima > m.meta
    union all
    -- ingestão com erro nos últimos 30 dias
    select jsonb_build_object('gravidade', 'aviso', 'origem', 'ingestao', 'titulo', 'Ingestão com erro: ' || e.fonte,
             'detalhe', left(coalesce(e.mensagem, 'sem mensagem'), 400), 'desde', e.finalizado_em, 'ref', e.id)
    from public.execucao_ingestao e
    where e.status = 'erro' and e.iniciado_em >= now() - interval '30 days'
    union all
    -- carga parada em andamento há mais de 2 h
    select jsonb_build_object('gravidade', 'aviso', 'origem', 'ingestao', 'titulo', 'Carga parada: ' || e.fonte,
             'detalhe', 'Em andamento desde ' || to_char(e.iniciado_em at time zone 'America/Fortaleza', 'DD/MM/YYYY HH24:MI'),
             'desde', e.iniciado_em, 'ref', e.id)
    from public.execucao_ingestao e
    where e.status = 'em_andamento' and e.iniciado_em < now() - interval '2 hours'
    union all
    -- tarefas do agendador que falharam nas últimas 24 h
    select jsonb_build_object('gravidade', 'aviso', 'origem', 'agendador', 'titulo', 'Tarefa agendada falhou: ' || j.jobname,
             'detalhe', count(*) || ' falha(s) em 24 h. Última: ' || left((array_agg(d.return_message order by d.start_time desc))[1], 300),
             'desde', max(d.start_time))
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where d.status = 'failed' and d.start_time >= now() - interval '24 hours' and j.jobname like 'vigigen-%'
    group by j.jobname
    union all
    -- tentativas de login que falharam (5 ou mais na última hora, por e-mail ou IP)
    select jsonb_build_object('gravidade', 'critico', 'origem', 'acesso', 'titulo', 'Tentativas de login falhas',
             'detalhe', count(*) || ' tentativas na última hora para ' || coalesce(email, 'e-mail não informado') ||
                        ' a partir de ' || coalesce(ip, 'IP desconhecido'),
             'desde', min(ocorrido_em))
    from public.evento_uso
    where tipo = 'login_falha' and ocorrido_em >= now() - interval '1 hour'
    group by email, ip having count(*) >= 5
    union all
    -- erros do site nas últimas 24 h
    select jsonb_build_object('gravidade', 'aviso', 'origem', 'site', 'titulo', 'Erros no site',
             'detalhe', count(*) || ' erro(s) em 24 h. Último: ' || left((array_agg(alvo order by ocorrido_em desc))[1], 200),
             'desde', max(ocorrido_em))
    from public.evento_uso where tipo = 'erro' and ocorrido_em >= now() - interval '24 hours'
    having count(*) > 0
    union all
    -- alertas epidemiológicos sem revisão há mais de 7 dias
    select jsonb_build_object('gravidade', 'aviso', 'origem', 'revisao', 'titulo', 'Alertas aguardando revisão',
             'detalhe', count(*) || ' alerta(s) novo(s) há mais de 7 dias sem revisão humana.',
             'desde', min(criado_em))
    from public.alerta where status = 'novo' and criado_em < now() - interval '7 days'
    having count(*) > 0
    union all
    -- convites pendentes há mais de 14 dias
    select jsonb_build_object('gravidade', 'info', 'origem', 'usuarios', 'titulo', 'Convites expirados sem uso',
             'detalhe', count(*) || ' convite(s) expiraram sem uso nos últimos 30 dias.', 'desde', min(criado_em))
    from public.convite where usado_em is null and expira_em < now() and expira_em > now() - interval '30 days'
    having count(*) > 0
  ) t(a)), '[]'::jsonb);
end;
$$;

-- Permissões das funções de administração: só autenticados chamam, e cada
-- uma confere app.eh_admin() antes de qualquer leitura ou escrita.
do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_eventos(timestamptz, timestamptz, text, uuid, text, integer)',
    'public.admin_resumo_uso(integer)',
    'public.admin_usuarios()',
    'public.admin_salvar_usuario(uuid, text, boolean, boolean, uuid, text)',
    'public.admin_convidar(text, text, boolean, uuid, text)',
    'public.admin_revogar_convite(text)',
    'public.admin_codigo_redefinicao(uuid)',
    'public.admin_criar_organizacao(text, text, integer)',
    'public.admin_sla()',
    'public.admin_alertas_sistema()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
revoke all on function app.exigir_admin() from public, anon;
grant execute on function app.exigir_admin() to authenticated;
revoke all on function app.sla_sucessos() from public, anon, authenticated;
revoke all on function app.usuario_antes_de_criar() from public, anon, authenticated;
revoke all on function app.usuario_depois_de_criar() from public, anon, authenticated;
