-- VigiGen — 022: matrícula funcional no perfil, para o carimbo das exportações.
--
-- NÃO APLICADA EM PRODUÇÃO. Aplicar só com autorização expressa do Baden.
-- Depende da 011 (public.perfil, public.meu_perfil).
--
-- Regra do Baden (14/11/2026): todo PDF e toda impressão do painel trazem a
-- matrícula e o e-mail de quem imprimiu e a data e hora com segundos. O e-mail
-- já está em perfil; a matrícula é nova. Fica nula até o administrador
-- preenchê-la; o painel mostra "matrícula não cadastrada" enquanto isso.
-- A matrícula fica só no banco (com RLS da 011), nunca no repositório.

alter table public.perfil
  add column if not exists matricula text
  check (matricula is null or (length(btrim(matricula)) between 1 and 40));

-- Mesmo corpo da 011, com a matrícula acrescentada.
create or replace function public.meu_perfil()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', p.user_id, 'email', p.email, 'nome', p.nome, 'matricula', p.matricula,
    'administrador', p.administrador, 'ativo', p.ativo,
    'vinculos', coalesce((select jsonb_agg(jsonb_build_object('papel', uo.papel, 'organizacao', o.nome, 'tipo', o.tipo))
                          from public.usuario_organizacao uo join public.organizacao o on o.id = uo.organizacao_id
                          where uo.user_id = p.user_id), '[]'::jsonb))
  from public.perfil p where p.user_id = (select auth.uid());
$$;
revoke all on function public.meu_perfil() from public, anon;
grant execute on function public.meu_perfil() to authenticated;
