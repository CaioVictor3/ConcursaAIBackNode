-- A tabela assuntos é o catálogo de categorias de questões, vinculado a disciplinas.
-- O acervo antigo só informa a disciplina: não inferimos classificações clínicas.
insert into public.assuntos ("idDisciplina", nome, descricao)
select d."idDisciplina", 'Conteúdo geral', 'Classificação inicial do acervo; revisar no cadastro da questão.'
from public.disciplinas d
where exists(select 1 from public.questoes q where q."idDisciplina" = d."idDisciplina" and q."idAssunto" is null)
  and not exists(select 1 from public.assuntos a where a."idDisciplina" = d."idDisciplina" and a.nome = 'Conteúdo geral');
update public.questoes q set "idAssunto" = (
  select a."idAssunto" from public.assuntos a where a."idDisciplina" = q."idDisciplina" and a.nome = 'Conteúdo geral'
  order by a."idAssunto" limit 1
) where q."idAssunto" is null;
alter table public.questoes alter column "idAssunto" set not null;
comment on table public.assuntos is 'Categorias (assuntos) das questões. Cada categoria pertence a uma disciplina.';
create index questoes_assunto_status_idx on public.questoes("idAssunto", status);

-- Auxiliar privado: evita divergência entre disponibilidade e sorteio.
create function public.questoes_elegiveis_odonto()
returns table ("idQuestao" uuid, "idAssunto" uuid, "idDisciplina" uuid)
language sql stable security definer set search_path = '' as $$
  select q."idQuestao", q."idAssunto", q."idDisciplina" from public.questoes q
  join public.disciplinas d on d."idDisciplina" = q."idDisciplina"
  where q.status = 'publicada' and d.ativa and d.area = 'odontologia'
    and (select count(*) from public.alternativas a where a."idQuestao" = q."idQuestao") >= 2
    and exists(select 1 from public.gabaritos g join public.alternativas a
      on a."idQuestao" = g."idQuestao" and a."idAlternativa" = g."idAlternativaCorreta"
      where g."idQuestao" = q."idQuestao" and g.status <> 'anulada');
$$;
revoke all on function public.questoes_elegiveis_odonto() from public, anon, authenticated;

create function public.disponibilidade_assuntos_odonto()
returns table ("idAssunto" uuid, assunto text, "idDisciplina" uuid, disciplina text, quantidade integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.perfis p join public.estudantes e on e."idEstudante" = p."idPessoa"
    where p."idPessoa" = auth.uid() and p.estado_cadastro = 'ativo' and p.cadastro_completo) then
    raise exception 'Cadastro de estudante ativo e completo necessário'; end if;
  return query select a."idAssunto", a.nome, d."idDisciplina", d.nome, count(q."idQuestao")::integer
    from public.assuntos a join public.disciplinas d on d."idDisciplina" = a."idDisciplina"
    left join public.questoes_elegiveis_odonto() q on q."idAssunto" = a."idAssunto"
    where d.ativa and d.area = 'odontologia'
    group by a."idAssunto", d."idDisciplina" order by d.nome, a.nome;
end $$;

create or replace function public.quantidade_questoes_odonto() returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(quantidade), 0)::integer from public.disponibilidade_assuntos_odonto();
$$;

-- Substitui a assinatura antiga, evitando ambiguidade de overload no PostgREST.
drop function public.gerar_simulado_odonto(integer);
create function public.gerar_simulado_odonto(p_quantidade integer, p_assuntos jsonb default '[]'::jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_pessoa uuid := auth.uid(); v_pool uuid[]; v_selecionadas uuid[] := '{}'; v_sorteio uuid[];
  v_assuntos uuid[] := '{}'; v_item jsonb; v_id uuid; v_cota integer; v_soma bigint := 0;
  v_simulado uuid; v_tentativa uuid;
begin
  -- Também valida a sessão antes de consultar qualquer questão.
  perform public.quantidade_questoes_odonto();
  if p_quantidade is null or p_quantidade < 1 then
    raise exception 'Informe uma quantidade inteira de pelo menos 1 questão'; end if;
  if p_assuntos is null or jsonb_typeof(p_assuntos) <> 'array' then
    raise exception 'Informe uma lista válida de assuntos'; end if;

  select array_agg(x."idQuestao") into v_pool from (
    select q."idQuestao" from public.questoes q
    join public.disciplinas d on d."idDisciplina" = q."idDisciplina"
    join public.questoes_elegiveis_odonto() e on e."idQuestao" = q."idQuestao"
    order by q."idQuestao" for share of q, d
  ) x;
  v_pool := coalesce(v_pool, '{}');
  if p_quantidade > cardinality(v_pool) then
    raise exception 'Há apenas % questões de Odontologia disponíveis', cardinality(v_pool); end if;

  for v_item in select value from jsonb_array_elements(p_assuntos) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item->'quantidade') is distinct from 'number'
      or (v_item->>'quantidade')::numeric < 0 or (v_item->>'quantidade')::numeric > p_quantidade
      or trunc((v_item->>'quantidade')::numeric) <> (v_item->>'quantidade')::numeric then
      raise exception 'A quantidade por assunto deve ser inteira, não negativa e menor ou igual ao total'; end if;
    select a."idAssunto" into v_id from public.assuntos a join public.disciplinas d on d."idDisciplina" = a."idDisciplina"
      where a."idAssunto"::text = v_item->>'idAssunto' and d.ativa and d.area = 'odontologia';
    if v_id is null then raise exception 'Assunto indisponível para Odontologia'; end if;
    if v_id = any(v_assuntos) then raise exception 'Há assuntos repetidos na distribuição'; end if;
    v_assuntos := array_append(v_assuntos, v_id);
    v_cota := (v_item->>'quantidade')::integer;
    v_soma := v_soma + v_cota;
    if v_soma > p_quantidade then raise exception 'A soma por assunto ultrapassa o total de questões'; end if;
    select coalesce(array_agg(x."idQuestao"), '{}') into v_sorteio from (
      select q."idQuestao" from public.questoes q where q."idQuestao" = any(v_pool) and q."idAssunto" = v_id
      order by random() limit v_cota
    ) x;
    if cardinality(v_sorteio) <> v_cota then raise exception 'Quantidade indisponível para um dos assuntos selecionados'; end if;
    v_selecionadas := v_selecionadas || v_sorteio;
  end loop;
  -- Cotas são exatas, inclusive zero. O restante vem apenas de assuntos sem cota.
  select coalesce(array_agg(x."idQuestao"), '{}') into v_sorteio from (
    select q."idQuestao" from public.questoes q where q."idQuestao" = any(v_pool) and not(q."idAssunto" = any(v_assuntos))
    order by random() limit (p_quantidade - v_soma)
  ) x;
  v_selecionadas := v_selecionadas || v_sorteio;
  if cardinality(v_selecionadas) <> p_quantidade then
    raise exception 'Os demais assuntos não têm questões suficientes para completar o total. Ajuste a distribuição'; end if;
  select array_agg(id order by random()) into v_selecionadas from unnest(v_selecionadas) as itens(id);

  insert into public.simulados(nome, descricao, tipo, publico, status, "idPessoaCriadora")
    values ('Odontologia · ' || p_quantidade || case when p_quantidade = 1 then ' questão' else ' questões' end,
      'Simulado pessoal com questões sorteadas por assunto.', 'personalizado', false, 'publicado', v_pessoa)
    returning "idSimulado" into v_simulado;
  insert into public.simulado_questoes("idSimulado", "idQuestao", ordem)
    select v_simulado, item, ordem::integer from unnest(v_selecionadas) with ordinality as itens(item, ordem);
  insert into public.tentativas_simulado("idSimulado", "idPessoa") values(v_simulado, v_pessoa)
    returning "idTentativa" into v_tentativa;
  return v_tentativa;
end $$;

-- Agrega apenas correções finalizadas do usuário autenticado; não retorna gabaritos.
create function public.estatisticas_assuntos()
returns table ("idAssunto" uuid, assunto text, "idDisciplina" uuid, disciplina text,
  avaliadas integer, acertos integer, erros integer, em_branco integer)
language sql stable security definer set search_path = '' as $$
  select a."idAssunto", a.nome, d."idDisciplina", d.nome, count(*)::integer,
    count(*) filter (where (i->>'acertou')::boolean)::integer,
    count(*) filter (where not (i->>'acertou')::boolean and i->>'idAlternativaSelecionada' is not null)::integer,
    count(*) filter (where not (i->>'acertou')::boolean and i->>'idAlternativaSelecionada' is null)::integer
  from public.tentativas_simulado t cross join lateral jsonb_array_elements(t.correcao_json) i
  join public.questoes q on q."idQuestao" = (i->>'idQuestao')::uuid
  join public.assuntos a on a."idAssunto" = q."idAssunto"
  join public.disciplinas d on d."idDisciplina" = a."idDisciplina"
  where t."idPessoa" = auth.uid() and t.status = 'finalizada'
  group by a."idAssunto", d."idDisciplina" order by d.nome, a.nome;
$$;

revoke all on function public.disponibilidade_assuntos_odonto(), public.gerar_simulado_odonto(integer,jsonb), public.estatisticas_assuntos() from public, anon, authenticated;
grant execute on function public.disponibilidade_assuntos_odonto(), public.gerar_simulado_odonto(integer,jsonb), public.estatisticas_assuntos() to authenticated;
notify pgrst, 'reload schema';
