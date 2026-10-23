begin;
-- Somente a API .NET pode solicitar a geração. O usuário vem do contexto autenticado,
-- e a tentativa finalizada é conferida antes da reserva atômica e da cota diária.
create function provas_privado.reservar_analise_backend(p_idtentativa uuid,p_idquestao uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_contexto jsonb;v_reserva jsonb;
begin
  if auth.uid() is null then raise exception 'Sessão não autorizada.'; end if;
  v_contexto:=public.contexto_analise_questao(p_idtentativa,p_idquestao);
  v_reserva:=public.reservar_analise_questao(auth.uid(),p_idquestao,v_contexto->>'hash');
  return v_reserva||jsonb_build_object('contexto',v_contexto->'contexto');
end $$;
create function public.reservar_analise_backend(p_idtentativa uuid,p_idquestao uuid) returns jsonb
language sql security invoker set search_path='' as $$ select provas_privado.reservar_analise_backend(p_idtentativa,p_idquestao) $$;
create function provas_privado.salvar_analise_backend(p_idquestao uuid,p_idsolicitacao uuid,p_conteudo jsonb,p_modelo text,p_falhou boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_linhas integer;
begin
  if auth.uid() is null then raise exception 'Sessão não autorizada.'; end if;
  if not p_falhou and (p_conteudo is null or jsonb_typeof(p_conteudo)<>'object' or p_modelo is null or length(btrim(p_modelo)) not between 1 and 100) then raise exception 'Análise incompleta.'; end if;
  update public.analises_questoes set status=case when p_falhou then 'falha' else 'concluida' end,
    conteudo=case when p_falhou then null else p_conteudo end,modelo=case when p_falhou then null else p_modelo end,
    gerada_em=case when p_falhou then null else now() end
    where "idUsuario"=auth.uid() and "idQuestao"=p_idquestao and "idSolicitacao"=p_idsolicitacao and status='processando';
  get diagnostics v_linhas=row_count;
  return v_linhas=1;
end $$;
create function public.salvar_analise_backend(p_idquestao uuid,p_idsolicitacao uuid,p_conteudo jsonb,p_modelo text,p_falhou boolean) returns boolean
language sql security invoker set search_path='' as $$ select provas_privado.salvar_analise_backend(p_idquestao,p_idsolicitacao,p_conteudo,p_modelo,p_falhou) $$;
revoke all on function public.reservar_analise_backend(uuid,uuid),public.salvar_analise_backend(uuid,uuid,jsonb,text,boolean),provas_privado.reservar_analise_backend(uuid,uuid),provas_privado.salvar_analise_backend(uuid,uuid,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.reservar_analise_backend(uuid,uuid),public.salvar_analise_backend(uuid,uuid,jsonb,text,boolean),provas_privado.reservar_analise_backend(uuid,uuid),provas_privado.salvar_analise_backend(uuid,uuid,jsonb,text,boolean) to concursa_dados;
notify pgrst,'reload schema';
commit;
