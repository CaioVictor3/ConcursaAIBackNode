-- Renomeia o tipo da conta sem recriar usuarios ou alterar dados e permissoes.
begin;
set local lock_timeout = '10s';
lock table public.usuarios in access exclusive mode;
create temporary table verificacao_tipo_usuario on commit drop as
  select "idUsuario", to_jsonb(u) - 'papel' as dados, papel as tipo from public.usuarios u;

alter table public.usuarios rename column papel to tipo;
alter table public.usuarios rename constraint usuarios_papel_check to usuarios_tipo_check;

-- Recria os corpos textuais que nao acompanham automaticamente a renomeacao.
CREATE OR REPLACE FUNCTION public.eh_administrador()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists(select 1 from public.usuarios where "idUsuario" = (select auth.uid())
    and tipo = 'administrador' and estado_cadastro = 'ativo' and cadastro_completo)
$function$;

CREATE OR REPLACE FUNCTION public.sincronizar_papel_estudante()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.tipo = 'estudante' then
    insert into public.estudantes("idEstudante") values (new."idPessoa") on conflict do nothing;
  else
    delete from public.estudantes where "idEstudante" = new."idPessoa";
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION suporte_privado.abrir_chamado(p_assunto text, p_categoria text, p_mensagem text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_perfil public.usuarios; v_id uuid;
begin
  v_perfil := suporte_privado.exigir_perfil();
  if v_perfil.tipo <> 'estudante' then raise exception 'Somente alunos podem abrir chamados.' using errcode = '42501'; end if;
  if p_assunto is null or char_length(btrim(p_assunto)) not between 5 and 120
    or p_categoria is null or p_categoria not in ('acesso', 'simulados', 'desempenho', 'outro')
    or p_mensagem is null or char_length(btrim(p_mensagem)) not between 10 and 4000 then
    raise exception 'Informe assunto de 5 a 120 caracteres, categoria válida e descrição de 10 a 4.000 caracteres.';
  end if;
  insert into public.chamados_suporte("idPessoa", nome_estudante, assunto, categoria)
    values(auth.uid(), v_perfil.nome_completo, btrim(p_assunto), p_categoria) returning "idChamado" into v_id;
  insert into public.mensagens_suporte("idChamado", "idPessoaAutor", nome_autor, papel_autor, conteudo)
    values(v_id, auth.uid(), v_perfil.nome_completo, v_perfil.tipo, btrim(p_mensagem));
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION suporte_privado.exigir_perfil()
 RETURNS usuarios
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_perfil public.usuarios;
begin
  select * into v_perfil from public.usuarios where "idUsuario" = auth.uid()
    and estado_cadastro = 'ativo' and cadastro_completo;
  if not found then raise exception 'Conta ativa e cadastro completo necessários.' using errcode = '42501'; end if;
  if (v_perfil.tipo = 'administrador' and not public.eh_administrador())
    or (v_perfil.tipo = 'estudante' and not exists(select 1 from public.estudantes where "idEstudante" = v_perfil."idPessoa")) then
    raise exception 'Perfil sem acesso ao suporte.' using errcode = '42501';
  end if;
  return v_perfil;
end $function$;

CREATE OR REPLACE FUNCTION suporte_privado.finalizar_chamado(p_idchamado uuid, p_resolucao text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_perfil public.usuarios; v_chamado public.chamados_suporte;
begin
  v_perfil := suporte_privado.exigir_perfil();
  if v_perfil.tipo <> 'administrador' then raise exception 'Somente administradores podem finalizar chamados.' using errcode = '42501'; end if;
  select * into v_chamado from public.chamados_suporte where "idChamado" = p_idchamado for update;
  if not found then raise exception 'Chamado indisponível.'; end if;
  if v_chamado.status = 'finalizado' then raise exception 'Este chamado já foi finalizado e está disponível apenas para consulta.'; end if;
  if p_resolucao is null or char_length(btrim(p_resolucao)) not between 10 and 4000 then
    raise exception 'Descreva a solução em 10 a 4.000 caracteres.';
  end if;
  insert into public.mensagens_suporte("idChamado", "idPessoaAutor", nome_autor, papel_autor, conteudo, tipo)
    values(p_idchamado, auth.uid(), v_perfil.nome_completo, v_perfil.tipo, btrim(p_resolucao), 'encerramento');
  update public.chamados_suporte set status = 'finalizado', finalizado_em = clock_timestamp(),
    atualizado_em = clock_timestamp(), resolucao = btrim(p_resolucao),
    "idAdministradorResponsavel" = auth.uid(), "idAdministradorFinalizador" = auth.uid()
    where "idChamado" = p_idchamado;
end $function$;

CREATE OR REPLACE FUNCTION suporte_privado.metricas_sistema()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.eh_administrador() then raise exception 'Acesso administrativo necessário.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'alunos', (select count(*) from public.usuarios where tipo = 'estudante'),
    'administradores', (select count(*) from public.usuarios where tipo = 'administrador'),
    'alunos_ativos', (select count(*) from public.usuarios where tipo = 'estudante' and estado_cadastro = 'ativo' and cadastro_completo),
    'acessos_30_dias', (select count(*) from public.usuarios where tipo = 'estudante' and ultimo_acesso_em >= now() - interval '30 days'),
    'questoes_publicadas', (select count(*) from public.questoes where status = 'publicada'),
    'simulados_gerados', (select count(*) from public.simulados),
    'tentativas_finalizadas', (select count(*) from public.tentativas_simulado where status = 'finalizada'),
    'chamados_pendentes', (select count(*) from public.chamados_suporte where status <> 'finalizado'),
    'chamados_finalizados', (select count(*) from public.chamados_suporte where status = 'finalizado'));
end $function$;

CREATE OR REPLACE FUNCTION suporte_privado.responder_chamado(p_idchamado uuid, p_mensagem text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_perfil public.usuarios; v_chamado public.chamados_suporte;
begin
  v_perfil := suporte_privado.exigir_perfil();
  select * into v_chamado from public.chamados_suporte where "idChamado" = p_idchamado for update;
  if not found or (v_perfil.tipo <> 'administrador' and v_chamado."idPessoa" <> auth.uid()) then
    raise exception 'Chamado indisponível para sua conta.' using errcode = '42501';
  end if;
  if v_chamado.status = 'finalizado' then raise exception 'Chamado finalizado. Abra um novo chamado para continuar.'; end if;
  if p_mensagem is null or char_length(btrim(p_mensagem)) not between 1 and 4000 then
    raise exception 'Escreva uma mensagem de até 4.000 caracteres.';
  end if;
  insert into public.mensagens_suporte("idChamado", "idPessoaAutor", nome_autor, papel_autor, conteudo)
    values(p_idchamado, auth.uid(), v_perfil.nome_completo, v_perfil.tipo, btrim(p_mensagem));
  update public.chamados_suporte set
    status = case when v_perfil.tipo = 'administrador' then 'aguardando_aluno' else 'aguardando_suporte' end,
    "idAdministradorResponsavel" = case when v_perfil.tipo = 'administrador' then auth.uid() else "idAdministradorResponsavel" end,
    atualizado_em = clock_timestamp() where "idChamado" = p_idchamado;
end $function$;

alter function public.sincronizar_papel_estudante() rename to sincronizar_tipo_estudante;
alter trigger ao_alterar_papel_estudante on public.usuarios rename to ao_alterar_tipo_estudante;

-- Explicita a politica de suporte usando o novo nome do campo.
alter policy chamados_suporte_leitura on public.chamados_suporte using (
  (select public.eh_administrador()) or ("idPessoa" = (select auth.uid()) and exists (
    select 1 from public.usuarios u where u."idUsuario" = (select auth.uid())
      and u.tipo = 'estudante' and u.estado_cadastro = 'ativo' and u.cadastro_completo))
);

-- Qualquer divergencia reverte a transacao inteira, inclusive a renomeacao.
do $$ begin
  if exists(select 1 from pg_temp.verificacao_tipo_usuario v full join public.usuarios u using ("idUsuario")
    where v.dados is distinct from (to_jsonb(u) - 'tipo') or v.tipo is distinct from u.tipo) then
    raise exception 'Os dados e tipos das contas devem ser preservados.';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'suporte_privado') and p.prosrc ~ '\mpapel\M') then
    raise exception 'Uma funcao ainda depende da coluna papel.';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
