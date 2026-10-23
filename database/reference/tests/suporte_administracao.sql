-- Somente em banco LOCAL descartável, após todas as migrations. Escritas revertidas.
begin;
\ir fixtures/identidade_nativa.sql
insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data)
select id, email, case when pendente then null else now() end,
  jsonb_build_object('nome_completo', 'Teste Suporte', 'data_nascimento', '2000-01-01', 'cpf', cpf,
    'cep', '01001000', 'logradouro', 'Rua Teste', 'numero', '1', 'bairro', 'Centro', 'cidade', 'Teste', 'uf', 'SP', 'tipo', 'administrador')
from (values
  ('20000000-0000-0000-0000-000000000001'::uuid, 'suporte-admin@exemplo.invalid', '52998224725', false),
  ('20000000-0000-0000-0000-000000000002'::uuid, 'suporte-aluno@exemplo.invalid', '11144477735', false),
  ('20000000-0000-0000-0000-000000000003'::uuid, 'suporte-outro@exemplo.invalid', '12345678909', false),
  ('20000000-0000-0000-0000-000000000004'::uuid, 'suporte-pendente@exemplo.invalid', '93541134780', true)
) as usuarios(id, email, cpf, pendente);
update public.usuarios set tipo = 'administrador' where "idPessoa" = '20000000-0000-0000-0000-000000000001';
do $$ begin
  assert to_regclass('public.administradores') is null, 'Tabela administrativa redundante';
  assert exists(select 1 from public.usuarios where "idUsuario" = '20000000-0000-0000-0000-000000000001' and tipo = 'administrador');
  assert not exists(select 1 from public.estudantes where "idEstudante" = '20000000-0000-0000-0000-000000000001');
  assert (select tipo = 'estudante' from public.usuarios where "idPessoa" = '20000000-0000-0000-0000-000000000002'), 'Metadata promoveu aluno';
  assert not has_table_privilege('authenticated', 'public.usuarios', 'INSERT');
  assert not has_table_privilege('authenticated', 'public.chamados_suporte', 'INSERT');
  assert not has_table_privilege('authenticated', 'public.chamados_suporte', 'UPDATE');
  assert not has_table_privilege('authenticated', 'public.chamados_suporte', 'DELETE');
  assert not has_table_privilege('authenticated', 'public.mensagens_suporte', 'INSERT');
  assert not has_table_privilege('authenticated', 'public.mensagens_suporte', 'UPDATE');
  assert not has_table_privilege('authenticated', 'public.mensagens_suporte', 'DELETE');
  assert not has_table_privilege('anon', 'public.chamados_suporte', 'SELECT');
  assert not has_function_privilege('anon', 'public.abrir_chamado_suporte(text,text,text)', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'suporte_privado.exigir_perfil()', 'EXECUTE');
end $$;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
set local role concursa_dados;
do $$ declare v_id uuid; v_negado boolean; begin
  assert not public.eh_administrador();
  assert (select count(*) = 1 from public.usuarios), 'Aluno consultou outras contas';
  v_negado := false;
  begin perform public.abrir_chamado_suporte('  ', 'simulados', 'Descrição da dúvida'); exception when raise_exception then v_negado := true; end;
  assert v_negado;
  v_negado := false;
  begin perform public.abrir_chamado_suporte('Assunto válido', 'invalida', 'Descrição da dúvida'); exception when raise_exception then v_negado := true; end;
  assert v_negado;
  v_negado := false;
  begin perform public.abrir_chamado_suporte('Assunto válido', 'simulados', null); exception when raise_exception then v_negado := true; end;
  assert v_negado;
  v_id := public.abrir_chamado_suporte('  Ajuda com simulado  ', 'simulados', '  Não consigo continuar o treino.  ');
  perform set_config('teste.chamado_suporte', v_id::text, true);
  assert (select count(*) = 1 from public.chamados_suporte), 'Abertura inválida deixou chamado';
  assert (select assunto = 'Ajuda com simulado' and status = 'aberto' and "idPessoa" = auth.uid() from public.chamados_suporte where "idChamado" = v_id);
  assert (select count(*) = 1 from public.mensagens_suporte where "idChamado" = v_id);
  v_negado := false;
  begin perform public.metricas_sistema(); exception when insufficient_privilege then v_negado := true; end;
  assert v_negado, 'Aluno acessou métricas globais';
  v_negado := false;
  begin perform public.finalizar_chamado_suporte(v_id, 'Solução informada pelo aluno'); exception when insufficient_privilege then v_negado := true; end;
  assert v_negado, 'Aluno finalizou chamado';
end $$;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000003', true);
do $$ declare v_negado boolean := false; begin
  assert (select count(*) = 0 from public.chamados_suporte), 'Vazamento entre alunos';
  assert (select count(*) = 0 from public.mensagens_suporte), 'Vazamento de mensagens';
  begin perform public.responder_chamado_suporte(current_setting('teste.chamado_suporte')::uuid, 'Mensagem indevida'); exception when insufficient_privilege then v_negado := true; end;
  assert v_negado, 'Outro aluno respondeu';
end $$;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000004', true);
do $$ declare v_negado boolean := false; begin
  begin perform public.abrir_chamado_suporte('Conta pendente', 'acesso', 'Não confirmei meu e-mail'); exception when insufficient_privilege then v_negado := true; end;
  assert v_negado, 'Conta pendente acessou suporte';
end $$;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
do $$ declare v_negado boolean := false; begin
  assert public.eh_administrador();
  assert (select count(*) = 1 from public.chamados_suporte);
  assert (public.metricas_sistema()->>'chamados_pendentes')::integer = 1;
  begin perform public.abrir_chamado_suporte('Admin não é aluno', 'outro', 'Abertura administrativa'); exception when insufficient_privilege then v_negado := true; end;
  assert v_negado;
  perform public.responder_chamado_suporte(current_setting('teste.chamado_suporte')::uuid, 'Abra a página de simulados e selecione Continuar.');
  assert (select status = 'aguardando_aluno' and "idAdministradorResponsavel" = auth.uid() from public.chamados_suporte where "idChamado" = current_setting('teste.chamado_suporte')::uuid);
end $$;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
do $$ begin
  perform public.responder_chamado_suporte(current_setting('teste.chamado_suporte')::uuid, 'Consegui retomar, obrigado.');
  assert (select status = 'aguardando_suporte' from public.chamados_suporte where "idChamado" = current_setting('teste.chamado_suporte')::uuid);
end $$;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
do $$ declare v_id uuid := current_setting('teste.chamado_suporte')::uuid; v_negado boolean := false; begin
  begin perform public.finalizar_chamado_suporte(v_id, ''); exception when raise_exception then v_negado := true; end;
  assert v_negado;
  assert (select count(*) = 3 from public.mensagens_suporte where "idChamado" = v_id), 'Finalização inválida alterou histórico';
  perform public.finalizar_chamado_suporte(v_id, 'Aluno orientado e simulado retomado com sucesso.');
  assert (select status = 'finalizado' and finalizado_em is not null and "idAdministradorFinalizador" = auth.uid() from public.chamados_suporte where "idChamado" = v_id);
  assert (select count(*) = 4 from public.mensagens_suporte where "idChamado" = v_id);
  assert (public.metricas_sistema()->>'chamados_finalizados')::integer = 1;
  assert (public.metricas_sistema()->>'chamados_pendentes')::integer = 0;
  v_negado := false;
  begin perform public.responder_chamado_suporte(v_id, 'Resposta tardia'); exception when raise_exception then v_negado := true; end;
  assert v_negado, 'Admin respondeu após finalizar';
  v_negado := false;
  begin perform public.finalizar_chamado_suporte(v_id, 'Nova solução indevida'); exception when raise_exception then v_negado := true; end;
  assert v_negado, 'Chamado finalizado duas vezes';
end $$;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
do $$ declare v_negado boolean := false; begin
  begin perform public.responder_chamado_suporte(current_setting('teste.chamado_suporte')::uuid, 'Resposta tardia'); exception when raise_exception then v_negado := true; end;
  assert v_negado, 'Aluno respondeu após finalizar';
  assert (select count(*) = 4 from public.mensagens_suporte);
end $$;
reset role;
-- Mesmo uma operação privilegiada não pode reabrir, editar ou apagar o histórico.
do $$ declare v_id uuid := current_setting('teste.chamado_suporte')::uuid; v_negado boolean; begin
  v_negado := false;
  begin update public.chamados_suporte set assunto = 'Assunto alterado' where "idChamado" = v_id; exception when raise_exception then v_negado := true; end;
  assert v_negado, 'Alteração de chamado encerrado';
  v_negado := false;
  begin delete from public.chamados_suporte where "idChamado" = v_id; exception when raise_exception then v_negado := true; end;
  assert v_negado, 'Exclusão de chamado encerrado';
  v_negado := false;
  begin update public.mensagens_suporte set conteudo = 'Alteração indevida' where "idChamado" = v_id; exception when raise_exception then v_negado := true; end;
  assert v_negado, 'Alteração de mensagem';
  v_negado := false;
  begin delete from public.mensagens_suporte where "idChamado" = v_id; exception when raise_exception then v_negado := true; end;
  assert v_negado, 'Exclusão de mensagem';
  v_negado := false;
  begin insert into public.mensagens_suporte("idChamado", "idPessoaAutor", nome_autor, papel_autor, conteudo)
    values(v_id, '20000000-0000-0000-0000-000000000001', 'Admin Teste', 'administrador', 'Inserção tardia'); exception when raise_exception then v_negado := true; end;
  assert v_negado, 'Inserção em chamado encerrado';
end $$;
-- O tipo administrativo fica na conta e não apaga o chamado antigo.
update public.usuarios set tipo = 'administrador' where "idPessoa" = '20000000-0000-0000-0000-000000000002';
do $$ begin
  assert exists(select 1 from public.usuarios where "idUsuario" = '20000000-0000-0000-0000-000000000002' and tipo = 'administrador');
  assert not exists(select 1 from public.estudantes where "idEstudante" = '20000000-0000-0000-0000-000000000002');
  assert (select count(*) = 1 from public.chamados_suporte);
end $$;
update public.usuarios set tipo = 'estudante' where "idPessoa" = '20000000-0000-0000-0000-000000000002';
do $$ begin
  assert exists(select 1 from public.usuarios where "idUsuario" = '20000000-0000-0000-0000-000000000002' and tipo = 'estudante');
  assert exists(select 1 from public.estudantes where "idEstudante" = '20000000-0000-0000-0000-000000000002');
end $$;
rollback;
