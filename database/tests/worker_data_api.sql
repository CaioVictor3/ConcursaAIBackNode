-- Executar como administrador. As alterações temporárias são revertidas;
-- este teste não faz chamadas ao Resend nem envia mensagens.
begin;
select set_config('concursa.teste_email',gen_random_uuid()::text,true),set_config('concursa.teste_reserva',gen_random_uuid()::text,true),set_config('concursa.teste_provedor','teste-'||gen_random_uuid()::text,true);
insert into comunicacao.emails_transacionais("idEmailTransacional",tipo_evento,email_destinatario,assunto,dados_template,maximo_tentativas,chave_idempotencia,agendado_em)
values(current_setting('concursa.teste_email')::uuid,'WELCOME_EMAIL','integracao@example.invalid','Teste transacional','{}',5,'teste/'||current_setting('concursa.teste_email'),'1900-01-01');
set local role service_role;
do $$
declare v_id uuid:=current_setting('concursa.teste_email')::uuid; v_reserva uuid:=current_setting('concursa.teste_reserva')::uuid; v_provedor text:=current_setting('concursa.teste_provedor'); v_dados jsonb;
begin
 v_dados:=public.operar_worker_email('reservarLoteEmailsPendentes',jsonb_build_object('limite',1,'tipos',jsonb_build_array('WELCOME_EMAIL'),'reserva',v_reserva,'segundos',120));
 if v_dados->'rows'->0->>'idEmailTransacional'<>v_id::text then raise exception 'Reserva não retornou o email temporário'; end if;
 v_dados:=public.operar_worker_email('confirmarEnvio',jsonb_build_object('id',v_id,'reserva',v_reserva,'provedor',v_provedor));
 if (v_dados->>'rowCount')::int<>1 then raise exception 'Confirmação não persistida'; end if;
 perform public.registrar_evento_resend_backend('webhook/'||v_id,v_provedor,'email.delivered');
end $$;
reset role;
do $$ begin
 if (select status from comunicacao.emails_transacionais where "idEmailTransacional"=current_setting('concursa.teste_email')::uuid)<>'entregue' then raise exception 'Entrega não registrada'; end if;
 update comunicacao.emails_transacionais set status='falha',id_mensagem_provedor=null,mensagem_erro='resend_http_401' where "idEmailTransacional"=current_setting('concursa.teste_email')::uuid;
end $$;
set local role service_role;
do $$ declare v_dados jsonb; begin
 v_dados:=public.operar_worker_email('reprocessarEmailFalho',jsonb_build_object('id',current_setting('concursa.teste_email')));
 if (v_dados->>'rowCount')::int<>1 then raise exception 'Reprocessamento não persistido'; end if;
end $$;
reset role;
do $$ begin
 if (select status from comunicacao.emails_transacionais where "idEmailTransacional"=current_setting('concursa.teste_email')::uuid)<>'pendente' then raise exception 'Status incorreto após reprocessamento'; end if;
end $$;
rollback;
select true as worker_transacional_validado,has_function_privilege('authenticated','public.operar_worker_email(text,jsonb)','execute') as aluno_pode_executar_worker;
