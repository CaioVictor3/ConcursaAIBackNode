-- Papéis separados em subtipos da pessoa, preservando Auth e perfis existentes.
create table public.administradores (
  "idAdministrador" uuid primary key references public.pessoas("idPessoa") on delete cascade,
  criado_em timestamptz not null default now()
);
insert into public.administradores("idAdministrador")
select "idPessoa" from public.perfis where papel = 'administrador';
alter table public.administradores enable row level security;
revoke all on public.administradores from public, anon, authenticated;
grant select on public.administradores to authenticated;
create policy administradores_leitura on public.administradores for select to authenticated
  using ((select public.eh_administrador()));

create or replace function public.sincronizar_papel_estudante() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.papel = 'estudante' then
    delete from public.administradores where "idAdministrador" = new."idPessoa";
    insert into public.estudantes("idEstudante") values (new."idPessoa") on conflict do nothing;
  else
    delete from public.estudantes where "idEstudante" = new."idPessoa";
    insert into public.administradores("idAdministrador") values (new."idPessoa") on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function public.sincronizar_papel_estudante() from public, anon, authenticated;

create or replace function public.eh_administrador() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.perfis p
    join public.administradores a on a."idAdministrador" = p."idPessoa"
    where p."idPessoa" = (select auth.uid()) and p.papel = 'administrador'
      and p.estado_cadastro = 'ativo' and p.cadastro_completo)
$$;

create table public.chamados_suporte (
  "idChamado" uuid primary key default gen_random_uuid(),
  "idPessoa" uuid not null references public.pessoas("idPessoa"),
  nome_estudante text not null,
  assunto text not null check (char_length(btrim(assunto)) between 5 and 120),
  categoria text not null check (categoria in ('acesso', 'simulados', 'desempenho', 'outro')),
  status text not null default 'aberto' check (status in ('aberto', 'aguardando_aluno', 'aguardando_suporte', 'finalizado')),
  "idAdministradorResponsavel" uuid references public.pessoas("idPessoa"),
  "idAdministradorFinalizador" uuid references public.pessoas("idPessoa"),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  finalizado_em timestamptz,
  resolucao text,
  constraint chamado_encerramento_coerente check (
    (status = 'finalizado' and finalizado_em is not null and "idAdministradorFinalizador" is not null
      and resolucao is not null and char_length(btrim(resolucao)) between 10 and 4000)
    or (status <> 'finalizado' and finalizado_em is null and "idAdministradorFinalizador" is null and resolucao is null))
);
create table public.mensagens_suporte (
  "idMensagem" uuid primary key default gen_random_uuid(),
  "idChamado" uuid not null references public.chamados_suporte("idChamado"),
  "idPessoaAutor" uuid not null references public.pessoas("idPessoa"),
  nome_autor text not null,
  papel_autor text not null check (papel_autor in ('administrador', 'estudante')),
  conteudo text not null check (char_length(btrim(conteudo)) between 1 and 4000),
  tipo text not null default 'mensagem' check (tipo in ('mensagem', 'encerramento')),
  criada_em timestamptz not null default clock_timestamp(),
  constraint encerramento_por_admin check (tipo <> 'encerramento' or papel_autor = 'administrador')
);
create index chamados_suporte_pessoa_atualizacao on public.chamados_suporte("idPessoa", atualizado_em desc, "idChamado");
create index chamados_suporte_status_atualizacao on public.chamados_suporte(status, atualizado_em desc, "idChamado");
create index chamados_suporte_responsavel on public.chamados_suporte("idAdministradorResponsavel");
create index chamados_suporte_finalizador on public.chamados_suporte("idAdministradorFinalizador");
create index mensagens_suporte_chamado_data on public.mensagens_suporte("idChamado", criada_em, "idMensagem");
create index mensagens_suporte_autor on public.mensagens_suporte("idPessoaAutor");

alter table public.chamados_suporte enable row level security;
alter table public.mensagens_suporte enable row level security;
revoke all on public.chamados_suporte, public.mensagens_suporte from public, anon, authenticated;
grant select on public.chamados_suporte, public.mensagens_suporte to authenticated;
create policy chamados_suporte_leitura on public.chamados_suporte for select to authenticated using (
  (select public.eh_administrador()) or ("idPessoa" = (select auth.uid()) and exists (
    select 1 from public.perfis p where p."idPessoa" = (select auth.uid())
      and p.papel = 'estudante' and p.estado_cadastro = 'ativo' and p.cadastro_completo))
);
create policy mensagens_suporte_leitura on public.mensagens_suporte for select to authenticated using (
  exists(select 1 from public.chamados_suporte c where c."idChamado" = mensagens_suporte."idChamado")
);

-- Operações privilegiadas ficam em schema não exposto, com wrappers invoker na API.
create schema if not exists suporte_privado;
revoke all on schema suporte_privado from public, anon, authenticated;
grant usage on schema suporte_privado to authenticated;

create function suporte_privado.exigir_perfil() returns public.perfis
language plpgsql stable security definer set search_path = '' as $$
declare v_perfil public.perfis;
begin
  select * into v_perfil from public.perfis where "idPessoa" = auth.uid()
    and estado_cadastro = 'ativo' and cadastro_completo;
  if not found then raise exception 'Conta ativa e cadastro completo necessários.' using errcode = '42501'; end if;
  if (v_perfil.papel = 'administrador' and not public.eh_administrador())
    or (v_perfil.papel = 'estudante' and not exists(select 1 from public.estudantes where "idEstudante" = auth.uid())) then
    raise exception 'Perfil sem acesso ao suporte.' using errcode = '42501';
  end if;
  return v_perfil;
end $$;

create function suporte_privado.proteger_historico() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'mensagens_suporte' then
    if tg_op <> 'INSERT' then raise exception 'O histórico do chamado não pode ser alterado.'; end if;
    perform 1 from public.chamados_suporte where "idChamado" = new."idChamado" and status <> 'finalizado' for update;
    if not found then raise exception 'Chamado finalizado ou indisponível. Abra um novo chamado.'; end if;
    return new;
  end if;
  if old.status = 'finalizado' or tg_op = 'DELETE' then
    raise exception 'O chamado não pode ser alterado ou excluído após a finalização.';
  end if;
  return new;
end $$;
create trigger proteger_chamado_suporte before update or delete on public.chamados_suporte
  for each row execute function suporte_privado.proteger_historico();
create trigger proteger_mensagem_suporte before insert or update or delete on public.mensagens_suporte
  for each row execute function suporte_privado.proteger_historico();

create function suporte_privado.abrir_chamado(p_assunto text, p_categoria text, p_mensagem text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_perfil public.perfis; v_id uuid;
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
end $$;

create function suporte_privado.responder_chamado(p_idchamado uuid, p_mensagem text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_perfil public.perfis; v_chamado public.chamados_suporte;
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
end $$;

create function suporte_privado.finalizar_chamado(p_idchamado uuid, p_resolucao text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_perfil public.perfis; v_chamado public.chamados_suporte;
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
end $$;

create function suporte_privado.metricas_sistema() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.eh_administrador() then raise exception 'Acesso administrativo necessário.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'alunos', (select count(*) from public.perfis where papel = 'estudante'),
    'administradores', (select count(*) from public.perfis where papel = 'administrador'),
    'alunos_ativos', (select count(*) from public.perfis where papel = 'estudante' and estado_cadastro = 'ativo' and cadastro_completo),
    'acessos_30_dias', (select count(*) from public.perfis where papel = 'estudante' and ultimo_acesso_em >= now() - interval '30 days'),
    'questoes_publicadas', (select count(*) from public.questoes where status = 'publicada'),
    'simulados_gerados', (select count(*) from public.simulados),
    'tentativas_finalizadas', (select count(*) from public.tentativas_simulado where status = 'finalizada'),
    'chamados_pendentes', (select count(*) from public.chamados_suporte where status <> 'finalizado'),
    'chamados_finalizados', (select count(*) from public.chamados_suporte where status = 'finalizado'));
end $$;

revoke all on all functions in schema suporte_privado from public, anon, authenticated;
grant execute on function suporte_privado.abrir_chamado(text, text, text),
  suporte_privado.responder_chamado(uuid, text), suporte_privado.finalizar_chamado(uuid, text),
  suporte_privado.metricas_sistema() to authenticated;

create function public.abrir_chamado_suporte(p_assunto text, p_categoria text, p_mensagem text) returns uuid
language sql security invoker set search_path = '' as $$ select suporte_privado.abrir_chamado(p_assunto, p_categoria, p_mensagem) $$;
create function public.responder_chamado_suporte(p_idchamado uuid, p_mensagem text) returns void
language sql security invoker set search_path = '' as $$ select suporte_privado.responder_chamado(p_idchamado, p_mensagem) $$;
create function public.finalizar_chamado_suporte(p_idchamado uuid, p_resolucao text) returns void
language sql security invoker set search_path = '' as $$ select suporte_privado.finalizar_chamado(p_idchamado, p_resolucao) $$;
create function public.metricas_sistema() returns jsonb
language sql stable security invoker set search_path = '' as $$ select suporte_privado.metricas_sistema() $$;
revoke all on function public.abrir_chamado_suporte(text, text, text), public.responder_chamado_suporte(uuid, text),
  public.finalizar_chamado_suporte(uuid, text), public.metricas_sistema() from public, anon, authenticated;
grant execute on function public.abrir_chamado_suporte(text, text, text), public.responder_chamado_suporte(uuid, text),
  public.finalizar_chamado_suporte(uuid, text), public.metricas_sistema() to authenticated;
notify pgrst, 'reload schema';
