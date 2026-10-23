begin;

create schema comunicacao;
revoke all on schema comunicacao from public, anon, authenticated, concursa_dados;
grant usage on schema comunicacao to concursa_backend;

create table comunicacao.emails_transacionais (
  "idEmailTransacional" uuid primary key,
  tipo_evento text not null check (tipo_evento in ('EMAIL_VERIFICATION','WELCOME_EMAIL','PASSWORD_RESET','USER_INACTIVE')),
  "idUsuario" uuid,
  email_destinatario text not null check (length(email_destinatario) between 3 and 254),
  assunto text not null check (length(assunto) between 1 and 250),
  dados_template jsonb not null default '{}'::jsonb check (jsonb_typeof(dados_template)='object'),
  link_protegido text,
  validade_link_em timestamptz,
  status text not null default 'pendente' check (status in ('pendente','processando','aceito','entregue','falha','bounce','cancelado')),
  quantidade_tentativas integer not null default 0 check (quantidade_tentativas>=0),
  maximo_tentativas integer not null check (maximo_tentativas between 1 and 20),
  criado_em timestamptz not null default now(),
  agendado_em timestamptz not null,
  ultima_tentativa_em timestamptz,
  enviado_em timestamptz,
  entregue_em timestamptz,
  proxima_tentativa_em timestamptz,
  mensagem_erro text,
  id_mensagem_provedor text,
  chave_idempotencia text not null,
  identificador_processamento uuid,
  expiracao_reserva_em timestamptz,
  constraint emails_transacionais_reserva_check check (
    (status='processando' and identificador_processamento is not null and expiracao_reserva_em is not null)
    or (status<>'processando' and identificador_processamento is null and expiracao_reserva_em is null)
  ),
  constraint emails_transacionais_usuario_fk foreign key ("idUsuario") references public.usuarios("idUsuario") on delete set null
);
create unique index emails_transacionais_idempotencia_idx on comunicacao.emails_transacionais(chave_idempotencia);
create index emails_transacionais_pendentes_idx
  on comunicacao.emails_transacionais(status,proxima_tentativa_em,agendado_em)
  where status in ('pendente','processando');
create index emails_transacionais_provedor_idx
  on comunicacao.emails_transacionais(id_mensagem_provedor)
  where id_mensagem_provedor is not null;
create index emails_transacionais_usuario_criacao_idx
  on comunicacao.emails_transacionais("idUsuario",criado_em desc);
create index emails_transacionais_retencao_idx
  on comunicacao.emails_transacionais(criado_em)
  where status in ('aceito','entregue','falha','bounce','cancelado');

create table comunicacao.preferencias (
  "idUsuario" uuid primary key,
  receber_inatividade boolean not null default false,
  atualizado_em timestamptz not null default now(),
  constraint preferencias_idUsuario_fkey foreign key ("idUsuario") references public.usuarios("idUsuario") on delete cascade
);
create table comunicacao.workflows (
  tipo_evento text primary key check (tipo_evento in ('EMAIL_VERIFICATION','WELCOME_EMAIL','PASSWORD_RESET','USER_INACTIVE')),
  habilitado boolean not null,
  atualizado_em timestamptz not null default now()
);
create table comunicacao.eventos_resend (
  id_evento_webhook text primary key,
  id_mensagem_provedor text not null,
  tipo_evento text not null,
  recebido_em timestamptz not null default now()
);
create index eventos_resend_mensagem_idx on comunicacao.eventos_resend(id_mensagem_provedor);
create index eventos_resend_retencao_idx on comunicacao.eventos_resend(recebido_em);
create index usuarios_atividade_email_idx on public.usuarios(ultimo_acesso_em)
  where tipo='estudante' and estado_cadastro='ativo';

alter table comunicacao.emails_transacionais enable row level security;
alter table comunicacao.preferencias enable row level security;
alter table comunicacao.workflows enable row level security;
alter table comunicacao.eventos_resend enable row level security;
create policy backend_emails_transacionais on comunicacao.emails_transacionais
  to concursa_backend using (true) with check (true);
create policy backend_preferencias_comunicacao on comunicacao.preferencias
  to concursa_backend using (true) with check (true);
create policy backend_workflows_comunicacao on comunicacao.workflows
  to concursa_backend using (true) with check (true);
create policy backend_eventos_resend on comunicacao.eventos_resend
  to concursa_backend using (true) with check (true);
grant select,insert,update,delete on comunicacao.emails_transacionais to concursa_backend;
grant select,insert,update on comunicacao.preferencias to concursa_backend;
grant select,insert,update on comunicacao.workflows to concursa_backend;
grant select,insert,delete on comunicacao.eventos_resend to concursa_backend;
revoke all on all tables in schema comunicacao from public,anon,authenticated,concursa_dados;
alter default privileges in schema comunicacao revoke all on tables from public,anon,authenticated,concursa_dados;
notify pgrst, 'reload schema';
commit;
