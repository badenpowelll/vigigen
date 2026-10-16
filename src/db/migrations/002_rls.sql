-- VigiGen — 002: Row Level Security
-- Isolamento por município garantido NO BANCO, não na aplicação.
-- Escritas de ingestão usam a service role (fora do RLS); usuários só leem,
-- exceto UPDATE de status de alerta por vigilancia/laboratorio.

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated;

-- O usuário pode ver dados deste geocódigo?
-- estado/laboratorio: todos os municípios da UF (e linhas sem município).
-- municipio: apenas o próprio geocódigo.
create or replace function app.pode_ver_geocodigo(g integer)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.usuario_organizacao uo
    join public.organizacao o on o.id = uo.organizacao_id
    where uo.user_id = (select auth.uid())
      and (
        o.tipo in ('estado','laboratorio')
        or (o.tipo = 'municipio' and g is not null and o.geocodigo_ibge = g)
      )
  );
$$;

-- O usuário tem algum destes papéis numa organização que enxerga g?
create or replace function app.tem_papel_no_territorio(g integer, papeis text[])
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.usuario_organizacao uo
    join public.organizacao o on o.id = uo.organizacao_id
    where uo.user_id = (select auth.uid())
      and uo.papel = any (papeis)
      and (
        o.tipo in ('estado','laboratorio')
        or (o.tipo = 'municipio' and g is not null and o.geocodigo_ibge = g)
      )
  );
$$;

grant execute on function app.pode_ver_geocodigo(integer) to authenticated;
grant execute on function app.tem_papel_no_territorio(integer, text[]) to authenticated;

-- Habilita RLS em tudo
alter table public.bruto               enable row level security;
alter table public.execucao_ingestao   enable row level security;
alter table public.municipio           enable row level security;
alter table public.organizacao         enable row level security;
alter table public.usuario_organizacao enable row level security;
alter table public.caso_semanal        enable row level security;
alter table public.sequencia           enable row level security;
alter table public.classificacao       enable row level security;
alter table public.exclusao_qc         enable row level security;
alter table public.indicador           enable row level security;
alter table public.alerta              enable row level security;
alter table public.auditoria           enable row level security;

-- Território: a malha e os nomes são públicos (IBGE) e necessários ao mapa.
create policy municipio_leitura on public.municipio
  for select to authenticated using (true);

-- Execuções de ingestão: todos os autenticados veem quando cada fonte foi atualizada.
create policy execucao_leitura on public.execucao_ingestao
  for select to authenticated using (true);

-- Respostas brutas: só estado/laboratório.
create policy bruto_leitura on public.bruto
  for select to authenticated using (app.pode_ver_geocodigo(null));

-- Organização e vínculo: o usuário vê apenas os seus.
create policy organizacao_propria on public.organizacao
  for select to authenticated using (
    exists (select 1 from public.usuario_organizacao uo
            where uo.organizacao_id = organizacao.id and uo.user_id = (select auth.uid())));
create policy vinculo_proprio on public.usuario_organizacao
  for select to authenticated using (user_id = (select auth.uid()));

-- Recorte territorial
create policy caso_semanal_territorio on public.caso_semanal
  for select to authenticated using (app.pode_ver_geocodigo(geocodigo));
create policy sequencia_territorio on public.sequencia
  for select to authenticated using (app.pode_ver_geocodigo(geocodigo));
create policy indicador_territorio on public.indicador
  for select to authenticated using (app.pode_ver_geocodigo(geocodigo));
create policy alerta_territorio on public.alerta
  for select to authenticated using (app.pode_ver_geocodigo(geocodigo));
create policy classificacao_territorio on public.classificacao
  for select to authenticated using (
    exists (select 1 from public.sequencia s
            where s.accession = classificacao.accession
              and app.pode_ver_geocodigo(s.geocodigo)));
create policy exclusao_territorio on public.exclusao_qc
  for select to authenticated using (
    exists (select 1 from public.sequencia s
            where s.accession = exclusao_qc.accession
              and app.pode_ver_geocodigo(s.geocodigo)));

-- Apenas vigilancia/laboratorio mudam status de alerta. Leitura nunca escreve.
create policy alerta_revisao on public.alerta
  for update to authenticated
  using (app.tem_papel_no_territorio(geocodigo, array['vigilancia','laboratorio']))
  with check (app.tem_papel_no_territorio(geocodigo, array['vigilancia','laboratorio']));

-- Usuário só pode alterar status (as demais colunas ficam travadas).
revoke update on public.alerta from authenticated;
grant update (status) on public.alerta to authenticated;

-- Auditoria: leitura para estado/laboratório; sem INSERT direto, sem UPDATE/DELETE.
create policy auditoria_leitura on public.auditoria
  for select to authenticated using (app.pode_ver_geocodigo(null));

create or replace function app.auditoria_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'auditoria é append-only: % não permitido', tg_op;
end;
$$;
create trigger auditoria_sem_update_delete
  before update or delete on public.auditoria
  for each row execute function app.auditoria_append_only();
create trigger auditoria_sem_truncate
  before truncate on public.auditoria
  for each statement execute function app.auditoria_append_only();

-- Revisão de alerta: grava quem e quando, e registra em auditoria.
create or replace function app.alerta_revisado()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    new.revisado_por := auth.uid();
    new.revisado_em  := now();
    insert into public.auditoria (ator, acao, entidade, entidade_id, detalhe)
    values (coalesce(auth.uid()::text, current_user), 'alerta.status', 'alerta', old.id::text,
            jsonb_build_object('de', old.status, 'para', new.status));
  end if;
  return new;
end;
$$;
create trigger alerta_revisado
  before update on public.alerta
  for each row execute function app.alerta_revisado();

-- Anônimos não leem nada.
revoke all on all tables in schema public from anon;
