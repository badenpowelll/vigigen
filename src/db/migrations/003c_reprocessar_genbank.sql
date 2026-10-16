-- 003c: reprocessa todas as respostas brutas de efetch já gravadas (usado após
-- a correção do xpath em 003) e marca RN pela sigla no geo_loc.
-- O gatilho app.sequencia_uf_rn (003d, atualizado em 005) faz isso nas novas cargas.
create or replace function public.reprocessar_genbank()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; total integer := 0; n integer;
begin
  for r in select id from public.bruto
           where fonte = 'genbank' and endpoint like '%efetch%' and status_http = 200 order by id loop
    n := public.ingest_genbank(r.id);
    total := total + n;
  end loop;
  update public.sequencia set uf_inferida = 'RN'
  where uf_inferida is null and app.norm(geo_loc_bruto) ~ '\mrn\M';
  return total;
end;
$$;
revoke all on function public.reprocessar_genbank() from public, anon, authenticated;
