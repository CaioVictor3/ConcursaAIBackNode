begin;

-- A Data API usa a role authenticated. A política usuarios_leitura já limita
-- cada estudante ao próprio perfil e permite leitura administrativa.
grant select on table public.usuarios to authenticated;

-- A política RLS de usuarios invoca esta função SECURITY DEFINER.
grant execute on function public.eh_administrador() to authenticated;

commit;
