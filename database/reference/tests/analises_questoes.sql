-- Executar somente em banco LOCAL descartável após todas as migrations.
begin;
\ir fixtures/identidade_nativa.sql
\ir fixtures/acervo.sql
insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data)
select id, email, now(), jsonb_build_object('nome_completo', 'Teste IA', 'data_nascimento', '2000-01-01',
  'cpf', cpf, 'cep', '01001000', 'logradouro', 'Rua Teste', 'numero', '1', 'bairro', 'Centro', 'cidade', 'Teste', 'uf', 'SP')
from (values
  ('70000000-0000-0000-0000-000000000001'::uuid, 'ia-1@exemplo.invalid', '52998224725'),
  ('70000000-0000-0000-0000-000000000002'::uuid, 'ia-2@exemplo.invalid', '11144477735')
) u(id, email, cpf);
do $$
declare v_questao uuid; v_correta uuid; v_errada uuid;
begin
  select "idQuestao" into v_questao from public.questoes_elegiveis_odonto() limit 1;
  select "idAlternativaCorreta" into v_correta from public.gabaritos where "idQuestao" = v_questao;
  select "idAlternativa" into v_errada from public.alternativas where "idQuestao" = v_questao and "idAlternativa" <> v_correta limit 1;
  perform set_config('teste.ia_questao', v_questao::text, true);
  perform set_config('teste.ia_correta', v_correta::text, true);
  perform set_config('teste.ia_errada', v_errada::text, true);
  insert into public.simulados("idSimulado", nome, status, publico, tipo) values('70000000-0000-0000-0000-000000000010', 'Teste IA', 'publicado', true, 'padrao');
  insert into public.simulado_questoes("idSimulado", "idQuestao", ordem) values('70000000-0000-0000-0000-000000000010', v_questao, 1);
end $$;
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
set local role concursa_dados;
do $$
declare v_tentativa uuid; v_contexto jsonb; v_negado boolean := false;
begin
  v_tentativa := public.iniciar_tentativa('70000000-0000-0000-0000-000000000010');
  perform set_config('teste.ia_tentativa', v_tentativa::text, true);
  perform public.responder_questao(v_tentativa, current_setting('teste.ia_questao')::uuid, current_setting('teste.ia_errada')::uuid);
  begin perform public.contexto_analise_questao(v_tentativa, current_setting('teste.ia_questao')::uuid);
    exception when raise_exception then v_negado := true; end;
  assert v_negado, 'Revelou gabarito antes da finalização';
  perform public.finalizar_tentativa(v_tentativa);
  v_contexto := public.contexto_analise_questao(v_tentativa, current_setting('teste.ia_questao')::uuid);
  assert v_contexto->'contexto'->>'idAlternativaSelecionada' = current_setting('teste.ia_errada');
  assert v_contexto->'contexto'->>'idAlternativaCorreta' = current_setting('teste.ia_correta');
  assert jsonb_array_length(v_contexto->'contexto'->'alternativas') >= 2;
  perform set_config('teste.ia_hash', v_contexto->>'hash', true);
  assert public.consultar_analise_questao(v_tentativa, current_setting('teste.ia_questao')::uuid) is null, 'Gerou análise automaticamente';
  assert (public.listar_questoes_revisao()->>'total')::int = 1;
  assert jsonb_array_length(public.listar_questoes_revisao(2)->'itens') = 0;
  assert not has_function_privilege('authenticated', 'public.reservar_analise_questao(uuid,uuid,text)', 'execute');
  assert not has_function_privilege('anon', 'public.contexto_analise_questao(uuid,uuid)', 'execute');
  assert not has_table_privilege('authenticated', 'public.analises_questoes', 'insert');
  assert not has_table_privilege('authenticated', 'public.analises_questoes', 'update');
  assert not has_table_privilege('authenticated', 'public.limites_analises_ia', 'select');
end $$;
do $$
declare v_reserva jsonb;v_negado boolean:=false;
begin
  v_reserva:=public.reservar_analise_backend(current_setting('teste.ia_tentativa')::uuid,current_setting('teste.ia_questao')::uuid);
  assert v_reserva->>'idSolicitacao' is not null;
  assert v_reserva->'contexto'->>'idQuestao'=current_setting('teste.ia_questao');
  perform set_config('teste.ia_solicitacao',v_reserva->>'idSolicitacao',true);
  begin perform public.reservar_analise_backend(current_setting('teste.ia_tentativa')::uuid,current_setting('teste.ia_questao')::uuid);
    exception when raise_exception then v_negado:=true; end;
  assert v_negado,'Permitiu solicitações simultâneas';
  assert not public.salvar_analise_backend(current_setting('teste.ia_questao')::uuid,gen_random_uuid(),'{"resumo":"Teste"}','modelo-teste',false),'Aceitou solicitação incorreta';
  assert public.salvar_analise_backend(current_setting('teste.ia_questao')::uuid,(v_reserva->>'idSolicitacao')::uuid,'{"resumo":"Teste"}','modelo-teste',false);
  assert not public.salvar_analise_backend(current_setting('teste.ia_questao')::uuid,(v_reserva->>'idSolicitacao')::uuid,'{"resumo":"Mudança"}','modelo-teste',false),'Alterou análise concluída';
  v_reserva:=public.reservar_analise_backend(current_setting('teste.ia_tentativa')::uuid,current_setting('teste.ia_questao')::uuid);
  assert v_reserva->'analise'->>'modelo'='modelo-teste';
  assert not has_function_privilege('authenticated','public.reservar_analise_backend(uuid,uuid)','execute');
end $$;
reset role;
do $$ begin assert (select solicitacoes=1 from public.limites_analises_ia where "idUsuario"='70000000-0000-0000-0000-000000000001'),'Cache consumiu cota'; end $$;
reset role;
set local role concursa_dados;
do $$ begin
  assert public.consultar_analise_questao(current_setting('teste.ia_tentativa')::uuid, current_setting('teste.ia_questao')::uuid)->>'modelo' = 'modelo-teste';
  assert (select count(*) = 1 from public.analises_questoes);
end $$;
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000002', true);
do $$ declare v_negado boolean := false; begin
  assert (select count(*) = 0 from public.analises_questoes), 'Vazou análise de outro aluno';
  assert (public.listar_questoes_revisao()->>'total')::int = 0;
  begin perform public.contexto_analise_questao(current_setting('teste.ia_tentativa')::uuid, current_setting('teste.ia_questao')::uuid);
    exception when raise_exception then v_negado := true; end;
  assert v_negado, 'Consultou contexto de outro aluno';
end $$;
reset role;
-- Gabarito correto e resposta em branco não oferecem análise.
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
set local role concursa_dados;
do $$ declare v_tentativa uuid; v_negado boolean; v_resposta uuid; begin
  foreach v_resposta in array array[current_setting('teste.ia_correta')::uuid, null::uuid] loop
    v_tentativa := public.iniciar_tentativa('70000000-0000-0000-0000-000000000010');
    if v_resposta is not null then perform public.responder_questao(v_tentativa, current_setting('teste.ia_questao')::uuid, v_resposta); end if;
    perform public.finalizar_tentativa(v_tentativa);
    v_negado := false;
    begin perform public.contexto_analise_questao(v_tentativa, current_setting('teste.ia_questao')::uuid);
      exception when raise_exception then v_negado := true; end;
    assert v_negado, 'Aceitou acerto ou branco';
  end loop;
end $$;
reset role;
set local role service_role;
do $$ declare v_i integer; v_negado boolean := false; v_reserva jsonb; begin
  for v_i in 2..20 loop
    update public.analises_questoes set status = 'falha' where "idUsuario" = '70000000-0000-0000-0000-000000000001';
    perform public.reservar_analise_questao('70000000-0000-0000-0000-000000000001', current_setting('teste.ia_questao')::uuid, 'novo-contexto-' || v_i);
  end loop;
  update public.analises_questoes set status = 'falha' where "idUsuario" = '70000000-0000-0000-0000-000000000001';
  begin perform public.reservar_analise_questao('70000000-0000-0000-0000-000000000001', current_setting('teste.ia_questao')::uuid, 'limite');
    exception when raise_exception then v_negado := true; end;
  assert v_negado, 'Limite diário não aplicado';
  update public.limites_analises_ia set dia = dia - 1;
  v_reserva := public.reservar_analise_questao('70000000-0000-0000-0000-000000000001', current_setting('teste.ia_questao')::uuid, 'dia-novo');
  assert (select solicitacoes = 1 from public.limites_analises_ia where "idUsuario" = '70000000-0000-0000-0000-000000000001'), 'Não renovou limite';
  update public.analises_questoes set iniciada_em = now() - interval '3 minutes';
  perform public.reservar_analise_questao('70000000-0000-0000-0000-000000000001', current_setting('teste.ia_questao')::uuid, 'nova-tentativa');
  assert (select "idSolicitacao" <> (v_reserva->>'idSolicitacao')::uuid from public.analises_questoes where "idUsuario" = '70000000-0000-0000-0000-000000000001'), 'Reserva expirada não renovada';
end $$;
reset role;
rollback;
