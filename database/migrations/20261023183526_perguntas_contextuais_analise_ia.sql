begin;

create table public.ia_perguntas_contextuais (
  id_solicitacao uuid primary key default gen_random_uuid(),
  id_usuario uuid not null references public.usuarios("idUsuario") on delete cascade,
  id_questao uuid not null references public.questoes("idQuestao") on delete cascade,
  contexto_hash text not null,
  pergunta text not null check (length(btrim(pergunta)) between 5 and 1000),
  resposta text check (resposta is null or length(btrim(resposta)) between 1 and 6000),
  status text not null check (status in ('processando', 'concluida', 'falha')),
  modelo text,
  tokens_entrada integer check (tokens_entrada >= 0),
  tokens_saida integer check (tokens_saida >= 0),
  tokens_entrada_cache integer check (tokens_entrada_cache >= 0),
  custo_estimado_usd numeric(14, 8) check (custo_estimado_usd >= 0),
  criada_em timestamptz not null default now(),
  respondida_em timestamptz,
  check (status <> 'concluida' or (resposta is not null and modelo is not null and respondida_em is not null))
);

create index ia_perguntas_contextuais_usuario_questao_idx
  on public.ia_perguntas_contextuais(id_usuario, id_questao, criada_em desc);

alter table public.ia_perguntas_contextuais enable row level security;
revoke all on public.ia_perguntas_contextuais from public, anon, authenticated, concursa_dados;
grant select on public.ia_perguntas_contextuais to concursa_dados;

create policy ia_perguntas_contextuais_leitura on public.ia_perguntas_contextuais
  for select to concursa_dados
  using (id_usuario = (select auth.uid()) or (select public.eh_administrador()));

create function provas_privado.consultar_historico_perguntas_contextuais_ia(
  p_idtentativa uuid, p_idquestao uuid
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_contexto jsonb; v_historico jsonb;
begin
  v_contexto := public.contexto_analise_questao(p_idtentativa, p_idquestao);

  select coalesce(jsonb_agg(jsonb_build_object(
    'idSolicitacao', id_solicitacao,
    'pergunta', pergunta,
    'resposta', resposta,
    'criadaEm', respondida_em
  ) order by criada_em), '[]'::jsonb)
  into v_historico
  from (
    select id_solicitacao, pergunta, resposta, criada_em, respondida_em
    from public.ia_perguntas_contextuais
    where id_usuario = auth.uid() and id_questao = p_idquestao
      and contexto_hash = v_contexto->>'hash' and status = 'concluida'
    order by criada_em desc limit 30
  ) perguntas;

  return v_historico;
end $$;

create function public.consultar_historico_perguntas_contextuais_ia(
  p_idtentativa uuid, p_idquestao uuid
) returns jsonb
language sql security invoker set search_path = '' as $$
  select provas_privado.consultar_historico_perguntas_contextuais_ia(p_idtentativa, p_idquestao)
$$;

create function provas_privado.reservar_pergunta_contextual_ia(
  p_idtentativa uuid, p_idquestao uuid, p_pergunta text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_contexto jsonb;
  v_analise public.analises_questoes;
  v_limite public.limites_analises_ia;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_id_solicitacao uuid;
  v_historico jsonb;
begin
  if p_pergunta is null or length(btrim(p_pergunta)) not between 5 and 1000 then
    raise exception 'A pergunta deve ter entre 5 e 1000 caracteres.';
  end if;

  v_contexto := public.contexto_analise_questao(p_idtentativa, p_idquestao);

  select * into v_analise from public.analises_questoes
  where "idUsuario" = auth.uid() and "idQuestao" = p_idquestao
    and contexto_hash = v_contexto->>'hash' and status = 'concluida';

  if not found then
    raise exception 'Solicite a análise da questão antes de fazer perguntas adicionais.';
  end if;

  insert into public.limites_analises_ia("idUsuario") values (auth.uid())
    on conflict do nothing;
  select * into v_limite from public.limites_analises_ia
    where "idUsuario" = auth.uid() for update;

  if v_limite.dia = v_hoje and v_limite.solicitacoes >= 20 then
    raise exception 'Você atingiu o limite de 20 interações com IA por dia.';
  end if;

  v_historico := provas_privado.consultar_historico_perguntas_contextuais_ia(
    p_idtentativa, p_idquestao
  );

  update public.limites_analises_ia set dia = v_hoje,
    solicitacoes = case when dia = v_hoje then solicitacoes + 1 else 1 end
  where "idUsuario" = auth.uid();

  insert into public.ia_perguntas_contextuais(
    id_usuario, id_questao, contexto_hash, pergunta, status
  ) values (
    auth.uid(), p_idquestao, v_contexto->>'hash', btrim(p_pergunta), 'processando'
  ) returning id_solicitacao into v_id_solicitacao;

  return jsonb_build_object(
    'idSolicitacao', v_id_solicitacao,
    'contexto', v_contexto->'contexto',
    'analise', v_analise.conteudo,
    'historico', v_historico
  );
end $$;

create function public.reservar_pergunta_contextual_ia(
  p_idtentativa uuid, p_idquestao uuid, p_pergunta text
) returns jsonb
language sql security invoker set search_path = '' as $$
  select provas_privado.reservar_pergunta_contextual_ia(p_idtentativa, p_idquestao, p_pergunta)
$$;

create function provas_privado.salvar_pergunta_contextual_ia(
  p_id_solicitacao uuid, p_resposta text, p_modelo text, p_falhou boolean,
  p_tokens_entrada integer, p_tokens_saida integer,
  p_tokens_entrada_cache integer, p_custo_estimado_usd numeric
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_linhas integer;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autorizada.' using errcode = '42501';
  end if;

  if not p_falhou and (
    p_resposta is null or length(btrim(p_resposta)) not between 1 and 6000
    or p_modelo is null or length(btrim(p_modelo)) not between 1 and 100
  ) then
    raise exception 'Resposta contextual incompleta.';
  end if;

  update public.ia_perguntas_contextuais
  set status = case when p_falhou then 'falha' else 'concluida' end,
    resposta = case when p_falhou then null else btrim(p_resposta) end,
    modelo = case when p_falhou then null else p_modelo end,
    tokens_entrada = p_tokens_entrada,
    tokens_saida = p_tokens_saida,
    tokens_entrada_cache = p_tokens_entrada_cache,
    custo_estimado_usd = p_custo_estimado_usd,
    respondida_em = case when p_falhou then null else now() end
  where id_solicitacao = p_id_solicitacao and id_usuario = auth.uid()
    and status = 'processando';

  get diagnostics v_linhas = row_count;
  return v_linhas = 1;
end $$;

create function public.salvar_pergunta_contextual_ia(
  p_id_solicitacao uuid, p_resposta text, p_modelo text, p_falhou boolean,
  p_tokens_entrada integer, p_tokens_saida integer,
  p_tokens_entrada_cache integer, p_custo_estimado_usd numeric
) returns boolean
language sql security invoker set search_path = '' as $$
  select provas_privado.salvar_pergunta_contextual_ia(
    p_id_solicitacao, p_resposta, p_modelo, p_falhou, p_tokens_entrada,
    p_tokens_saida, p_tokens_entrada_cache, p_custo_estimado_usd
  )
$$;

revoke all on function provas_privado.consultar_historico_perguntas_contextuais_ia(uuid, uuid),
  public.consultar_historico_perguntas_contextuais_ia(uuid, uuid),
  provas_privado.reservar_pergunta_contextual_ia(uuid, uuid, text),
  public.reservar_pergunta_contextual_ia(uuid, uuid, text),
  provas_privado.salvar_pergunta_contextual_ia(uuid, text, text, boolean, integer, integer, integer, numeric),
  public.salvar_pergunta_contextual_ia(uuid, text, text, boolean, integer, integer, integer, numeric)
  from public, anon, authenticated;

grant execute on function provas_privado.consultar_historico_perguntas_contextuais_ia(uuid, uuid),
  public.consultar_historico_perguntas_contextuais_ia(uuid, uuid),
  provas_privado.reservar_pergunta_contextual_ia(uuid, uuid, text),
  public.reservar_pergunta_contextual_ia(uuid, uuid, text),
  provas_privado.salvar_pergunta_contextual_ia(uuid, text, text, boolean, integer, integer, integer, numeric),
  public.salvar_pergunta_contextual_ia(uuid, text, text, boolean, integer, integer, integer, numeric)
  to concursa_dados;

notify pgrst, 'reload schema';
commit;
