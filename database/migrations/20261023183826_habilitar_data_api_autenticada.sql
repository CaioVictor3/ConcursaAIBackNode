begin;
grant usage on schema public, provas_privado, suporte_privado to authenticated;
grant select on public.usuarios, public.pessoas, public.estudantes,
 public.bancas, public.disciplinas, public.assuntos, public.concursos, public.provas,
 public.temas, public.questoes, public.alternativas, public.gabaritos,
 public.simulados, public.simulado_questoes, public.tentativas_simulado,
 public.respostas_simulado, public.chamados_suporte, public.mensagens_suporte,
 public.metas_estudo, public.analises_questoes to authenticated;
grant insert, update, delete on public.bancas, public.disciplinas, public.assuntos, public.concursos to authenticated;
grant update(status) on public.questoes to authenticated;

create policy pessoas_leitura_autenticada on public.pessoas for select to authenticated
 using ("idPessoa" = (select auth.uid()) or (select public.eh_administrador()));
create policy estudantes_leitura_autenticada on public.estudantes for select to authenticated
 using ("idEstudante" = (select auth.uid()) or (select public.eh_administrador()));
create policy questoes_atualizacao_administrativa on public.questoes for update to authenticated
 using ((select public.eh_administrador())) with check ((select public.eh_administrador()));

-- Somente as RPCs usadas pelos serviços da API. Os helpers privados permanecem
-- fora dos schemas expostos; suas verificações de identidade são preservadas.
do $$
declare v record;
begin
 for v in
  select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) argumentos
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','provas_privado','suporte_privado')
  and p.proname = any(array[
   'eh_administrador','obter_minha_pessoa','salvar_minha_pessoa','cpf_valido',
   'quantidade_questoes_odonto','disponibilidade_assuntos_odonto',
   'obter_explicacao_questao','salvar_prova','listar_pendencias_provas','iniciar_prova',
   'salvar_questao','salvar_simulado','criar_simulado_filtrado','gerar_simulado_odonto',
   'iniciar_tentativa','responder_questao','finalizar_tentativa','obter_resultado_tentativa',
   'resumo_revisao_odonto','listar_questoes_revisao','estatisticas_assuntos',
   'progresso_meta_semanal','salvar_meta_semanal','gerar_treino_odonto',
   'metricas_sistema','abrir_chamado_suporte','responder_chamado_suporte','finalizar_chamado_suporte',
   'contexto_analise_questao','consultar_analise_questao','reservar_analise_backend',
   'consultar_historico_perguntas_contextuais_ia','reservar_pergunta_contextual_ia'
  ])
 loop
  execute format('grant execute on function %I.%I(%s) to authenticated', v.nspname,v.proname,v.argumentos);
 end loop;
end $$;

-- As respostas da IA são persistidas exclusivamente pelo servidor, evitando
-- que uma sessão do aluno publique conteúdo no cache compartilhado.
create function provas_privado.concluir_geracao_ia_backend(p_idusuario uuid,p_tipo text,p_dados jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_idusuario is null or not exists(select 1 from public.usuarios where "idUsuario"=p_idusuario and estado_cadastro='ativo') then
  raise exception 'Usuário indisponível' using errcode='42501';
 end if;
 perform set_config('request.jwt.claim.sub',p_idusuario::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_idusuario,'role','authenticated')::text,true);
 if p_tipo='analise' then
  return provas_privado.salvar_analise_backend_com_consumo(
   (p_dados->>'p_idquestao')::uuid,(p_dados->>'p_idsolicitacao')::uuid,p_dados->'p_conteudo',
   p_dados->>'p_modelo',(p_dados->>'p_falhou')::boolean,
   (p_dados->>'p_tokens_entrada')::integer,(p_dados->>'p_tokens_saida')::integer,
   (p_dados->>'p_tokens_entrada_cache')::integer,(p_dados->>'p_custo_estimado_usd')::numeric);
 elsif p_tipo='pergunta' then
  return provas_privado.salvar_pergunta_contextual_ia(
   (p_dados->>'p_id_solicitacao')::uuid,p_dados->>'p_resposta',p_dados->>'p_modelo',
   (p_dados->>'p_falhou')::boolean,(p_dados->>'p_tokens_entrada')::integer,
   (p_dados->>'p_tokens_saida')::integer,(p_dados->>'p_tokens_entrada_cache')::integer,
   (p_dados->>'p_custo_estimado_usd')::numeric);
 end if;
 raise exception 'Operação inválida';
end $$;
create function public.concluir_geracao_ia_backend(p_idusuario uuid,p_tipo text,p_dados jsonb)
returns boolean language sql security invoker set search_path='' as $$
 select provas_privado.concluir_geracao_ia_backend(p_idusuario,p_tipo,p_dados)
$$;
revoke all on function provas_privado.concluir_geracao_ia_backend(uuid,text,jsonb),public.concluir_geracao_ia_backend(uuid,text,jsonb) from public,anon,authenticated;
grant usage on schema provas_privado to service_role;
grant execute on function provas_privado.concluir_geracao_ia_backend(uuid,text,jsonb),public.concluir_geracao_ia_backend(uuid,text,jsonb) to service_role;

notify pgrst,'reload schema';
commit;
