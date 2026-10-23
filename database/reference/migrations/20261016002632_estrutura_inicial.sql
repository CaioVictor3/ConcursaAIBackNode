-- Concursa AI: estrutura inicial. Executar pelo Supabase CLI em uma transacao.
create extension if not exists pgcrypto with schema extensions;

create table public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome_completo text not null default '',
  email text not null default '',
  avatar_url text,
  papel text not null default 'estudante' check (papel in ('estudante', 'administrador')),
  estado_cadastro text not null default 'verificacao_pendente' check (estado_cadastro in ('ativo', 'convite_pendente', 'verificacao_pendente')),
  ultimo_acesso_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.concursos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) > 0),
  orgao text not null default '', cargo text not null default '', estado text not null default '',
  ano integer not null check (ano between 1900 and 2100),
  descricao text, status text not null default 'ativo' check (status in ('ativo', 'arquivado')),
  criado_em timestamptz not null default now()
);
create table public.bancas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) > 0), sigla text not null default '',
  criado_em timestamptz not null default now()
);
create table public.disciplinas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) > 0), descricao text not null default '',
  ativa boolean not null default true, criado_em timestamptz not null default now()
);
create table public.assuntos (
  id uuid primary key default gen_random_uuid(),
  disciplina_id uuid not null references public.disciplinas(id) on delete restrict,
  assunto_pai_id uuid references public.assuntos(id) on delete restrict,
  nome text not null check (length(btrim(nome)) > 0), descricao text,
  criado_em timestamptz not null default now(),
  unique (id, disciplina_id), check (id is distinct from assunto_pai_id),
  foreign key (assunto_pai_id, disciplina_id) references public.assuntos(id, disciplina_id)
);
create table public.questoes (
  id uuid primary key default gen_random_uuid(),
  concurso_id uuid references public.concursos(id) on delete restrict,
  banca_id uuid references public.bancas(id) on delete restrict,
  disciplina_id uuid not null references public.disciplinas(id) on delete restrict,
  assunto_id uuid,
  enunciado text not null check (length(btrim(enunciado)) > 0),
  tipo text not null default 'multipla_escolha' check (tipo = 'multipla_escolha'),
  dificuldade text not null default 'media' check (dificuldade in ('facil', 'media', 'dificil')),
  ano integer check (ano between 1900 and 2100),
  fonte text not null default '', imagem_url text, explicacao text not null default '',
  status text not null default 'rascunho' check (status in ('rascunho', 'publicada', 'arquivada')),
  criada_por uuid references auth.users(id) on delete set null,
  criada_em timestamptz not null default now(), atualizada_em timestamptz not null default now(),
  foreign key (assunto_id, disciplina_id) references public.assuntos(id, disciplina_id)
);
create table public.alternativas (
  id uuid primary key default gen_random_uuid(),
  questao_id uuid not null references public.questoes(id) on delete cascade,
  letra text not null check (length(btrim(letra)) > 0),
  texto text not null check (length(btrim(texto)) > 0),
  ordem integer not null check (ordem > 0), criada_em timestamptz not null default now(),
  unique (questao_id, id), unique (questao_id, letra), unique (questao_id, ordem)
);
create table public.gabaritos (
  questao_id uuid primary key references public.questoes(id) on delete cascade,
  alternativa_correta_id uuid,
  status text not null default 'definitivo' check (status in ('provisorio', 'definitivo', 'anulada')),
  explicacao text not null default '', fonte_gabarito text,
  atualizado_em timestamptz not null default now(),
  check ((status = 'anulada' and alternativa_correta_id is null) or
         (status <> 'anulada' and alternativa_correta_id is not null)),
  foreign key (questao_id, alternativa_correta_id)
    references public.alternativas(questao_id, id) deferrable initially deferred
);
create table public.simulados (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) > 0), descricao text not null default '',
  concurso_id uuid references public.concursos(id) on delete restrict,
  duracao_minutos integer check (duracao_minutos > 0),
  tipo text not null default 'padrao' check (tipo in ('padrao', 'personalizado')),
  publico boolean not null default true,
  criado_por uuid references auth.users(id) on delete set null,
  status text not null default 'rascunho' check (status in ('rascunho', 'publicado', 'arquivado')),
  criado_em timestamptz not null default now()
);
create table public.simulado_questoes (
  id uuid primary key default gen_random_uuid(),
  simulado_id uuid not null references public.simulados(id) on delete cascade,
  questao_id uuid not null references public.questoes(id) on delete restrict,
  ordem integer not null check (ordem > 0), peso numeric(10,2) not null default 1 check (peso > 0),
  criado_em timestamptz not null default now(),
  unique (simulado_id, questao_id), unique (simulado_id, ordem)
);
create table public.tentativas_simulado (
  id uuid primary key default gen_random_uuid(),
  simulado_id uuid not null references public.simulados(id) on delete restrict,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'em_andamento' check (status in ('em_andamento', 'finalizada', 'cancelada')),
  iniciada_em timestamptz not null default now(), finalizada_em timestamptz,
  pontuacao numeric(5,1), total_acertos integer not null default 0,
  total_erros integer not null default 0, total_nao_respondidas integer not null default 0,
  tempo_gasto_segundos integer not null default 0,
  correcao_json jsonb,
  check ((status = 'finalizada' and finalizada_em is not null and correcao_json is not null)
      or (status <> 'finalizada' and finalizada_em is null and correcao_json is null))
);
create table public.respostas_simulado (
  id uuid primary key default gen_random_uuid(),
  tentativa_id uuid not null references public.tentativas_simulado(id) on delete cascade,
  questao_id uuid not null references public.questoes(id) on delete restrict,
  alternativa_selecionada_id uuid,
  respondida_em timestamptz,
  unique (tentativa_id, questao_id),
  foreign key (questao_id, alternativa_selecionada_id) references public.alternativas(questao_id, id)
);

create index on public.questoes(concurso_id);
create index on public.questoes(banca_id);
create index on public.questoes(disciplina_id);
create index on public.questoes(assunto_id);
create index on public.questoes(ano);
create index on public.questoes(status);
create index on public.assuntos(disciplina_id);
create index on public.alternativas(questao_id);
create index on public.simulado_questoes(questao_id);
create index on public.tentativas_simulado(usuario_id, iniciada_em desc);
create index on public.respostas_simulado(tentativa_id);

-- auth.users e a fonte confiavel de email, verificacao e ultimo login.
create function public.sincronizar_perfil_autenticacao() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfis(id, nome_completo, email, avatar_url, estado_cadastro, ultimo_acesso_em)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nome_completo', ''),
          coalesce(new.email, ''), new.raw_user_meta_data ->> 'avatar_url',
          case when new.email_confirmed_at is not null then 'ativo'
               when new.invited_at is not null then 'convite_pendente'
               else 'verificacao_pendente' end, new.last_sign_in_at)
  on conflict (id) do update set
    email = excluded.email, estado_cadastro = excluded.estado_cadastro,
    ultimo_acesso_em = excluded.ultimo_acesso_em, atualizado_em = now();
  return new;
end $$;
revoke all on function public.sincronizar_perfil_autenticacao() from public, anon, authenticated;
create trigger ao_criar_usuario_concursa after insert on auth.users
  for each row execute function public.sincronizar_perfil_autenticacao();
create trigger ao_atualizar_usuario_concursa
  after update of email, email_confirmed_at, invited_at, last_sign_in_at on auth.users
  for each row execute function public.sincronizar_perfil_autenticacao();

create function public.eh_administrador() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.perfis where id = (select auth.uid())
    and papel = 'administrador' and estado_cadastro = 'ativo')
$$;
revoke all on function public.eh_administrador() from public, anon;
grant execute on function public.eh_administrador() to authenticated;

alter table public.perfis enable row level security;
alter table public.concursos enable row level security;
alter table public.bancas enable row level security;
alter table public.disciplinas enable row level security;
alter table public.assuntos enable row level security;
alter table public.questoes enable row level security;
alter table public.alternativas enable row level security;
alter table public.gabaritos enable row level security;
alter table public.simulados enable row level security;
alter table public.simulado_questoes enable row level security;
alter table public.tentativas_simulado enable row level security;
alter table public.respostas_simulado enable row level security;

-- Revogamos escrita direta; somente RPCs especificas alteram dados compostos.
revoke all on public.perfis, public.concursos, public.bancas, public.disciplinas,
  public.assuntos, public.questoes, public.alternativas, public.gabaritos,
  public.simulados, public.simulado_questoes, public.tentativas_simulado,
  public.respostas_simulado from public, anon, authenticated;
grant select on public.perfis, public.concursos, public.bancas, public.disciplinas,
  public.assuntos, public.alternativas, public.gabaritos,
  public.simulados, public.simulado_questoes, public.tentativas_simulado,
  public.respostas_simulado to authenticated;
-- A explicacao pode revelar a resposta. Ela so e lida via gabarito ou correcao.
grant select (id, concurso_id, banca_id, disciplina_id, assunto_id, enunciado,
  tipo, dificuldade, ano, fonte, imagem_url, status, criada_por, criada_em,
  atualizada_em) on public.questoes to authenticated;
grant insert, update, delete on public.concursos, public.bancas, public.disciplinas,
  public.assuntos to authenticated;

create policy perfis_leitura on public.perfis for select to authenticated
  using (id = (select auth.uid()) or (select public.eh_administrador()));
create policy referencias_leitura on public.concursos for select to authenticated using (true);
create policy referencias_escrita on public.concursos for all to authenticated
  using ((select public.eh_administrador())) with check ((select public.eh_administrador()));
create policy bancas_leitura on public.bancas for select to authenticated using (true);
create policy bancas_escrita on public.bancas for all to authenticated
  using ((select public.eh_administrador())) with check ((select public.eh_administrador()));
create policy disciplinas_leitura on public.disciplinas for select to authenticated using (true);
create policy disciplinas_escrita on public.disciplinas for all to authenticated
  using ((select public.eh_administrador())) with check ((select public.eh_administrador()));
create policy assuntos_leitura on public.assuntos for select to authenticated using (true);
create policy assuntos_escrita on public.assuntos for all to authenticated
  using ((select public.eh_administrador())) with check ((select public.eh_administrador()));
create policy questoes_leitura on public.questoes for select to authenticated
  using (status = 'publicada' or (select public.eh_administrador()));
create policy alternativas_leitura on public.alternativas for select to authenticated
  using (exists (select 1 from public.questoes q where q.id = questao_id));
create policy gabaritos_admin on public.gabaritos for select to authenticated
  using ((select public.eh_administrador()));
create policy simulados_leitura on public.simulados for select to authenticated
  using ((status = 'publicado' and publico) or (select public.eh_administrador()));
create policy simulado_questoes_leitura on public.simulado_questoes for select to authenticated
  using (exists (select 1 from public.simulados s where s.id = simulado_id));
create policy tentativas_proprietario on public.tentativas_simulado for select to authenticated
  using (usuario_id = (select auth.uid()));
create policy respostas_proprietario on public.respostas_simulado for select to authenticated
  using (exists (select 1 from public.tentativas_simulado t
    where t.id = tentativa_id and t.usuario_id = (select auth.uid())));

-- Todos os RPCs exigem sessao ativa. As tabelas de notas e papeis nao aceitam escrita pelo browser.
create function public.salvar_questao(p_questao jsonb, p_alternativas jsonb,
  p_gabarito jsonb, p_id uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_alt jsonb; v_ids uuid[] := '{}';
begin
  if not public.eh_administrador() then raise exception 'Acesso negado'; end if;
  if jsonb_typeof(p_alternativas) <> 'array' or jsonb_array_length(p_alternativas) < 2 then
    raise exception 'Informe pelo menos duas alternativas'; end if;
  if p_id is not null and not exists(select 1 from public.questoes where id = p_id) then
    raise exception 'Questao nao encontrada'; end if;
  if p_id is not null and exists(select 1 from public.simulado_questoes sq
      join public.tentativas_simulado t on t.simulado_id = sq.simulado_id
      where sq.questao_id = p_id) then
    raise exception 'Questao com tentativas registradas nao pode ser editada'; end if;
  if p_id is not null and exists(select 1 from public.simulado_questoes sq
      join public.simulados s on s.id = sq.simulado_id
      where sq.questao_id = p_id and s.status = 'publicado') then
    raise exception 'Retire a questao dos simulados publicados antes de editar'; end if;
  insert into public.questoes(id, concurso_id, banca_id, disciplina_id, assunto_id,
    enunciado, tipo, dificuldade, ano, fonte, imagem_url, explicacao, status, criada_por)
  values(v_id, (p_questao->>'concurso_id')::uuid, (p_questao->>'banca_id')::uuid,
    (p_questao->>'disciplina_id')::uuid, (p_questao->>'assunto_id')::uuid,
    p_questao->>'enunciado', coalesce(p_questao->>'tipo','multipla_escolha'),
    p_questao->>'dificuldade', (p_questao->>'ano')::integer,
    coalesce(p_questao->>'fonte',''), p_questao->>'imagem_url',
    '', p_questao->>'status', auth.uid())
  on conflict (id) do update set concurso_id = excluded.concurso_id,
    banca_id = excluded.banca_id, disciplina_id = excluded.disciplina_id,
    assunto_id = excluded.assunto_id, enunciado = excluded.enunciado,
    dificuldade = excluded.dificuldade, ano = excluded.ano, fonte = excluded.fonte,
    imagem_url = excluded.imagem_url, explicacao = excluded.explicacao,
    status = excluded.status, atualizada_em = now();
  delete from public.gabaritos where questao_id = v_id;
  delete from public.alternativas where questao_id = v_id;
  for v_alt in select item from jsonb_array_elements(p_alternativas) as lista(item) loop
    insert into public.alternativas(id, questao_id, letra, texto, ordem)
    values ((v_alt->>'id')::uuid, v_id, upper(btrim(v_alt->>'letra')),
      v_alt->>'texto', (v_alt->>'ordem')::integer);
    v_ids := array_append(v_ids, (v_alt->>'id')::uuid);
  end loop;
  if p_gabarito->>'status' <> 'anulada' and
     not ((p_gabarito->>'alternativa_correta_id')::uuid = any(v_ids)) then
    raise exception 'Gabarito invalido'; end if;
  insert into public.gabaritos(questao_id, alternativa_correta_id, status, explicacao)
  values (v_id, (p_gabarito->>'alternativa_correta_id')::uuid,
    p_gabarito->>'status', coalesce(p_gabarito->>'explicacao', ''));
  return v_id;
end $$;

create function public.salvar_simulado(p_simulado jsonb, p_questao_ids uuid[],
  p_id uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_questao uuid; v_ordem integer := 0;
begin
  if not public.eh_administrador() then raise exception 'Acesso negado'; end if;
  if coalesce(array_length(p_questao_ids, 1), 0) = 0 or
     (select count(distinct questao_id) from unnest(p_questao_ids) as lista(questao_id)) <> array_length(p_questao_ids, 1) then
    raise exception 'Selecione questoes sem repeticao'; end if;
  if exists(select 1 from unnest(p_questao_ids) as lista(questao_id) left join public.questoes q
    on q.id = lista.questao_id where q.status is distinct from 'publicada') then
    raise exception 'Todas as questoes devem estar publicadas'; end if;
  if p_id is not null and exists(select 1 from public.tentativas_simulado where simulado_id = p_id) then
    raise exception 'Simulado com tentativas nao pode ser editado'; end if;
  if p_id is not null and not exists(select 1 from public.simulados where id = p_id) then
    raise exception 'Simulado nao encontrado'; end if;
  insert into public.simulados(id, nome, descricao, concurso_id, duracao_minutos,
    tipo, publico, status, criado_por)
  values(v_id, p_simulado->>'nome', coalesce(p_simulado->>'descricao',''),
    (p_simulado->>'concurso_id')::uuid, (p_simulado->>'duracao_minutos')::integer,
    p_simulado->>'tipo', (p_simulado->>'publico')::boolean,
    p_simulado->>'status', auth.uid())
  on conflict (id) do update set nome = excluded.nome, descricao = excluded.descricao,
    concurso_id = excluded.concurso_id, duracao_minutos = excluded.duracao_minutos,
    tipo = excluded.tipo, publico = excluded.publico, status = excluded.status;
  delete from public.simulado_questoes where simulado_id = v_id;
  foreach v_questao in array p_questao_ids loop
    v_ordem := v_ordem + 1;
    insert into public.simulado_questoes(simulado_id, questao_id, ordem)
    values(v_id, v_questao, v_ordem);
  end loop;
  return v_id;
end $$;

create function public.iniciar_tentativa(p_simulado_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Autenticacao necessaria'; end if;
  if not exists(select 1 from public.simulados where id = p_simulado_id
    and status = 'publicado' and publico = true) then raise exception 'Simulado indisponivel'; end if;
  insert into public.tentativas_simulado(simulado_id, usuario_id)
    values(p_simulado_id, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create function public.responder_questao(p_tentativa_id uuid, p_questao_id uuid,
  p_alternativa_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_simulado_id uuid;
begin
  select simulado_id into v_simulado_id from public.tentativas_simulado
  where id = p_tentativa_id and usuario_id = auth.uid() and status = 'em_andamento'
  for update;
  if v_simulado_id is null then raise exception 'Tentativa indisponivel'; end if;
  if not exists(select 1 from public.simulado_questoes
    where simulado_id = v_simulado_id and questao_id = p_questao_id) then
    raise exception 'Questao fora do simulado'; end if;
  if p_alternativa_id is not null and not exists(select 1 from public.alternativas
    where id = p_alternativa_id and questao_id = p_questao_id) then
    raise exception 'Alternativa invalida'; end if;
  insert into public.respostas_simulado(tentativa_id, questao_id,
    alternativa_selecionada_id, respondida_em)
  values(p_tentativa_id, p_questao_id, p_alternativa_id,
    case when p_alternativa_id is null then null else now() end)
  on conflict (tentativa_id, questao_id) do update set
    alternativa_selecionada_id = excluded.alternativa_selecionada_id,
    respondida_em = excluded.respondida_em;
end $$;

create function public.finalizar_tentativa(p_tentativa_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_tentativa public.tentativas_simulado%rowtype; v_itens jsonb; v_acertos integer;
  v_erros integer; v_vazias integer; v_total integer; v_pontuacao numeric(5,1);
  v_resultado jsonb;
begin
  select * into v_tentativa from public.tentativas_simulado
    where id = p_tentativa_id and usuario_id = auth.uid() for update;
  if not found then raise exception 'Tentativa nao encontrada'; end if;
  if v_tentativa.status <> 'em_andamento' then raise exception 'Tentativa ja encerrada'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'questao_id', sq.questao_id,
      'alternativa_selecionada_id', r.alternativa_selecionada_id,
      'alternativa_correta_id', case when g.status = 'anulada' then null else g.alternativa_correta_id end,
      'anulada', g.status = 'anulada',
      'acertou', coalesce(g.status = 'anulada' or r.alternativa_selecionada_id = g.alternativa_correta_id, false),
      'explicacao', coalesce(nullif(g.explicacao,''), q.explicacao)) order by sq.ordem), '[]'::jsonb),
    count(*)::integer,
    count(*) filter (where g.status = 'anulada' or r.alternativa_selecionada_id = g.alternativa_correta_id)::integer,
    count(*) filter (where g.status <> 'anulada' and r.alternativa_selecionada_id is null)::integer
  into v_itens, v_total, v_acertos, v_vazias
  from public.simulado_questoes sq
  join public.questoes q on q.id = sq.questao_id
  join public.gabaritos g on g.questao_id = q.id
  left join public.respostas_simulado r on r.tentativa_id = v_tentativa.id and r.questao_id = q.id
  where sq.simulado_id = v_tentativa.simulado_id;
  if v_total <> (select count(*) from public.simulado_questoes
      where simulado_id = v_tentativa.simulado_id) then
    raise exception 'Simulado possui questao sem gabarito'; end if;
  v_erros := v_total - v_acertos - v_vazias;
  v_pontuacao := case when v_total = 0 then 0
    else round(v_acertos::numeric * 100 / v_total, 1) end;
  update public.tentativas_simulado set status = 'finalizada', finalizada_em = now(),
    pontuacao = v_pontuacao, total_acertos = v_acertos, total_erros = v_erros,
    total_nao_respondidas = v_vazias,
    tempo_gasto_segundos = greatest(0, extract(epoch from now() - iniciada_em)::integer),
    correcao_json = v_itens where id = p_tentativa_id returning * into v_tentativa;
  v_resultado := jsonb_build_object('tentativa_id', v_tentativa.id, 'itens', v_itens);
  return v_resultado;
end $$;

-- Corrige a partir do registro imutavel gravado na finalizacao; nunca revela antes.
create function public.obter_resultado_tentativa(p_tentativa_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('tentativa_id', id, 'itens', correcao_json)
  from public.tentativas_simulado where id = p_tentativa_id
    and usuario_id = (select auth.uid()) and status = 'finalizada'
$$;

revoke all on function public.salvar_questao(jsonb,jsonb,jsonb,uuid),
  public.salvar_simulado(jsonb,uuid[],uuid), public.iniciar_tentativa(uuid),
  public.responder_questao(uuid,uuid,uuid), public.finalizar_tentativa(uuid),
  public.obter_resultado_tentativa(uuid) from public, anon;
grant execute on function public.salvar_questao(jsonb,jsonb,jsonb,uuid),
  public.salvar_simulado(jsonb,uuid[],uuid), public.iniciar_tentativa(uuid),
  public.responder_questao(uuid,uuid,uuid), public.finalizar_tentativa(uuid),
  public.obter_resultado_tentativa(uuid) to authenticated;

-- Backfill para usuarios que existiam antes desta migration; preserva papeis atuais.
insert into public.perfis(id, nome_completo, email, estado_cadastro, ultimo_acesso_em)
select id, coalesce(raw_user_meta_data ->> 'nome_completo', ''), coalesce(email, ''),
  case when email_confirmed_at is not null then 'ativo'
       when invited_at is not null then 'convite_pendente'
       else 'verificacao_pendente' end, last_sign_in_at from auth.users
on conflict (id) do nothing;
