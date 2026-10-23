-- Histórico privado: a correção mais recente decide se a questão ainda precisa de revisão.
create function public.ultimas_correcoes_odonto()
returns table ("idQuestao" uuid, pendente boolean, recuperada boolean)
language sql stable security definer set search_path = '' as $$
  with historico as (
    select (i->>'idQuestao')::uuid as questao, (i->>'acertou')::boolean as acertou,
      coalesce((i->>'anulada')::boolean, false) as anulada,
      t.finalizada_em, t.iniciada_em, t."idTentativa",
      bool_or(not (i->>'acertou')::boolean and not coalesce((i->>'anulada')::boolean, false))
        over (partition by i->>'idQuestao') as ja_errou
    from public.tentativas_simulado t cross join lateral jsonb_array_elements(t.correcao_json) i
    where t."idPessoa" = auth.uid() and t.status = 'finalizada'
  )
  select distinct on (questao) questao, not acertou and not anulada, acertou and ja_errou and not anulada
  from historico order by questao, finalizada_em desc, iniciada_em desc, "idTentativa" desc;
$$;
revoke all on function public.ultimas_correcoes_odonto() from public, anon, authenticated;

create function public.resumo_revisao_odonto() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_resultado jsonb;
begin
  perform public.quantidade_questoes_odonto();
  with revisao as (
    select e.*, h.pendente, h.recuperada from public.questoes_elegiveis_odonto() e
    join public.ultimas_correcoes_odonto() h on h."idQuestao" = e."idQuestao"
  ), assuntos as (
    select a."idAssunto", a.nome as assunto, d."idDisciplina", d.nome as disciplina, count(*)::integer as quantidade
    from revisao r join public.assuntos a on a."idAssunto" = r."idAssunto"
    join public.disciplinas d on d."idDisciplina" = r."idDisciplina" where r.pendente
    group by a."idAssunto", d."idDisciplina" order by d.nome, a.nome
  )
  select jsonb_build_object('pendentes', (select count(*) from revisao where pendente),
    'recuperadas', (select count(*) from revisao where recuperada),
    'assuntos', coalesce((select jsonb_agg(to_jsonb(a)) from assuntos a), '[]'::jsonb)) into v_resultado;
  return v_resultado;
end $$;

create function public.gerar_treino_odonto(p_quantidade integer, p_modo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_pool uuid[]; v_ids uuid[]; v_simulado uuid; v_tentativa uuid; v_titulo text;
begin
  perform public.quantidade_questoes_odonto();
  if p_modo is null or p_modo not in ('revisao', 'recomendado') then raise exception 'Tipo de treino inválido'; end if;
  if p_quantidade is null or p_quantidade < 1 then raise exception 'Informe uma quantidade inteira de pelo menos 1 questão'; end if;
  select coalesce(array_agg(x."idQuestao"), '{}'::uuid[]) into v_pool from (
    select q."idQuestao" from public.questoes q
    join public.disciplinas d on d."idDisciplina" = q."idDisciplina"
    join public.questoes_elegiveis_odonto() e on e."idQuestao" = q."idQuestao"
    left join public.ultimas_correcoes_odonto() h on h."idQuestao" = q."idQuestao"
    where p_modo = 'recomendado' or h.pendente
    order by q."idQuestao" for share of q, d
  ) x;
  if p_quantidade > cardinality(v_pool) then raise exception 'Há apenas % questões disponíveis para este treino', cardinality(v_pool); end if;
  -- A taxa de erros/brancos prioriza assuntos. Sem histórico, prioridade intermediária.
  select array_agg(x."idQuestao" order by random()) into v_ids from (
    select q."idQuestao" from public.questoes q
    left join public.estatisticas_assuntos() e on e."idAssunto" = q."idAssunto"
    where q."idQuestao" = any(v_pool)
    order by case when p_modo = 'recomendado'
      then coalesce((e.erros + e.em_branco)::numeric / nullif(e.avaliadas, 0), .5) else 0 end desc,
      random() limit p_quantidade
  ) x;
  v_titulo := case when p_modo = 'revisao' then 'Revisão de erros' else 'Treino recomendado' end;
  insert into public.simulados(nome, descricao, tipo, publico, status, "idPessoaCriadora")
    values(v_titulo || ' · ' || p_quantidade || case when p_quantidade = 1 then ' questão' else ' questões' end,
      case when p_modo = 'revisao' then 'Questões com erro ou em branco na correção mais recente.'
        else 'Treino priorizado pelo desempenho por assunto; sem histórico, sorteio geral.' end,
      'personalizado', false, 'publicado', auth.uid()) returning "idSimulado" into v_simulado;
  insert into public.simulado_questoes("idSimulado", "idQuestao", ordem)
    select v_simulado, item, ordem::integer from unnest(v_ids) with ordinality as itens(item, ordem);
  insert into public.tentativas_simulado("idSimulado", "idPessoa") values(v_simulado, auth.uid())
    returning "idTentativa" into v_tentativa;
  return v_tentativa;
end $$;

create table public.metas_estudo (
  "idPessoa" uuid primary key references public.estudantes("idEstudante") on delete cascade,
  quantidade_semanal integer not null check (quantidade_semanal between 1 and 2000),
  atualizada_em timestamptz not null default now()
);
alter table public.metas_estudo enable row level security;
revoke all on public.metas_estudo from public, anon, authenticated;
grant select on public.metas_estudo to authenticated;
create policy metas_estudo_leitura on public.metas_estudo for select to authenticated
  using ("idPessoa" = (select auth.uid()));
create index tentativas_estudo_semana_idx on public.tentativas_simulado("idPessoa", finalizada_em)
  where status = 'finalizada';

create function public.salvar_meta_semanal(p_quantidade integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.quantidade_questoes_odonto();
  if p_quantidade is null or p_quantidade not between 1 and 2000 then
    raise exception 'Defina uma meta inteira entre 1 e 2000 questões por semana'; end if;
  insert into public.metas_estudo("idPessoa", quantidade_semanal) values(auth.uid(), p_quantidade)
    on conflict ("idPessoa") do update set quantidade_semanal = excluded.quantidade_semanal, atualizada_em = now();
end $$;

create function public.progresso_meta_semanal() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_inicio date; v_resultado jsonb;
begin
  perform public.quantidade_questoes_odonto();
  v_inicio := v_hoje - (extract(isodow from v_hoje)::integer - 1);
  with concluidas as (
    select (t.finalizada_em at time zone 'America/Sao_Paulo')::date as dia,
      (select count(*)::integer from jsonb_array_elements(t.correcao_json) i where i->>'idAlternativaSelecionada' is not null) as quantidade
    from public.tentativas_simulado t where t."idPessoa" = auth.uid() and t.status = 'finalizada'
      and t.finalizada_em >= (v_inicio::timestamp at time zone 'America/Sao_Paulo')
      and t.finalizada_em < ((v_inicio + 7)::timestamp at time zone 'America/Sao_Paulo')
  ), dias as (
    select v_inicio + n as data, coalesce(sum(c.quantidade), 0)::integer as questoes
    from generate_series(0, 6) n left join concluidas c on c.dia = v_inicio + n group by n order by n
  )
  select jsonb_build_object('meta', (select quantidade_semanal from public.metas_estudo where "idPessoa" = auth.uid()),
    'respondidas', (select coalesce(sum(questoes), 0) from dias), 'simulados', (select count(*) from concluidas),
    'inicio_semana', v_inicio, 'fim_semana', v_inicio + 6, 'dias', (select jsonb_agg(to_jsonb(d)) from dias d)) into v_resultado;
  return v_resultado;
end $$;

revoke all on function public.resumo_revisao_odonto(), public.gerar_treino_odonto(integer,text),
  public.salvar_meta_semanal(integer), public.progresso_meta_semanal() from public, anon, authenticated;
grant execute on function public.resumo_revisao_odonto(), public.gerar_treino_odonto(integer,text),
  public.salvar_meta_semanal(integer), public.progresso_meta_semanal() to authenticated;
notify pgrst, 'reload schema';
