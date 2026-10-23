-- Classifica o acervo sem vincular o sorteio a nomes de disciplinas.
-- Novas áreas podem ser cadastradas neste campo quando forem ofertadas.
alter table public.disciplinas add column area text;
update public.disciplinas d set area = 'odontologia'
where exists(select 1 from public.questoes q where q."idDisciplina" = d."idDisciplina"
    and q.fonte like 'Apostila Questões Concurso Público – PPGO/UFU (2023)%')
   or d.nome = 'Conhecimentos Específicos em Odontologia';
create index on public.simulados("idPessoaCriadora");

drop policy simulados_leitura on public.simulados;
create policy simulados_leitura on public.simulados for select to authenticated
  using ((status = 'publicado' and (publico or "idPessoaCriadora" = (select auth.uid())))
    or (select public.eh_administrador()));

create function public.quantidade_questoes_odonto() returns integer
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.perfis p join public.estudantes e on e."idEstudante" = p."idPessoa"
    where p."idPessoa" = auth.uid() and p.estado_cadastro = 'ativo' and p.cadastro_completo) then
    raise exception 'Cadastro de estudante ativo e completo necessário'; end if;
  return (select count(*)::integer from public.questoes q
    join public.disciplinas d on d."idDisciplina" = q."idDisciplina"
    where q.status = 'publicada' and d.ativa and d.area = 'odontologia'
      and (select count(*) from public.alternativas a where a."idQuestao" = q."idQuestao") >= 2
      and exists(select 1 from public.gabaritos g join public.alternativas a
        on a."idQuestao" = g."idQuestao" and a."idAlternativa" = g."idAlternativaCorreta"
        where g."idQuestao" = q."idQuestao" and g.status <> 'anulada'));
end $$;

create function public.gerar_simulado_odonto(p_quantidade integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_idPessoa uuid := auth.uid(); v_idsQuestoes uuid[];
  v_idSimulado uuid; v_idTentativa uuid; v_disponiveis integer;
begin
  if not exists(select 1 from public.perfis p join public.estudantes e on e."idEstudante" = p."idPessoa"
    where p."idPessoa" = v_idPessoa and p.estado_cadastro = 'ativo' and p.cadastro_completo) then
    raise exception 'Cadastro de estudante ativo e completo necessário'; end if;
  if p_quantidade is null or p_quantidade < 1 then
    raise exception 'Informe uma quantidade inteira de pelo menos 1 questão'; end if;

  -- Seleciona no banco inteiro, sem paginação e sem repetição na mesma tentativa.
  -- O bloqueio mantém os itens elegíveis até a tentativa estar gravada.
  select array_agg(sorteio."idQuestao" order by sorteio.posicao) into v_idsQuestoes
  from (
    select q."idQuestao", random() as posicao from public.questoes q
    join public.disciplinas d on d."idDisciplina" = q."idDisciplina"
    where q.status = 'publicada' and d.ativa and d.area = 'odontologia'
      and (select count(*) from public.alternativas a where a."idQuestao" = q."idQuestao") >= 2
      and exists(select 1 from public.gabaritos g join public.alternativas a
        on a."idQuestao" = g."idQuestao" and a."idAlternativa" = g."idAlternativaCorreta"
        where g."idQuestao" = q."idQuestao" and g.status <> 'anulada')
    order by posicao limit p_quantidade for share of q, d
  ) as sorteio;
  v_disponiveis := coalesce(cardinality(v_idsQuestoes), 0);
  if v_disponiveis < p_quantidade then
    raise exception 'Há apenas % questões de Odontologia disponíveis', v_disponiveis; end if;

  insert into public.simulados(nome, descricao, tipo, publico, status, "idPessoaCriadora")
  values ('Odontologia · ' || p_quantidade || case when p_quantidade = 1 then ' questão' else ' questões' end,
    'Simulado pessoal com questões sorteadas de Odontologia.', 'personalizado', false, 'publicado', v_idPessoa)
  returning "idSimulado" into v_idSimulado;
  insert into public.simulado_questoes("idSimulado", "idQuestao", ordem)
    select v_idSimulado, item, ordem::integer from unnest(v_idsQuestoes) with ordinality as itens(item, ordem);
  insert into public.tentativas_simulado("idSimulado", "idPessoa")
    values(v_idSimulado, v_idPessoa) returning "idTentativa" into v_idTentativa;
  return v_idTentativa;
end $$;

create or replace function public.iniciar_tentativa(p_idSimulado uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_idTentativa uuid;
begin
  if not exists(select 1 from public.perfis p join public.estudantes e on e."idEstudante" = p."idPessoa"
    where p."idPessoa" = auth.uid() and p.estado_cadastro = 'ativo' and p.cadastro_completo) then
    raise exception 'Cadastro de estudante ativo e completo necessário'; end if;
  if not exists(select 1 from public.simulados where "idSimulado" = p_idSimulado
    and status = 'publicado' and (publico or "idPessoaCriadora" = auth.uid())) then
    raise exception 'Simulado indisponível'; end if;
  insert into public.tentativas_simulado("idSimulado", "idPessoa")
    values(p_idSimulado, auth.uid()) returning "idTentativa" into v_idTentativa;
  return v_idTentativa;
end $$;

revoke all on function public.quantidade_questoes_odonto() from public, anon, authenticated;
revoke all on function public.gerar_simulado_odonto(integer) from public, anon, authenticated;
grant execute on function public.quantidade_questoes_odonto() to authenticated;
grant execute on function public.gerar_simulado_odonto(integer) to authenticated;
