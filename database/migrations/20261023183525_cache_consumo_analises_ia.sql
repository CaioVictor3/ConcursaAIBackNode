begin;

create index analises_questoes_cache_compartilhado_idx
  on public.analises_questoes("idQuestao", contexto_hash, gerada_em desc)
  where status = 'concluida';

create table public.ia_consumo_analises (
  id_solicitacao uuid primary key,
  id_usuario uuid not null references public.usuarios("idUsuario") on delete cascade,
  id_questao uuid not null references public.questoes("idQuestao") on delete cascade,
  modelo text not null,
  tokens_entrada integer check (tokens_entrada >= 0),
  tokens_saida integer check (tokens_saida >= 0),
  tokens_entrada_cache integer check (tokens_entrada_cache >= 0),
  custo_estimado_usd numeric(14, 8) check (custo_estimado_usd >= 0),
  criada_em timestamptz not null default now()
);

create index ia_consumo_analises_usuario_data_idx
  on public.ia_consumo_analises(id_usuario, criada_em desc);

alter table public.ia_consumo_analises enable row level security;
revoke all on public.ia_consumo_analises from public, anon, authenticated, concursa_dados;
grant select on public.ia_consumo_analises to concursa_dados;

create policy ia_consumo_analises_leitura on public.ia_consumo_analises
  for select to concursa_dados
  using (id_usuario = (select auth.uid()) or (select public.eh_administrador()));

create or replace function provas_privado.reservar_analise_backend(
  p_idtentativa uuid, p_idquestao uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_contexto jsonb;
  v_reserva jsonb;
  v_analise public.analises_questoes;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autorizada.' using errcode = '42501';
  end if;

  v_contexto := public.contexto_analise_questao(p_idtentativa, p_idquestao);

  select * into v_analise from public.analises_questoes
  where "idUsuario" = auth.uid() and "idQuestao" = p_idquestao
    and status = 'concluida' and contexto_hash = v_contexto->>'hash';

  if not found then
    select * into v_analise from public.analises_questoes
    where "idQuestao" = p_idquestao and contexto_hash = v_contexto->>'hash'
      and status = 'concluida'
    order by gerada_em desc limit 1;
  end if;

  if found then
    insert into public.limites_analises_ia("idUsuario") values (auth.uid())
      on conflict do nothing;
    perform 1 from public.limites_analises_ia
      where "idUsuario" = auth.uid() for update;

    insert into public.analises_questoes(
      "idUsuario", "idQuestao", contexto_hash, status, conteudo, modelo, gerada_em
    ) values (
      auth.uid(), p_idquestao, v_contexto->>'hash', 'concluida',
      v_analise.conteudo, v_analise.modelo, v_analise.gerada_em
    ) on conflict ("idUsuario", "idQuestao") do update
      set contexto_hash = excluded.contexto_hash, status = excluded.status,
        conteudo = excluded.conteudo, modelo = excluded.modelo, gerada_em = excluded.gerada_em;

    return jsonb_build_object('analise', jsonb_build_object(
      'conteudo', v_analise.conteudo, 'modelo', v_analise.modelo,
      'geradaEm', v_analise.gerada_em, 'demonstracao', false
    ), 'contexto', v_contexto->'contexto');
  end if;

  v_reserva := public.reservar_analise_questao(
    auth.uid(), p_idquestao, v_contexto->>'hash'
  );

  return v_reserva || jsonb_build_object('contexto', v_contexto->'contexto');
end $$;

create function provas_privado.salvar_analise_backend_com_consumo(
  p_idquestao uuid,
  p_idsolicitacao uuid,
  p_conteudo jsonb,
  p_modelo text,
  p_falhou boolean,
  p_tokens_entrada integer,
  p_tokens_saida integer,
  p_tokens_entrada_cache integer,
  p_custo_estimado_usd numeric
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_salvou boolean;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autorizada.' using errcode = '42501';
  end if;

  v_salvou := public.salvar_analise_backend(
    p_idquestao, p_idsolicitacao, p_conteudo, p_modelo, p_falhou
  );

  if v_salvou and not p_falhou then
    insert into public.ia_consumo_analises(
      id_solicitacao, id_usuario, id_questao, modelo, tokens_entrada,
      tokens_saida, tokens_entrada_cache, custo_estimado_usd
    ) values (
      p_idsolicitacao, auth.uid(), p_idquestao, p_modelo, p_tokens_entrada,
      p_tokens_saida, p_tokens_entrada_cache, p_custo_estimado_usd
    );
  end if;

  return v_salvou;
end $$;

create function public.salvar_analise_backend_com_consumo(
  p_idquestao uuid,
  p_idsolicitacao uuid,
  p_conteudo jsonb,
  p_modelo text,
  p_falhou boolean,
  p_tokens_entrada integer,
  p_tokens_saida integer,
  p_tokens_entrada_cache integer,
  p_custo_estimado_usd numeric
) returns boolean
language sql security invoker set search_path = '' as $$
  select provas_privado.salvar_analise_backend_com_consumo(
    p_idquestao, p_idsolicitacao, p_conteudo, p_modelo, p_falhou,
    p_tokens_entrada, p_tokens_saida, p_tokens_entrada_cache, p_custo_estimado_usd
  )
$$;

revoke all on function provas_privado.salvar_analise_backend_com_consumo(
  uuid, uuid, jsonb, text, boolean, integer, integer, integer, numeric
), public.salvar_analise_backend_com_consumo(
  uuid, uuid, jsonb, text, boolean, integer, integer, integer, numeric
) from public, anon, authenticated;

grant execute on function provas_privado.salvar_analise_backend_com_consumo(
  uuid, uuid, jsonb, text, boolean, integer, integer, integer, numeric
), public.salvar_analise_backend_com_consumo(
  uuid, uuid, jsonb, text, boolean, integer, integer, integer, numeric
) to concursa_dados;

notify pgrst, 'reload schema';
commit;
