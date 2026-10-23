-- Ajustes finais dos fluxos existentes; sem alterações do acervo.
begin;
create unique index tentativas_uma_em_andamento_idx on public.tentativas_simulado("idSimulado","idPessoa") where status='em_andamento';

create function provas_privado.obter_explicacao_questao(p_idquestao uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare v_texto text;
begin
  if not public.eh_administrador() then raise exception 'Acesso negado' using errcode='42501'; end if;
  select explicacao into v_texto from public.questoes where "idQuestao"=p_idquestao;
  return v_texto;
end $$;
create function public.obter_explicacao_questao(p_idquestao uuid) returns text language sql security invoker set search_path='' as $$select provas_privado.obter_explicacao_questao(p_idquestao)$$;

create or replace function public.iniciar_tentativa(p_idsimulado uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_pessoa uuid;v_id uuid;
begin
  v_pessoa:=provas_privado.exigir_estudante();
  perform 1 from public.simulados where "idSimulado"=p_idsimulado and status='publicado' and (publico or "idPessoaCriadora"=v_pessoa) for update;
  if not found then raise exception 'Simulado indisponível'; end if;
  if not exists(select 1 from public.simulado_questoes where "idSimulado"=p_idsimulado) then raise exception 'Simulado sem questões'; end if;
  select "idTentativa" into v_id from public.tentativas_simulado where "idSimulado"=p_idsimulado and "idPessoa"=v_pessoa and status='em_andamento';
  if v_id is null then insert into public.tentativas_simulado("idSimulado","idPessoa") values(p_idsimulado,v_pessoa) returning "idTentativa" into v_id; end if;
  return v_id;
end $$;

create function provas_privado.proteger_simulado_pessoal() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null and not old.publico and old."idPessoaCriadora" is distinct from
    (select u."idPessoa" from public.usuarios u where u."idUsuario"=auth.uid()) then
    raise exception 'Simulado pessoal pertence a outra conta' using errcode='42501'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger proteger_simulado_pessoal before update or delete on public.simulados for each row execute function provas_privado.proteger_simulado_pessoal();

alter function public.iniciar_tentativa(uuid) set schema provas_privado;
create function public.iniciar_tentativa(p_idsimulado uuid) returns uuid language sql security invoker set search_path='' as $$select provas_privado.iniciar_tentativa(p_idsimulado)$$;
revoke all on function public.iniciar_tentativa(uuid) from public,anon;
grant execute on function public.iniciar_tentativa(uuid) to authenticated;

alter function public.responder_questao(uuid,uuid,uuid) set schema provas_privado;
create function public.responder_questao(p_idtentativa uuid, p_idquestao uuid, p_idalternativa uuid) returns void language sql security invoker set search_path='' as $$select provas_privado.responder_questao(p_idtentativa,p_idquestao,p_idalternativa)$$;
revoke all on function public.responder_questao(uuid,uuid,uuid) from public,anon;
grant execute on function public.responder_questao(uuid,uuid,uuid) to authenticated;

alter function public.obter_resultado_tentativa(uuid) set schema provas_privado;
create function public.obter_resultado_tentativa(p_idtentativa uuid) returns jsonb language sql stable security invoker set search_path='' as $$select provas_privado.obter_resultado_tentativa(p_idtentativa)$$;
revoke all on function public.obter_resultado_tentativa(uuid) from public,anon;
grant execute on function public.obter_resultado_tentativa(uuid) to authenticated;

alter function public.salvar_simulado(jsonb,uuid[],uuid) set schema provas_privado;
create function public.salvar_simulado(p_simulado jsonb, p_idsquestoes uuid[], p_idsimulado uuid DEFAULT NULL::uuid) returns uuid language sql security invoker set search_path='' as $$select provas_privado.salvar_simulado(p_simulado,p_idsquestoes,p_idsimulado)$$;
revoke all on function public.salvar_simulado(jsonb,uuid[],uuid) from public,anon;
grant execute on function public.salvar_simulado(jsonb,uuid[],uuid) to authenticated;

alter function public.disponibilidade_assuntos_odonto() set schema provas_privado;
create function public.disponibilidade_assuntos_odonto() returns TABLE("idAssunto" uuid, assunto text, "idDisciplina" uuid, disciplina text, quantidade integer) language sql stable security invoker set search_path='' as $$select * from provas_privado.disponibilidade_assuntos_odonto()$$;
revoke all on function public.disponibilidade_assuntos_odonto() from public,anon;
grant execute on function public.disponibilidade_assuntos_odonto() to authenticated;

alter function public.estatisticas_assuntos() set schema provas_privado;
create function public.estatisticas_assuntos() returns TABLE("idAssunto" uuid, assunto text, "idDisciplina" uuid, disciplina text, avaliadas integer, acertos integer, erros integer, em_branco integer) language sql stable security invoker set search_path='' as $$select * from provas_privado.estatisticas_assuntos()$$;
revoke all on function public.estatisticas_assuntos() from public,anon;
grant execute on function public.estatisticas_assuntos() to authenticated;

alter function public.gerar_simulado_odonto(integer,jsonb) set schema provas_privado;
create function public.gerar_simulado_odonto(p_quantidade integer, p_assuntos jsonb DEFAULT '[]'::jsonb) returns uuid language sql security invoker set search_path='' as $$select provas_privado.gerar_simulado_odonto(p_quantidade,p_assuntos)$$;
revoke all on function public.gerar_simulado_odonto(integer,jsonb) from public,anon;
grant execute on function public.gerar_simulado_odonto(integer,jsonb) to authenticated;

alter function public.gerar_treino_odonto(integer,text) set schema provas_privado;
create function public.gerar_treino_odonto(p_quantidade integer, p_modo text) returns uuid language sql security invoker set search_path='' as $$select provas_privado.gerar_treino_odonto(p_quantidade,p_modo)$$;
revoke all on function public.gerar_treino_odonto(integer,text) from public,anon;
grant execute on function public.gerar_treino_odonto(integer,text) to authenticated;

alter function public.resumo_revisao_odonto() set schema provas_privado;
create function public.resumo_revisao_odonto() returns jsonb language sql stable security invoker set search_path='' as $$select provas_privado.resumo_revisao_odonto()$$;
revoke all on function public.resumo_revisao_odonto() from public,anon;
grant execute on function public.resumo_revisao_odonto() to authenticated;

revoke all on function public.obter_explicacao_questao(uuid) from public,anon;
grant execute on function public.obter_explicacao_questao(uuid) to authenticated;
revoke all on function provas_privado.proteger_simulado_pessoal() from public,anon,authenticated;
revoke all on function provas_privado.obter_explicacao_questao(uuid) from public,anon;
grant execute on function provas_privado.obter_explicacao_questao(uuid) to authenticated;
revoke all on function provas_privado.iniciar_tentativa(uuid) from public,anon;
grant execute on function provas_privado.iniciar_tentativa(uuid) to authenticated;
revoke all on function provas_privado.responder_questao(uuid,uuid,uuid) from public,anon;
grant execute on function provas_privado.responder_questao(uuid,uuid,uuid) to authenticated;
revoke all on function provas_privado.obter_resultado_tentativa(uuid) from public,anon;
grant execute on function provas_privado.obter_resultado_tentativa(uuid) to authenticated;
revoke all on function provas_privado.salvar_simulado(jsonb,uuid[],uuid) from public,anon;
grant execute on function provas_privado.salvar_simulado(jsonb,uuid[],uuid) to authenticated;
revoke all on function provas_privado.disponibilidade_assuntos_odonto() from public,anon;
grant execute on function provas_privado.disponibilidade_assuntos_odonto() to authenticated;
revoke all on function provas_privado.estatisticas_assuntos() from public,anon;
grant execute on function provas_privado.estatisticas_assuntos() to authenticated;
revoke all on function provas_privado.gerar_simulado_odonto(integer,jsonb) from public,anon;
grant execute on function provas_privado.gerar_simulado_odonto(integer,jsonb) to authenticated;
revoke all on function provas_privado.gerar_treino_odonto(integer,text) from public,anon;
grant execute on function provas_privado.gerar_treino_odonto(integer,text) to authenticated;
revoke all on function provas_privado.resumo_revisao_odonto() from public,anon;
grant execute on function provas_privado.resumo_revisao_odonto() to authenticated;
notify pgrst,'reload schema';
commit;
