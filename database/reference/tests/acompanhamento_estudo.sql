-- Somente em banco LOCAL descartável, após todas as migrations. Tudo é revertido.
begin;
\ir fixtures/identidade_nativa.sql
\ir fixtures/acervo.sql
insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data)
select id, email, now(), jsonb_build_object('nome_completo', 'Teste Revisão',
  'data_nascimento', '2000-01-01', 'cpf', cpf, 'cep', '01001000',
  'logradouro', 'Rua de Teste', 'numero', '1', 'bairro', 'Centro', 'cidade', 'Teste', 'uf', 'SP')
from (values
  ('10000000-0000-0000-0000-000000000001'::uuid, 'revisao-1@exemplo.invalid', '52998224725'),
  ('10000000-0000-0000-0000-000000000002'::uuid, 'revisao-2@exemplo.invalid', '11144477735')
) as usuarios(id, email, cpf);

-- Três questões conhecidas: duas de um assunto e uma de outro.
do $$
declare v_assunto uuid; v_ids uuid[]; v_outro uuid; v_i integer; v_correta uuid; v_errada uuid;
begin
  select "idAssunto" into v_assunto from public.questoes_elegiveis_odonto() group by "idAssunto" having count(*) >= 2 limit 1;
  select array_agg(x."idQuestao") into v_ids from (select "idQuestao" from public.questoes_elegiveis_odonto() where "idAssunto" = v_assunto limit 2) x;
  select "idQuestao" into v_outro from public.questoes_elegiveis_odonto() where "idAssunto" <> v_assunto limit 1;
  v_ids := array_append(v_ids, v_outro);
  insert into public.simulados("idSimulado", nome, status, publico, tipo)
    values('60000000-0000-0000-0000-000000000001', 'Teste de revisão', 'publicado', true, 'padrao');
  for v_i in 1..3 loop
    insert into public.simulado_questoes("idSimulado", "idQuestao", ordem) values('60000000-0000-0000-0000-000000000001', v_ids[v_i], v_i);
    select "idAlternativaCorreta" into v_correta from public.gabaritos where "idQuestao" = v_ids[v_i];
    select "idAlternativa" into v_errada from public.alternativas where "idQuestao" = v_ids[v_i] and "idAlternativa" <> v_correta limit 1;
    perform set_config('teste.q' || v_i, v_ids[v_i]::text, true);
    perform set_config('teste.c' || v_i, v_correta::text, true);
    perform set_config('teste.e' || v_i, v_errada::text, true);
  end loop;
end $$;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role concursa_dados;
do $$
declare v_id uuid; v_negado boolean; v_num integer;
begin
  assert (public.resumo_revisao_odonto()->>'pendentes')::integer = 0;
  assert public.progresso_meta_semanal()->>'meta' is null;
  perform public.salvar_meta_semanal(25);
  foreach v_num in array array[0, -1, 2001, null] loop
    v_negado := false;
    begin perform public.salvar_meta_semanal(v_num); exception when raise_exception or insufficient_privilege then v_negado := true; end;
    assert v_negado, 'Meta inválida aceita';
  end loop;
  assert (public.progresso_meta_semanal()->>'meta')::integer = 25;
  v_id := public.iniciar_tentativa('60000000-0000-0000-0000-000000000001');
  perform set_config('teste.primeira', v_id::text, true);
  perform public.responder_questao(v_id, current_setting('teste.q1')::uuid, current_setting('teste.c1')::uuid);
  perform public.responder_questao(v_id, current_setting('teste.q2')::uuid, current_setting('teste.e2')::uuid);
  assert (public.resumo_revisao_odonto()->>'pendentes')::integer = 0, 'Incluiu tentativa em andamento';
  assert (public.progresso_meta_semanal()->>'respondidas')::integer = 0, 'Contou treino não finalizado';
  perform public.finalizar_tentativa(v_id);
  assert (public.resumo_revisao_odonto()->>'pendentes')::integer = 2, 'Erro e branco devem entrar na revisão';
  assert (select sum((a->>'quantidade')::integer) = 2 from jsonb_array_elements(public.resumo_revisao_odonto()->'assuntos') a);
  assert (public.progresso_meta_semanal()->>'respondidas')::integer = 2, 'Contou questão em branco';
  assert jsonb_array_length(public.progresso_meta_semanal()->'dias') = 7;
  foreach v_num in array array[0, -1, 3, null] loop
    v_negado := false;
    begin perform public.gerar_treino_odonto(v_num, 'revisao'); exception when raise_exception or insufficient_privilege then v_negado := true; end;
    assert v_negado, 'Quantidade de revisão inválida aceita';
  end loop;
  v_negado := false;
  begin perform public.gerar_treino_odonto(1, 'invalido'); exception when raise_exception or insufficient_privilege then v_negado := true; end;
  assert v_negado, 'Modo inválido aceito';
  v_id := public.gerar_treino_odonto(1, 'recomendado');
  assert (select q."idTema" = (select "idTema" from public.questoes where "idQuestao" = current_setting('teste.q3')::uuid)
    from public.tentativas_simulado t join public.simulado_questoes sq using ("idSimulado") join public.questoes q using ("idQuestao") where t."idTentativa" = v_id), 'Não priorizou o assunto com mais dificuldade';
end $$;
reset role;
-- Ordenação temporal explícita, mesmo com now() constante na transação de teste.
update public.tentativas_simulado set finalizada_em = now() - interval '1 second'
  where "idTentativa" = current_setting('teste.primeira')::uuid;
set local role concursa_dados;
do $$
declare v_id uuid; v_questao uuid; v_correta uuid;
begin
  v_id := public.gerar_treino_odonto(2, 'revisao');
  perform set_config('teste.revisao', v_id::text, true);
  assert (select count(*) = 2 and count(distinct sq."idQuestao") = 2 from public.tentativas_simulado t join public.simulado_questoes sq using ("idSimulado") where t."idTentativa" = v_id), 'Revisão repetiu questões';
  assert not exists(select 1 from public.tentativas_simulado t join public.simulado_questoes sq using ("idSimulado") where t."idTentativa" = v_id and sq."idQuestao" = current_setting('teste.q1')::uuid), 'Incluiu questão já correta';
  v_questao := current_setting('teste.q2')::uuid; v_correta := current_setting('teste.c2')::uuid;
  perform public.responder_questao(v_id, v_questao, v_correta);
  perform public.responder_questao(v_id, current_setting('teste.q3')::uuid, current_setting('teste.c3')::uuid);
  perform public.finalizar_tentativa(v_id);
  assert (public.resumo_revisao_odonto()->>'pendentes')::integer = 0, 'Acertos não resolveram pendências';
  assert (public.resumo_revisao_odonto()->>'recuperadas')::integer = 2, 'Recuperadas incorretas';
  assert (public.progresso_meta_semanal()->>'respondidas')::integer = 4, 'Repetições em novos treinos não contadas';
  assert (public.progresso_meta_semanal()->>'simulados')::integer = 2, 'Contou treino recomendado em andamento';
  assert not has_table_privilege('authenticated', 'public.metas_estudo', 'INSERT'), 'Escrita direta na meta';
end $$;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
do $$ begin
  assert (public.resumo_revisao_odonto()->>'pendentes')::integer = 0;
  assert (public.resumo_revisao_odonto()->>'recuperadas')::integer = 0;
  assert public.progresso_meta_semanal()->>'meta' is null;
  assert (public.progresso_meta_semanal()->>'respondidas')::integer = 0;
  assert not exists(select 1 from public.metas_estudo), 'RLS expôs meta alheia';
  assert not exists(select 1 from public.tentativas_simulado where "idTentativa" = current_setting('teste.revisao')::uuid), 'Revisão alheia exposta';
end $$;
reset role;
update public.usuarios set estado_cadastro = 'verificacao_pendente' where "idPessoa" = '10000000-0000-0000-0000-000000000002';
set local role concursa_dados;
do $$ declare v_negado boolean := false; begin
  begin perform public.salvar_meta_semanal(10); exception when raise_exception or insufficient_privilege then v_negado := true; end;
  assert v_negado, 'Cadastro pendente salvou meta';
  v_negado := false;
  begin perform public.gerar_treino_odonto(1, 'recomendado'); exception when raise_exception or insufficient_privilege then v_negado := true; end;
  assert v_negado, 'Cadastro pendente gerou treino';
end $$;
reset role;
do $$ begin
  assert not has_function_privilege('anon', 'public.gerar_treino_odonto(integer,text)', 'EXECUTE');
  assert not has_function_privilege('anon', 'public.resumo_revisao_odonto()', 'EXECUTE');
  assert not has_function_privilege('anon', 'public.salvar_meta_semanal(integer)', 'EXECUTE');
  assert not has_function_privilege('anon', 'public.progresso_meta_semanal()', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'public.ultimas_correcoes_odonto()', 'EXECUTE');
end $$;
rollback;
