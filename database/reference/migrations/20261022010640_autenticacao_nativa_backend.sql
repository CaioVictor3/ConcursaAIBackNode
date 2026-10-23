begin;

-- A autenticação passa ao backend. IDs, perfis, senhas e demais dados são preservados.
do $$ begin
  if exists(select 1 from public.usuarios group by lower(btrim(email)) having count(*)>1) then raise exception 'Resolva os e-mails duplicados antes de migrar a autenticação'; end if;
  if exists(select 1 from public.usuarios where "idUsuario"<>"idPessoa") then raise exception 'Revise os identificadores de usuário/pessoa antes de migrar a autenticação'; end if;
  if not exists(select 1 from pg_roles where rolname='concursa_backend') then create role concursa_backend nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole; end if;
  if not exists(select 1 from pg_roles where rolname='concursa_dados') then create role concursa_dados nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole; end if;
end $$;
grant concursa_dados to concursa_backend;
create schema identidade;
revoke all on schema identidade from public,anon,authenticated,concursa_dados;
grant usage on schema identidade to concursa_backend;

create table identidade.contas (
  "idUsuario" uuid primary key references public.usuarios("idUsuario") on delete cascade,
  email_normalizado text not null unique check(email_normalizado=lower(btrim(email_normalizado))),
  senha_hash text,
  formato_senha text check(formato_senha in ('bcrypt','aspnet')),
  email_confirmado_em timestamptz,
  versao_credenciais integer not null default 0,
  falhas_senha integer not null default 0,
  bloqueado_ate timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check ((senha_hash is null)=(formato_senha is null))
);
create table identidade.identidades_externas (
  provedor text not null check(provedor='google'),
  sujeito text not null check(length(sujeito) between 1 and 255),
  "idUsuario" uuid not null references identidade.contas("idUsuario") on delete cascade,
  email_verificado text not null,
  criada_em timestamptz not null default now(),
  primary key(provedor,sujeito),
  unique("idUsuario",provedor)
);
create table identidade.sessoes (
  "idSessao" uuid primary key,
  "idUsuario" uuid not null references identidade.contas("idUsuario") on delete cascade,
  refresh_hash text not null unique check(length(refresh_hash)=64),
  criada_em timestamptz not null default now(),
  expira_em timestamptz not null,
  revogada_em timestamptz,
  renovada_em timestamptz
);
create index sessoes_usuario_idx on identidade.sessoes("idUsuario");
create table identidade.renovacoes_usadas (
  refresh_hash text primary key check(length(refresh_hash)=64),
  "idSessao" uuid not null references identidade.sessoes("idSessao") on delete cascade,
  usada_em timestamptz not null default now()
);
create table identidade.tokens_email (
  token_hash text primary key check(length(token_hash)=64),
  "idUsuario" uuid not null references identidade.contas("idUsuario") on delete cascade,
  finalidade text not null check(finalidade in ('confirmacao','recuperacao')),
  email_normalizado text not null,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  usado_em timestamptz
);
create index tokens_email_usuario_idx on identidade.tokens_email("idUsuario",finalidade,criado_em desc);

-- A cópia dos hashes ocorre dentro do banco. Nunca exporta hashes ou senhas.
insert into identidade.contas("idUsuario",email_normalizado,senha_hash,formato_senha,email_confirmado_em,criado_em)
select u."idUsuario",lower(btrim(u.email)),nullif(a.encrypted_password,''),case when nullif(a.encrypted_password,'') is not null then 'bcrypt' end,a.email_confirmed_at,u.criado_em
from public.usuarios u join auth.users a on a.id=u."idUsuario";
do $$ begin
  if (select count(*) from identidade.contas)<>(select count(*) from public.usuarios) then raise exception 'Há contas sem registro de autenticação; migração cancelada'; end if;
  if exists(select 1 from identidade.contas where formato_senha='bcrypt' and senha_hash !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$') then raise exception 'Formato de hash legado não suportado; migração cancelada'; end if;
end $$;
-- Identidades Google anteriores, se existirem, conservam o identificador do provedor.
insert into identidade.identidades_externas(provedor,sujeito,"idUsuario",email_verificado)
select 'google',i.provider_id,i.user_id,coalesce(i.identity_data->>'email',u.email)
from auth.identities i join public.usuarios u on u."idUsuario"=i.user_id where i.provider='google';

-- Remove somente os vínculos com o serviço Auth; os vínculos de negócio continuam.
alter table public.pessoas drop constraint "pessoas_idPessoa_fkey";
alter table public.usuarios drop constraint usuarios_autenticacao_fk;
alter table public.questoes drop constraint questoes_criada_por_fkey;
alter table public.questoes add constraint questoes_criada_por_fkey foreign key("idPessoaCriadora") references public.pessoas("idPessoa") on delete set null;
alter table public.simulados drop constraint simulados_criado_por_fkey;
alter table public.simulados add constraint simulados_criado_por_fkey foreign key("idPessoaCriadora") references public.pessoas("idPessoa") on delete set null;
alter table public.tentativas_simulado drop constraint tentativas_simulado_usuario_id_fkey;
alter table public.tentativas_simulado add constraint tentativas_simulado_usuario_id_fkey foreign key("idPessoa") references public.pessoas("idPessoa") on delete cascade;
drop trigger if exists ao_criar_usuario_senha on auth.users;
drop trigger if exists ao_criar_usuario_concursa on auth.users;
drop trigger if exists ao_atualizar_usuario_concursa on auth.users;

create function identidade.criar_conta(p_id uuid,p_email text,p_hash text,p_formato text,p_confirmado timestamptz,p_pessoa jsonb,p_completo boolean) returns uuid
language plpgsql security definer set search_path='' as $$
begin
  insert into public.pessoas("idPessoa",nome_completo,data_nascimento,cpf,cep,logradouro,numero,complemento,bairro,cidade,uf)
  values(p_id,btrim(coalesce(p_pessoa->>'nome_completo','')),(nullif(p_pessoa->>'data_nascimento',''))::date,nullif(p_pessoa->>'cpf',''),nullif(p_pessoa->>'cep',''),nullif(p_pessoa->>'logradouro',''),nullif(p_pessoa->>'numero',''),nullif(p_pessoa->>'complemento',''),nullif(p_pessoa->>'bairro',''),nullif(p_pessoa->>'cidade',''),nullif(p_pessoa->>'uf',''));
  insert into public.usuarios("idUsuario","idPessoa",nome_completo,email,tipo,estado_cadastro,cadastro_completo)
  values(p_id,p_id,btrim(coalesce(p_pessoa->>'nome_completo','')),btrim(p_email),'estudante',case when p_confirmado is not null then 'ativo' else 'verificacao_pendente' end,p_completo);
  insert into identidade.contas("idUsuario",email_normalizado,senha_hash,formato_senha,email_confirmado_em) values(p_id,lower(btrim(p_email)),p_hash,p_formato,p_confirmado);
  if p_completo then insert into public.estudantes("idEstudante") values(p_id) on conflict do nothing; end if;
  return p_id;
end $$;
revoke all on function identidade.criar_conta(uuid,text,text,text,timestamptz,jsonb,boolean) from public,anon,authenticated,concursa_dados;
grant execute on function identidade.criar_conta(uuid,text,text,text,timestamptz,jsonb,boolean) to concursa_backend;
grant select,insert,update,delete on all tables in schema identidade to concursa_backend;
grant select on public.usuarios to concursa_backend;
grant update(ultimo_acesso_em,estado_cadastro,atualizado_em) on public.usuarios to concursa_backend;
create policy autenticacao_consultar_perfis on public.usuarios for select to concursa_backend using(true);
create policy autenticacao_atualizar_acesso on public.usuarios for update to concursa_backend using(true) with check(true);

-- Copia as permissões exatas e estende as mesmas políticas RLS ao papel exclusivo do backend.
-- authenticated/anon perdem acesso: JWTs antigos do Supabase não acessam mais o acervo.
do $$ declare t record;a record;p text;cols text;r record;nomes text;
begin
  for t in select c.oid,n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m','p') loop
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('authenticated',t.oid,p) then execute format('grant %s on %I.%I to concursa_dados',p,t.nspname,t.relname); end if;
    end loop;
    for a in select attname,attnum from pg_attribute where attrelid=t.oid and attnum>0 and not attisdropped loop
      foreach p in array array['SELECT','INSERT','UPDATE','REFERENCES'] loop
        if not has_table_privilege('authenticated',t.oid,p) and has_column_privilege('authenticated',t.oid,a.attnum,p) then
          execute format('grant %s(%I) on %I.%I to concursa_dados',p,a.attname,t.nspname,t.relname);
        end if;
      end loop;
      execute format('revoke all(%I) on %I.%I from public,anon,authenticated',a.attname,t.nspname,t.relname);
    end loop;
    execute format('revoke all on %I.%I from public,anon,authenticated',t.nspname,t.relname);
    for r in select polname,polroles from pg_policy where polrelid=t.oid and (select oid from pg_roles where rolname='authenticated')=any(polroles) loop
      select string_agg(case when x=0 then 'public' else quote_ident(pg_get_userbyid(x)) end,',') into nomes from unnest(r.polroles) x;
      execute format('alter policy %I on %I.%I to %s,concursa_dados',r.polname,t.nspname,t.relname,nomes);
    end loop;
  end loop;
  for t in select p.oid,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','provas_privado','suporte_privado') and p.prokind='f' loop
    if has_function_privilege('authenticated',t.oid,'execute') then execute format('grant execute on function %I.%I(%s) to concursa_dados',t.nspname,t.proname,t.args); end if;
    execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',t.nspname,t.proname,t.args);
  end loop;
end $$;
grant usage on schema public,provas_privado,suporte_privado,auth to concursa_dados;
grant execute on function auth.uid(),auth.jwt() to concursa_dados;
-- Tabelas privadas não são expostas na Data API. A conexão de servidor tem acesso explícito.
alter table identidade.contas enable row level security;
alter table identidade.identidades_externas enable row level security;
alter table identidade.sessoes enable row level security;
alter table identidade.renovacoes_usadas enable row level security;
alter table identidade.tokens_email enable row level security;
create policy backend_contas on identidade.contas to concursa_backend using(true) with check(true);
create policy backend_identidades on identidade.identidades_externas to concursa_backend using(true) with check(true);
create policy backend_sessoes on identidade.sessoes to concursa_backend using(true) with check(true);
create policy backend_renovacoes on identidade.renovacoes_usadas to concursa_backend using(true) with check(true);
create policy backend_tokens on identidade.tokens_email to concursa_backend using(true) with check(true);
alter default privileges in schema public revoke all on tables from anon,authenticated;
alter default privileges in schema public revoke execute on functions from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
