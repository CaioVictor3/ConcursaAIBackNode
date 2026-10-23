-- Mantem a mesma assinatura e corrige avisos de tipagem e sombra de variavel.
create or replace function public.cpf_valido(p_cpf text) returns boolean
language plpgsql immutable strict set search_path = '' as $$
declare v_soma integer; v_digito integer;
begin
  if p_cpf !~ '^[0-9]{11}$' or p_cpf = repeat(left(p_cpf, 1), 11) then
    return false;
  end if;
  for v_posicao in 1..2 loop
    v_soma := 0;
    for v_indice in 1..(8 + v_posicao) loop
      v_soma := v_soma + substr(p_cpf, v_indice, 1)::integer * (10 + v_posicao - v_indice);
    end loop;
    v_digito := 11 - (v_soma % 11);
    if v_digito >= 10 then v_digito := 0; end if;
    if v_digito <> substr(p_cpf, 9 + v_posicao, 1)::integer then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public.salvar_questao(p_questao jsonb, p_alternativas jsonb,
  p_gabarito jsonb, p_idQuestao uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_idQuestao uuid := coalesce(p_idQuestao, gen_random_uuid()); v_alternativa jsonb; v_idsAlternativas uuid[] := '{}'::uuid[];
begin
  if not public.eh_administrador() then raise exception 'Acesso negado'; end if;
  if jsonb_typeof(p_alternativas) <> 'array' or jsonb_array_length(p_alternativas) < 2 then
    raise exception 'Informe pelo menos duas alternativas'; end if;
  if p_idQuestao is not null and not exists(select 1 from public.questoes where "idQuestao" = p_idQuestao) then
    raise exception 'Questao nao encontrada'; end if;
  if p_idQuestao is not null and exists(select 1 from public.simulado_questoes sq
    join public.tentativas_simulado t on t."idSimulado" = sq."idSimulado"
    where sq."idQuestao" = p_idQuestao) then
    raise exception 'Questao com tentativas registradas nao pode ser editada'; end if;
  if p_idQuestao is not null and exists(select 1 from public.simulado_questoes sq
    join public.simulados s on s."idSimulado" = sq."idSimulado"
    where sq."idQuestao" = p_idQuestao and s.status = 'publicado') then
    raise exception 'Retire a questao dos simulados publicados antes de editar'; end if;
  insert into public.questoes("idQuestao", "idConcurso", "idBanca", "idDisciplina", "idAssunto",
    enunciado, tipo, dificuldade, ano, fonte, imagem_url, explicacao, status, "idPessoaCriadora")
  values(v_idQuestao, (p_questao->>'idConcurso')::uuid, (p_questao->>'idBanca')::uuid,
    (p_questao->>'idDisciplina')::uuid, (p_questao->>'idAssunto')::uuid,
    p_questao->>'enunciado', coalesce(p_questao->>'tipo','multipla_escolha'),
    p_questao->>'dificuldade', (p_questao->>'ano')::integer,
    coalesce(p_questao->>'fonte',''), p_questao->>'imagem_url',
    coalesce(p_questao->>'explicacao',''), p_questao->>'status', auth.uid())
  on conflict ("idQuestao") do update set "idConcurso" = excluded."idConcurso",
    "idBanca" = excluded."idBanca", "idDisciplina" = excluded."idDisciplina",
    "idAssunto" = excluded."idAssunto", enunciado = excluded.enunciado,
    dificuldade = excluded.dificuldade, ano = excluded.ano, fonte = excluded.fonte,
    imagem_url = excluded.imagem_url, explicacao = excluded.explicacao,
    status = excluded.status, atualizada_em = now();
  delete from public.gabaritos where "idQuestao" = v_idQuestao;
  delete from public.alternativas where "idQuestao" = v_idQuestao;
  for v_alternativa in select item from jsonb_array_elements(p_alternativas) as lista(item) loop
    insert into public.alternativas("idAlternativa", "idQuestao", letra, texto, ordem)
    values ((v_alternativa->>'idAlternativa')::uuid, v_idQuestao,
      upper(btrim(v_alternativa->>'letra')), v_alternativa->>'texto', (v_alternativa->>'ordem')::integer);
    v_idsAlternativas := array_append(v_idsAlternativas, (v_alternativa->>'idAlternativa')::uuid);
  end loop;
  if p_gabarito->>'status' <> 'anulada' and
     not ((p_gabarito->>'idAlternativaCorreta')::uuid = any(v_idsAlternativas)) then
    raise exception 'Gabarito invalido'; end if;
  insert into public.gabaritos("idQuestao", "idAlternativaCorreta", status, explicacao)
  values (v_idQuestao, (p_gabarito->>'idAlternativaCorreta')::uuid,
    p_gabarito->>'status', coalesce(p_gabarito->>'explicacao', ''));
  return v_idQuestao;
end $$;
