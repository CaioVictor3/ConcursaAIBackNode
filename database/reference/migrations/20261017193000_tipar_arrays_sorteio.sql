-- Tipos explícitos para os arrays vazios: elimina os avisos do plpgsql_check.
-- CREATE OR REPLACE preserva as permissões da função já publicada.
create or replace function public.gerar_simulado_odonto(p_quantidade integer, p_assuntos jsonb default '[]'::jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_pessoa uuid := auth.uid(); v_pool uuid[]; v_selecionadas uuid[] := '{}'::uuid[]; v_sorteio uuid[];
  v_assuntos uuid[] := '{}'::uuid[]; v_item jsonb; v_id uuid; v_cota integer; v_soma bigint := 0;
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
  v_pool := coalesce(v_pool, '{}'::uuid[]);
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
    select coalesce(array_agg(x."idQuestao"), '{}'::uuid[]) into v_sorteio from (
      select q."idQuestao" from public.questoes q where q."idQuestao" = any(v_pool) and q."idAssunto" = v_id
      order by random() limit v_cota
    ) x;
    if cardinality(v_sorteio) <> v_cota then raise exception 'Quantidade indisponível para um dos assuntos selecionados'; end if;
    v_selecionadas := v_selecionadas || v_sorteio;
  end loop;
  -- Cotas são exatas, inclusive zero. O restante vem apenas de assuntos sem cota.
  select coalesce(array_agg(x."idQuestao"), '{}'::uuid[]) into v_sorteio from (
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

notify pgrst, 'reload schema';
