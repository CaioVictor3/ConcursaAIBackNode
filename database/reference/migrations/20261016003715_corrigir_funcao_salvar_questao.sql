-- Corrige a inicializacao do array UUID identificada pelo lint remoto.
create or replace function public.salvar_questao(p_questao jsonb, p_alternativas jsonb,
  p_gabarito jsonb, p_id uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_alt jsonb; v_ids uuid[] := array[]::uuid[];
begin
  if not public.eh_administrador() then raise exception 'Acesso negado'; end if;
  if jsonb_typeof(p_alternativas) <> 'array' or jsonb_array_length(p_alternativas) < 2 then
    raise exception 'Informe pelo menos duas alternativas'; end if;
  if p_id is not null and not exists(select 1 from public.questoes where id = p_id) then
    raise exception 'Questao nao encontrada'; end if;
  if p_id is not null and exists(select 1 from public.simulado_questoes sq
      join public.tentativas_simulado t on t.simulado_id = sq.simulado_id
      where sq.questao_id = p_id) then
    raise exception 'Questao com tentativas registradas nao pode ser editada'; end if;
  if p_id is not null and exists(select 1 from public.simulado_questoes sq
      join public.simulados s on s.id = sq.simulado_id
      where sq.questao_id = p_id and s.status = 'publicado') then
    raise exception 'Retire a questao dos simulados publicados antes de editar'; end if;
  insert into public.questoes(id, concurso_id, banca_id, disciplina_id, assunto_id,
    enunciado, tipo, dificuldade, ano, fonte, imagem_url, explicacao, status, criada_por)
  values(v_id, (p_questao->>'concurso_id')::uuid, (p_questao->>'banca_id')::uuid,
    (p_questao->>'disciplina_id')::uuid, (p_questao->>'assunto_id')::uuid,
    p_questao->>'enunciado', coalesce(p_questao->>'tipo','multipla_escolha'),
    p_questao->>'dificuldade', (p_questao->>'ano')::integer,
    coalesce(p_questao->>'fonte',''), p_questao->>'imagem_url',
    '', p_questao->>'status', auth.uid())
  on conflict (id) do update set concurso_id = excluded.concurso_id,
    banca_id = excluded.banca_id, disciplina_id = excluded.disciplina_id,
    assunto_id = excluded.assunto_id, enunciado = excluded.enunciado,
    dificuldade = excluded.dificuldade, ano = excluded.ano, fonte = excluded.fonte,
    imagem_url = excluded.imagem_url, explicacao = excluded.explicacao,
    status = excluded.status, atualizada_em = now();
  delete from public.gabaritos where questao_id = v_id;
  delete from public.alternativas where questao_id = v_id;
  for v_alt in select item from jsonb_array_elements(p_alternativas) as lista(item) loop
    insert into public.alternativas(id, questao_id, letra, texto, ordem)
    values ((v_alt->>'id')::uuid, v_id, upper(btrim(v_alt->>'letra')),
      v_alt->>'texto', (v_alt->>'ordem')::integer);
    v_ids := array_append(v_ids, (v_alt->>'id')::uuid);
  end loop;
  if p_gabarito->>'status' <> 'anulada' and
     not ((p_gabarito->>'alternativa_correta_id')::uuid = any(v_ids)) then
    raise exception 'Gabarito invalido'; end if;
  insert into public.gabaritos(questao_id, alternativa_correta_id, status, explicacao)
  values (v_id, (p_gabarito->>'alternativa_correta_id')::uuid,
    p_gabarito->>'status', coalesce(p_gabarito->>'explicacao', ''));
  return v_id;
end $$;
