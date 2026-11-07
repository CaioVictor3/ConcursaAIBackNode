begin;

create function financeiro.vigencia_premium(p_pessoa uuid)
returns timestamptz language sql stable security invoker set search_path = '' as $$
  select max(a.fim_em)
  from public.assinaturas a
  join public.pagamentos p on p.id = a.id_pagamento
  join public.usuarios u on u."idUsuario" = a.id_pessoa
  join public.pedidos_pagamento o on o.id = a.id_pedido
  join financeiro.configuracao c on c.ambiente = o.ambiente
  where a.id_pessoa = p_pessoa
    and u.estado_cadastro = 'ativo'
    and a.status = 'ativa'
    and a.inicio_em <= now() and a.fim_em > now()
    and p.status = 'aprovado'
$$;
revoke all on function financeiro.vigencia_premium(uuid) from public, anon, authenticated;

create or replace function financeiro.tem_premium(p_pessoa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select financeiro.vigencia_premium(p_pessoa) is not null
$$;

create function public.vigencia_acesso_premium()
returns timestamptz language sql stable security definer set search_path = '' as $$
  select financeiro.vigencia_premium(auth.uid())
  where auth.uid() is not null
$$;
revoke all on function public.vigencia_acesso_premium() from public, anon, authenticated;
grant execute on function public.vigencia_acesso_premium() to authenticated;

create policy premium_vigente on public.assuntos as restrictive for all to authenticated
  using ((select public.tem_acesso_premium())) with check ((select public.tem_acesso_premium()));
create policy premium_vigente on public.bancas as restrictive for all to authenticated
  using ((select public.tem_acesso_premium())) with check ((select public.tem_acesso_premium()));
create policy premium_vigente on public.disciplinas as restrictive for all to authenticated
  using ((select public.tem_acesso_premium())) with check ((select public.tem_acesso_premium()));
create policy premium_vigente on public.temas as restrictive for all to authenticated
  using ((select public.tem_acesso_premium())) with check ((select public.tem_acesso_premium()));

notify pgrst, 'reload schema';
commit;
