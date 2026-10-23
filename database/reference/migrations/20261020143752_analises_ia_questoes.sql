-- A geração é exclusiva da Edge Function; o estudante pode apenas ler suas análises.
create table public.analises_questoes (
  "idUsuario" uuid not null references public.usuarios("idUsuario") on delete cascade,
  "idQuestao" uuid not null references public.questoes("idQuestao") on delete cascade,
  contexto_hash text not null,
  status text not null check (status in ('processando', 'concluida', 'falha')),
  "idSolicitacao" uuid not null default gen_random_uuid(),
  conteudo jsonb,
  modelo text,
  iniciada_em timestamptz not null default now(),
  gerada_em timestamptz,
  primary key ("idUsuario", "idQuestao"),
  check (status <> 'concluida' or (conteudo is not null and jsonb_typeof(conteudo) = 'object' and modelo is not null and gerada_em is not null))
);
create index analises_questoes_questao_idx on public.analises_questoes("idQuestao");
alter table public.analises_questoes enable row level security;
revoke all on public.analises_questoes from public, anon, authenticated;
grant select on public.analises_questoes to authenticated;
grant select, insert, update, delete on public.analises_questoes to service_role;
create policy analises_questoes_proprias on public.analises_questoes for select to authenticated
  using ("idUsuario" = (select auth.uid()));

create table public.limites_analises_ia (
  "idUsuario" uuid primary key references public.usuarios("idUsuario") on delete cascade,
  dia date not null default (now() at time zone 'America/Sao_Paulo')::date,
  solicitacoes integer not null default 0 check (solicitacoes >= 0)
);
alter table public.limites_analises_ia enable row level security;
revoke all on public.limites_analises_ia from public, anon, authenticated;
grant select, insert, update, delete on public.limites_analises_ia to service_role;

-- Reaproveita a correção imutável, cuja RPC já verifica proprietário e finalização.
create function public.contexto_analise_questao(p_idtentativa uuid, p_idquestao uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_item jsonb; v_contexto jsonb; v_usuario uuid := auth.uid();
begin
  if v_usuario is null or not exists(select 1 from public.usuarios u
    where u."idUsuario" = v_usuario and u.tipo = 'estudante' and u.estado_cadastro = 'ativo' and u.cadastro_completo) then
    raise exception 'Sessão de estudante não autorizada.';
  end if;
  select i into v_item from jsonb_array_elements(public.obter_resultado_tentativa(p_idtentativa)->'itens') i
    where i->>'idQuestao' = p_idquestao::text;
  if v_item is null or coalesce((v_item->>'acertou')::boolean, true)
    or coalesce((v_item->>'anulada')::boolean, true)
    or v_item->>'idAlternativaSelecionada' is null or v_item->>'idAlternativaCorreta' is null then
    raise exception 'A análise está disponível somente para respostas incorretas de seus simulados finalizados.';
  end if;
  select jsonb_build_object('idQuestao', q."idQuestao", 'enunciado', q.enunciado,
    'alternativas', (select jsonb_agg(jsonb_build_object('idAlternativa', a."idAlternativa", 'letra', a.letra, 'texto', a.texto) order by a.ordem)
      from public.alternativas a where a."idQuestao" = q."idQuestao"),
    'idAlternativaSelecionada', v_item->>'idAlternativaSelecionada',
    'idAlternativaCorreta', v_item->>'idAlternativaCorreta', 'explicacaoOficial', coalesce(v_item->>'explicacao', ''))
    into v_contexto from public.questoes q where q."idQuestao" = p_idquestao;
  if v_contexto is null then raise exception 'Questão indisponível para análise.'; end if;
  return jsonb_build_object('contexto', v_contexto, 'hash', md5('analise-v1:' || v_contexto::text));
end $$;

create function public.consultar_analise_questao(p_idtentativa uuid, p_idquestao uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_contexto jsonb; v_analise jsonb;
begin
  v_contexto := public.contexto_analise_questao(p_idtentativa, p_idquestao);
  select jsonb_build_object('conteudo', a.conteudo, 'modelo', a.modelo, 'geradaEm', a.gerada_em, 'demonstracao', false)
    into v_analise from public.analises_questoes a where a."idUsuario" = auth.uid() and a."idQuestao" = p_idquestao
      and a.status = 'concluida' and a.contexto_hash = v_contexto->>'hash';
  return v_analise;
end $$;

-- Chamada apenas pelo servidor. Bloqueio por aluno evita duplicidade entre abas/instâncias.
create function public.reservar_analise_questao(p_idusuario uuid, p_idquestao uuid, p_hash text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_analise public.analises_questoes; v_limite public.limites_analises_ia;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  insert into public.limites_analises_ia("idUsuario") values(p_idusuario) on conflict do nothing;
  select * into v_limite from public.limites_analises_ia where "idUsuario" = p_idusuario for update;
  select * into v_analise from public.analises_questoes where "idUsuario" = p_idusuario and "idQuestao" = p_idquestao;
  if v_analise.status = 'concluida' and v_analise.contexto_hash = p_hash then
    return jsonb_build_object('analise', jsonb_build_object('conteudo', v_analise.conteudo, 'modelo', v_analise.modelo,
      'geradaEm', v_analise.gerada_em, 'demonstracao', false));
  end if;
  if v_analise.status = 'processando' and v_analise.iniciada_em > now() - interval '2 minutes' then
    raise exception 'Esta questão já está sendo analisada. Aguarde e consulte novamente.';
  end if;
  if v_limite.dia = v_hoje and v_limite.solicitacoes >= 20 then
    raise exception 'Você atingiu o limite de 20 análises por dia. Suas análises salvas continuam disponíveis.';
  end if;
  update public.limites_analises_ia set dia = v_hoje,
    solicitacoes = case when dia = v_hoje then solicitacoes + 1 else 1 end where "idUsuario" = p_idusuario;
  insert into public.analises_questoes("idUsuario", "idQuestao", contexto_hash, status)
    values(p_idusuario, p_idquestao, p_hash, 'processando')
    on conflict ("idUsuario", "idQuestao") do update set contexto_hash = excluded.contexto_hash,
      status = 'processando', "idSolicitacao" = gen_random_uuid(), conteudo = null, modelo = null, iniciada_em = now(), gerada_em = null
    returning * into v_analise;
  return jsonb_build_object('idSolicitacao', v_analise."idSolicitacao");
end $$;

create function public.listar_questoes_revisao(p_pagina integer default 1) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_itens jsonb; v_total integer;
begin
  if p_pagina is null or p_pagina < 1 or p_pagina > 100000 then raise exception 'Página inválida.'; end if;
  perform public.quantidade_questoes_odonto();
  with recentes as (
    select distinct on (i->>'idQuestao') t."idTentativa", t.finalizada_em, i
    from public.tentativas_simulado t cross join lateral jsonb_array_elements(public.obter_resultado_tentativa(t."idTentativa")->'itens') i
    where t."idPessoa" = auth.uid() and t.status = 'finalizada'
    order by i->>'idQuestao', t.finalizada_em desc, t.iniciada_em desc, t."idTentativa" desc
  ), pendentes as (
    select r."idTentativa", q."idQuestao", q.enunciado, r.finalizada_em as "finalizadaEm", a.nome as assunto, d.nome as disciplina
    from recentes r join public.questoes q on q."idQuestao" = (r.i->>'idQuestao')::uuid
    join public.assuntos a on a."idAssunto" = q."idAssunto" join public.disciplinas d on d."idDisciplina" = q."idDisciplina"
    where not (r.i->>'acertou')::boolean and not (r.i->>'anulada')::boolean and r.i->>'idAlternativaSelecionada' is not null
      and q.status = 'publicada' and d.ativa and d.area = 'odontologia'
  ), pagina as (select * from pendentes order by "finalizadaEm" desc, "idQuestao" limit 5 offset (p_pagina - 1) * 5)
  select (select count(*)::integer from pendentes), coalesce((select jsonb_agg(to_jsonb(p)) from pagina p), '[]'::jsonb) into v_total, v_itens;
  return jsonb_build_object('itens', v_itens, 'total', v_total, 'pagina', p_pagina, 'por_pagina', 5);
end $$;

revoke all on function public.contexto_analise_questao(uuid,uuid), public.consultar_analise_questao(uuid,uuid),
  public.listar_questoes_revisao(integer), public.reservar_analise_questao(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.contexto_analise_questao(uuid,uuid), public.consultar_analise_questao(uuid,uuid),
  public.listar_questoes_revisao(integer) to authenticated;
grant execute on function public.reservar_analise_questao(uuid,uuid,text) to service_role;
notify pgrst, 'reload schema';
