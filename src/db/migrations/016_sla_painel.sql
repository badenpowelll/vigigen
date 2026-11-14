-- VigiGen — 016: SLA de atualização dos dados visível no painel, meta de 95%.
--
-- NÃO APLICADA EM PRODUÇÃO. Aplicar só com autorização expressa. Depende da
-- 011_administracao.sql (PR #1, já aplicada no banco) e da 013_multiagravo.sql.
--
-- O que muda:
--  * A meta de idade do GenBank acompanha a agenda diária (012): 24 h + 24 h de
--    tolerância. A 011 ainda dizia "ter, 10h UTC" com 7 dias + 24 h.
--  * Meta de cumprimento: 95% das horas dos últimos 30 dias com o dado dentro da
--    meta de idade (mesma regra de app.sla_sucessos da 011).
--  * public.painel_sla(): só agregados (sem mensagens de erro, sem e-mails),
--    para qualquer usuário autenticado. O detalhe continua em admin_sla().
--  * painel_resumo() passa a trazer a chave "sla".

create or replace function app.sla_metas()
returns table (fonte text, rotulo text, agenda text, meta interval)
language sql immutable set search_path = '' as $$
  values ('infodengue', 'Casos semanais (InfoDengue)', 'seg e qui, 09h UTC', interval '4 days' + interval '24 hours'),
         ('genbank',    'Sequências (GenBank)',        'todo dia, 10h UTC',  interval '24 hours' + interval '24 hours'),
         ('ibge',       'Malha municipal (IBGE)',      'dia 1, 08h UTC',     interval '31 days' + interval '24 hours'),
         ('indicadores','Indicadores calculados',      'a cada 6 h',         interval '7 hours'),
         ('nextclade',  'Classificação Nextclade',     'ter (GitHub Actions)', interval '7 days' + interval '24 hours');
$$;

create or replace function public.painel_sla()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'meta_cumprimento', 95,
    'janela_dias', 30,
    'calculado_em', now(),
    'fontes', (
      select jsonb_agg(jsonb_build_object(
        'fonte', m.fonte, 'rotulo', m.rotulo, 'agenda', m.agenda,
        'meta_horas', extract(epoch from m.meta) / 3600,
        'ultima_ok', u.ultima,
        'idade_horas', round((extract(epoch from now() - u.ultima) / 3600)::numeric, 1),
        'dentro', u.ultima is not null and now() - u.ultima <= m.meta,
        'cumprimento_30d', c.pct, 'horas_medidas_30d', c.horas,
        'atende', c.pct is not null and c.pct >= 95) order by m.fonte)
      from app.sla_metas() m
      left join lateral (select max(s.em) ultima from app.sla_sucessos() s where s.fonte = m.fonte) u on true
      left join lateral (
        select round(100.0 * count(*) filter (where ok) / nullif(count(*), 0), 1) pct, count(*) horas
        from (select h, exists (select 1 from app.sla_sucessos() s
                                where s.fonte = m.fonte and s.em <= h and s.em > h - m.meta) ok
              from generate_series(date_trunc('hour', now()) - interval '30 days', date_trunc('hour', now()), interval '1 hour') h
              where h >= (select min(s.em) from app.sla_sucessos() s where s.fonte = m.fonte)) x
      ) c on true));
$$;
revoke all on function public.painel_sla() from public, anon;
grant execute on function public.painel_sla() to authenticated;

-- painel_resumo da 013 continua igual e ganha a chave "sla".
alter function public.painel_resumo() rename to painel_resumo_base;
create function public.painel_resumo()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select public.painel_resumo_base() || jsonb_build_object('sla', public.painel_sla());
$$;
revoke all on function public.painel_resumo() from public, anon;
grant execute on function public.painel_resumo() to authenticated;

-- Reversão:
--   drop function public.painel_resumo();
--   alter function public.painel_resumo_base() rename to painel_resumo;
--   drop function public.painel_sla();
--   reaplicar app.sla_metas() de 011_administracao.sql.
