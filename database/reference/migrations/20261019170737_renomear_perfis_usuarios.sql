-- Mantém identidades, papéis, dados cadastrais e histórico. Auth usa idUsuario.
begin;
lock table public.perfis in access exclusive mode;
create temporary table verificacao_usuarios_migracao on commit drop as
  select "idPessoa", to_jsonb(p) as dados from public.perfis p;

alter table public.perfis rename to usuarios;
alter table public.usuarios add column "idUsuario" uuid;
update public.usuarios set "idUsuario" = "idPessoa";
alter table public.usuarios alter column "idUsuario" set not null;
alter table public.usuarios drop constraint perfis_pkey;
alter table public.usuarios drop constraint perfis_id_fkey;
alter table public.usuarios add constraint usuarios_pkey primary key ("idUsuario");
alter table public.usuarios add constraint usuarios_pessoa_unica unique ("idPessoa");
alter table public.usuarios add constraint usuarios_autenticacao_fk
  foreign key ("idUsuario") references auth.users(id) on delete cascade;
alter table public.usuarios rename constraint perfis_pessoa_fk to usuarios_pessoa_fk;
alter table public.usuarios rename constraint perfis_papel_check to usuarios_papel_check;
alter table public.usuarios rename constraint perfis_estado_cadastro_check to usuarios_estado_cadastro_check;

drop policy perfis_leitura on public.usuarios;
create policy usuarios_leitura on public.usuarios for select to authenticated
  using ("idUsuario" = (select auth.uid()) or (select public.eh_administrador()));
revoke all on public.usuarios from public, anon, authenticated;
grant select on public.usuarios to authenticated;

-- O papel da conta é a única fonte de autorização administrativa.
create or replace function public.eh_administrador() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.usuarios where "idUsuario" = (select auth.uid())
    and papel = 'administrador' and estado_cadastro = 'ativo' and cadastro_completo)
$$;

create or replace function public.sincronizar_papel_estudante() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.papel = 'estudante' then
    insert into public.estudantes("idEstudante") values (new."idPessoa") on conflict do nothing;
  else
    delete from public.estudantes where "idEstudante" = new."idPessoa";
  end if;
  return new;
end $$;
revoke all on function public.sincronizar_papel_estudante() from public, anon, authenticated;

-- Nenhuma conta depende da tabela de administradores; o papel é preservado em usuarios.
drop table public.administradores;

-- As políticas usam a identidade da conta, mantendo o histórico ligado à pessoa.
drop policy chamados_suporte_leitura on public.chamados_suporte;
create policy chamados_suporte_leitura on public.chamados_suporte for select to authenticated using (
  (select public.eh_administrador()) or ("idPessoa" = (select auth.uid()) and exists (
    select 1 from public.usuarios u where u."idUsuario" = (select auth.uid())
      and u.papel = 'estudante' and u.estado_cadastro = 'ativo' and u.cadastro_completo))
);

-- Atualiza a referência da função sem alterar seu contrato ou permissões.
CREATE OR REPLACE FUNCTION public.disponibilidade_assuntos_odonto()
 RETURNS TABLE("idAssunto" uuid, assunto text, "idDisciplina" uuid, disciplina text, quantidade integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists(select 1 from public.usuarios p join public.estudantes e on e."idEstudante" = p."idPessoa"
    where p."idUsuario" = auth.uid() and p.estado_cadastro = 'ativo' and p.cadastro_completo) then
    raise exception 'Cadastro de estudante ativo e completo necessário'; end if;
  return query select a."idAssunto", a.nome, d."idDisciplina", d.nome, count(q."idQuestao")::integer
    from public.assuntos a join public.disciplinas d on d."idDisciplina" = a."idDisciplina"
    left join public.questoes_elegiveis_odonto() q on q."idAssunto" = a."idAssunto"
    where d.ativa and d.area = 'odontologia'
    group by a."idAssunto", d."idDisciplina" order by d.nome, a.nome;
end $function$;

-- Atualiza a referência da função sem alterar seu contrato ou permissões.
CREATE OR REPLACE FUNCTION public.iniciar_tentativa(p_idsimulado uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_idTentativa uuid;
begin
  if not exists(select 1 from public.usuarios p join public.estudantes e on e."idEstudante" = p."idPessoa"
    where p."idUsuario" = auth.uid() and p.estado_cadastro = 'ativo' and p.cadastro_completo) then
    raise exception 'Cadastro de estudante ativo e completo necessário'; end if;
  if not exists(select 1 from public.simulados where "idSimulado" = p_idSimulado
    and status = 'publicado' and (publico or "idPessoaCriadora" = auth.uid())) then
    raise exception 'Simulado indisponível'; end if;
  insert into public.tentativas_simulado("idSimulado", "idPessoa")
    values(p_idSimulado, auth.uid()) returning "idTentativa" into v_idTentativa;
  return v_idTentativa;
end $function$;

-- Atualiza a referência da função sem alterar seu contrato ou permissões.
CREATE OR REPLACE FUNCTION public.salvar_minha_pessoa(p_pessoa jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_idPessoa uuid := auth.uid(); v_nome text; v_nascimento date; v_cpf text; v_cep text;
begin
  if v_idPessoa is null then raise exception 'Autenticacao necessaria'; end if;
  v_nome := btrim(coalesce(p_pessoa->>'nome_completo', ''));
  if length(v_nome) < 3 or position(' ' in v_nome) = 0 then raise exception 'Informe nome completo'; end if;
  begin v_nascimento := (p_pessoa->>'data_nascimento')::date;
  exception when others then raise exception 'Data de nascimento invalida'; end;
  if v_nascimento is null or v_nascimento < date '1900-01-01' or v_nascimento > current_date then
    raise exception 'Data de nascimento invalida'; end if;
  v_cpf := regexp_replace(coalesce(p_pessoa->>'cpf', ''), '[^0-9]', '', 'g');
  if not public.cpf_valido(v_cpf) then raise exception 'CPF invalido'; end if;
  v_cep := regexp_replace(coalesce(p_pessoa->>'cep', ''), '[^0-9]', '', 'g');
  if v_cep !~ '^[0-9]{8}$' then raise exception 'CEP invalido'; end if;
  if length(btrim(coalesce(p_pessoa->>'logradouro', ''))) = 0 or
     length(btrim(coalesce(p_pessoa->>'numero', ''))) = 0 or
     length(btrim(coalesce(p_pessoa->>'bairro', ''))) = 0 or
     length(btrim(coalesce(p_pessoa->>'cidade', ''))) = 0 or
     coalesce(p_pessoa->>'uf', '') !~ '^[A-Z]{2}$' then raise exception 'Endereco incompleto'; end if;
  update public.pessoas set nome_completo = v_nome, data_nascimento = v_nascimento,
    cpf = v_cpf, cep = v_cep, logradouro = btrim(p_pessoa->>'logradouro'),
    numero = btrim(p_pessoa->>'numero'), complemento = nullif(btrim(coalesce(p_pessoa->>'complemento', '')), ''),
    bairro = btrim(p_pessoa->>'bairro'), cidade = btrim(p_pessoa->>'cidade'),
    uf = p_pessoa->>'uf', atualizado_em = now()
  where "idPessoa" = v_idPessoa and (cpf is null or cpf = v_cpf);
  if not found then raise exception 'Pessoa indisponivel ou CPF diferente do cadastro'; end if;
  update public.usuarios set nome_completo = v_nome, cadastro_completo = true,
    atualizado_em = now() where "idPessoa" = v_idPessoa;
end $function$;

-- Atualiza a referência da função sem alterar seu contrato ou permissões.
CREATE OR REPLACE FUNCTION public.sincronizar_perfil_autenticacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_dados jsonb; v_nome text; v_nascimento date; v_cpf text; v_cep text;
begin
  if tg_op = 'INSERT' then
    v_dados := coalesce(new.raw_user_meta_data, '{}'::jsonb);
    v_nome := btrim(coalesce(v_dados->>'nome_completo', ''));
    if length(v_nome) < 3 or position(' ' in v_nome) = 0 then
      raise exception 'Informe nome completo'; end if;
    begin
      v_nascimento := (v_dados->>'data_nascimento')::date;
    exception when others then raise exception 'Data de nascimento invalida'; end;
    if v_nascimento is null or v_nascimento < date '1900-01-01' or v_nascimento > current_date then
      raise exception 'Data de nascimento invalida'; end if;
    v_cpf := regexp_replace(coalesce(v_dados->>'cpf', ''), '[^0-9]', '', 'g');
    if not public.cpf_valido(v_cpf) then raise exception 'CPF invalido'; end if;
    v_cep := regexp_replace(coalesce(v_dados->>'cep', ''), '[^0-9]', '', 'g');
    if v_cep !~ '^[0-9]{8}$' then raise exception 'CEP invalido'; end if;
    if length(btrim(coalesce(v_dados->>'logradouro', ''))) = 0 or
       length(btrim(coalesce(v_dados->>'numero', ''))) = 0 or
       length(btrim(coalesce(v_dados->>'bairro', ''))) = 0 or
       length(btrim(coalesce(v_dados->>'cidade', ''))) = 0 or
       coalesce(v_dados->>'uf', '') !~ '^[A-Z]{2}$' then
      raise exception 'Endereco incompleto'; end if;
    insert into public.pessoas("idPessoa", nome_completo, data_nascimento, cpf, cep,
      logradouro, numero, complemento, bairro, cidade, uf)
    values (new.id, v_nome, v_nascimento, v_cpf, v_cep,
      btrim(v_dados->>'logradouro'), btrim(v_dados->>'numero'),
      nullif(btrim(coalesce(v_dados->>'complemento', '')), ''),
      btrim(v_dados->>'bairro'), btrim(v_dados->>'cidade'), v_dados->>'uf');
    insert into public.usuarios("idUsuario", "idPessoa", nome_completo, email, avatar_url,
      estado_cadastro, ultimo_acesso_em, cadastro_completo)
    values (new.id, new.id, v_nome, coalesce(new.email, ''), v_dados->>'avatar_url',
      case when new.email_confirmed_at is not null then 'ativo'
           when new.invited_at is not null then 'convite_pendente'
           else 'verificacao_pendente' end, new.last_sign_in_at, true);
  else
    update public.usuarios set email = coalesce(new.email, ''),
      estado_cadastro = case when new.email_confirmed_at is not null then 'ativo'
        when new.invited_at is not null then 'convite_pendente'
        else 'verificacao_pendente' end,
      ultimo_acesso_em = new.last_sign_in_at, atualizado_em = now()
    where "idUsuario" = new.id;
  end if;
  return new;
end $function$;

-- Atualiza a referência da função sem alterar seu contrato ou permissões.
CREATE OR REPLACE FUNCTION suporte_privado.abrir_chamado(p_assunto text, p_categoria text, p_mensagem text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_perfil public.usuarios; v_id uuid;
begin
  v_perfil := suporte_privado.exigir_perfil();
  if v_perfil.papel <> 'estudante' then raise exception 'Somente alunos podem abrir chamados.' using errcode = '42501'; end if;
  if p_assunto is null or char_length(btrim(p_assunto)) not between 5 and 120
    or p_categoria is null or p_categoria not in ('acesso', 'simulados', 'desempenho', 'outro')
    or p_mensagem is null or char_length(btrim(p_mensagem)) not between 10 and 4000 then
    raise exception 'Informe assunto de 5 a 120 caracteres, categoria válida e descrição de 10 a 4.000 caracteres.';
  end if;
  insert into public.chamados_suporte("idPessoa", nome_estudante, assunto, categoria)
    values(auth.uid(), v_perfil.nome_completo, btrim(p_assunto), p_categoria) returning "idChamado" into v_id;
  insert into public.mensagens_suporte("idChamado", "idPessoaAutor", nome_autor, papel_autor, conteudo)
    values(v_id, auth.uid(), v_perfil.nome_completo, v_perfil.papel, btrim(p_mensagem));
  return v_id;
end $function$;

-- Atualiza a referência da função sem alterar seu contrato ou permissões.
CREATE OR REPLACE FUNCTION suporte_privado.exigir_perfil()
 RETURNS public.usuarios
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_perfil public.usuarios;
begin
  select * into v_perfil from public.usuarios where "idUsuario" = auth.uid()
    and estado_cadastro = 'ativo' and cadastro_completo;
  if not found then raise exception 'Conta ativa e cadastro completo necessários.' using errcode = '42501'; end if;
  if (v_perfil.papel = 'administrador' and not public.eh_administrador())
    or (v_perfil.papel = 'estudante' and not exists(select 1 from public.estudantes where "idEstudante" = v_perfil."idPessoa")) then
    raise exception 'Perfil sem acesso ao suporte.' using errcode = '42501';
  end if;
  return v_perfil;
end $function$;

-- Atualiza a referência da função sem alterar seu contrato ou permissões.
CREATE OR REPLACE FUNCTION suporte_privado.finalizar_chamado(p_idchamado uuid, p_resolucao text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_perfil public.usuarios; v_chamado public.chamados_suporte;
begin
  v_perfil := suporte_privado.exigir_perfil();
  if v_perfil.papel <> 'administrador' then raise exception 'Somente administradores podem finalizar chamados.' using errcode = '42501'; end if;
  select * into v_chamado from public.chamados_suporte where "idChamado" = p_idchamado for update;
  if not found then raise exception 'Chamado indisponível.'; end if;
  if v_chamado.status = 'finalizado' then raise exception 'Este chamado já foi finalizado e está disponível apenas para consulta.'; end if;
  if p_resolucao is null or char_length(btrim(p_resolucao)) not between 10 and 4000 then
    raise exception 'Descreva a solução em 10 a 4.000 caracteres.';
  end if;
  insert into public.mensagens_suporte("idChamado", "idPessoaAutor", nome_autor, papel_autor, conteudo, tipo)
    values(p_idchamado, auth.uid(), v_perfil.nome_completo, v_perfil.papel, btrim(p_resolucao), 'encerramento');
  update public.chamados_suporte set status = 'finalizado', finalizado_em = clock_timestamp(),
    atualizado_em = clock_timestamp(), resolucao = btrim(p_resolucao),
    "idAdministradorResponsavel" = auth.uid(), "idAdministradorFinalizador" = auth.uid()
    where "idChamado" = p_idchamado;
end $function$;

-- Atualiza a referência da função sem alterar seu contrato ou permissões.
CREATE OR REPLACE FUNCTION suporte_privado.metricas_sistema()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.eh_administrador() then raise exception 'Acesso administrativo necessário.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'alunos', (select count(*) from public.usuarios where papel = 'estudante'),
    'administradores', (select count(*) from public.usuarios where papel = 'administrador'),
    'alunos_ativos', (select count(*) from public.usuarios where papel = 'estudante' and estado_cadastro = 'ativo' and cadastro_completo),
    'acessos_30_dias', (select count(*) from public.usuarios where papel = 'estudante' and ultimo_acesso_em >= now() - interval '30 days'),
    'questoes_publicadas', (select count(*) from public.questoes where status = 'publicada'),
    'simulados_gerados', (select count(*) from public.simulados),
    'tentativas_finalizadas', (select count(*) from public.tentativas_simulado where status = 'finalizada'),
    'chamados_pendentes', (select count(*) from public.chamados_suporte where status <> 'finalizado'),
    'chamados_finalizados', (select count(*) from public.chamados_suporte where status = 'finalizado'));
end $function$;

-- Atualiza a referência da função sem alterar seu contrato ou permissões.
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
  if not found or (v_perfil.papel <> 'administrador' and v_chamado."idPessoa" <> auth.uid()) then
    raise exception 'Chamado indisponível para sua conta.' using errcode = '42501';
  end if;
  if v_chamado.status = 'finalizado' then raise exception 'Chamado finalizado. Abra um novo chamado para continuar.'; end if;
  if p_mensagem is null or char_length(btrim(p_mensagem)) not between 1 and 4000 then
    raise exception 'Escreva uma mensagem de até 4.000 caracteres.';
  end if;
  insert into public.mensagens_suporte("idChamado", "idPessoaAutor", nome_autor, papel_autor, conteudo)
    values(p_idchamado, auth.uid(), v_perfil.nome_completo, v_perfil.papel, btrim(p_mensagem));
  update public.chamados_suporte set
    status = case when v_perfil.papel = 'administrador' then 'aguardando_aluno' else 'aguardando_suporte' end,
    "idAdministradorResponsavel" = case when v_perfil.papel = 'administrador' then auth.uid() else "idAdministradorResponsavel" end,
    atualizado_em = clock_timestamp() where "idChamado" = p_idchamado;
end $function$;

-- Falha a transação inteira se qualquer dado anterior tiver sido alterado ou removido.
do $$ begin
  if exists(select 1 from pg_temp.verificacao_usuarios_migracao v full join public.usuarios u using ("idPessoa")
    where v.dados is distinct from (to_jsonb(u) - 'idUsuario')) then
    raise exception 'Os dados das contas devem ser preservados na renomeação.';
  end if;
  if exists(select 1 from public.usuarios where "idUsuario" is distinct from "idPessoa") then
    raise exception 'Identidade de autenticação não preservada.';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
