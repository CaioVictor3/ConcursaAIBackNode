begin;

create schema if not exists honra_privado;
revoke all on schema honra_privado from public, anon, authenticated, concursa_dados;

create table public.honra_titulos (
  id uuid primary key default gen_random_uuid(),
  nivel integer not null unique check (nivel > 0),
  nome text not null check (length(btrim(nome)) between 2 and 100),
  descricao text not null default '',
  pontuacao_minima integer not null unique check (pontuacao_minima >= 0),
  icone text not null default 'estrela',
  cor text not null default '#59677b' check (cor ~ '^#[0-9A-Fa-f]{6}$'),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

insert into public.honra_titulos(nivel, nome, descricao, pontuacao_minima, icone, cor) values
  (1, 'Iniciante', 'O primeiro passo de uma jornada de estudos.', 0, 'semente', '#789786'),
  (2, 'Aprendiz', 'A curiosidade se transforma em hábito.', 100, 'livro', '#5B9B9D'),
  (3, 'Explorador', 'Novos temas, novas descobertas.', 300, 'bussola', '#5187AC'),
  (4, 'Estudioso', 'A dedicação ganha ritmo.', 700, 'caderno', '#7286C5'),
  (5, 'Conhecedor', 'O conhecimento começa a se consolidar.', 1500, 'lampada', '#9B77C1'),
  (6, 'Especialista', 'Seu domínio cresce a cada desafio.', 3000, 'diamante', '#BB76AA'),
  (7, 'Mestre', 'Experiência construída com constância.', 5500, 'estrela', '#C98973'),
  (8, 'Sábio', 'Aprender também é saber compartilhar.', 9000, 'sol', '#C49A54'),
  (9, 'Grão-Mestre', 'Uma trajetória de dedicação extraordinária.', 14000, 'constelacao', '#B88A4C'),
  (10, 'Lendário', 'Uma conquista que inspira novas jornadas.', 22000, 'coroa', '#D5A844')
on conflict (nivel) do nothing;

create table public.honra_regras (
  codigo text primary key,
  descricao text not null,
  pontos integer not null check (pontos between 0 and 10000),
  minimo_questoes integer not null default 0 check (minimo_questoes >= 0),
  minimo_questoes_ineditas integer not null default 0 check (minimo_questoes_ineditas >= 0),
  percentual_minimo_respostas integer not null default 0 check (percentual_minimo_respostas between 0 and 100),
  limite_diario integer not null default 0 check (limite_diario >= 0),
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);

insert into public.honra_regras(codigo, descricao, pontos, minimo_questoes, minimo_questoes_ineditas, percentual_minimo_respostas, limite_diario) values
  ('primeira_resolucao', 'Primeira resposta válida de uma questão definitiva.', 2, 0, 0, 0, 0),
  ('primeiro_acerto', 'Acerto da primeira resposta válida.', 1, 0, 0, 0, 0),
  ('revisao', 'Uma questão já resolvida não concede novos pontos.', 0, 0, 0, 0, 0),
  ('prova_concluida', 'Prova finalizada com participação suficiente e questões inéditas.', 20, 5, 3, 80, 1),
  ('simulado_concluido', 'Simulado finalizado com participação suficiente e questões inéditas.', 15, 5, 3, 80, 1),
  ('primeiro_estudo_diario', 'Primeira questão inédita respondida no dia.', 10, 0, 0, 0, 1),
  ('sequencia_sete_dias', 'Cada ciclo completo de sete dias consecutivos de estudo válido.', 50, 0, 0, 0, 0)
on conflict (codigo) do nothing;

create table public.honra_progresso (
  id_pessoa uuid primary key references public.pessoas("idPessoa") on delete cascade,
  pontos_acumulados integer not null default 0,
  atualizado_em timestamptz not null default now()
);

create table public.honra_movimentacoes (
  id bigint generated always as identity primary key,
  id_pessoa uuid not null references public.pessoas("idPessoa") on delete cascade,
  codigo_regra text references public.honra_regras(codigo),
  tipo_origem text not null,
  id_origem text not null,
  pontos integer not null check (pontos <> 0),
  descricao text not null,
  chave_idempotencia text not null unique,
  justificativa text,
  id_administrador uuid references public.usuarios("idUsuario"),
  criado_em timestamptz not null default now()
);
create index honra_movimentacoes_pessoa_data_idx on public.honra_movimentacoes(id_pessoa, criado_em desc, id desc);
create index honra_movimentacoes_regra_data_idx on public.honra_movimentacoes(codigo_regra, criado_em desc);

create table public.honra_questoes_pontuadas (
  id_pessoa uuid not null references public.pessoas("idPessoa") on delete cascade,
  id_questao uuid not null references public.questoes("idQuestao") on delete restrict,
  id_tentativa_primeira uuid not null references public.tentativas_simulado("idTentativa") on delete restrict,
  id_alternativa_primeira uuid not null references public.alternativas("idAlternativa") on delete restrict,
  pontos_resolucao_regra integer not null,
  pontos_acerto_regra integer not null,
  pontos_atribuidos integer not null default 0,
  versao_ajuste integer not null default 0,
  criada_em timestamptz not null default now(),
  primary key (id_pessoa, id_questao)
);
create index honra_questoes_tentativa_idx on public.honra_questoes_pontuadas(id_tentativa_primeira);

create table public.honra_dias_estudo (
  id_pessoa uuid not null references public.pessoas("idPessoa") on delete cascade,
  dia date not null,
  dias_consecutivos integer not null check (dias_consecutivos > 0),
  primeira_atividade_em timestamptz not null default now(),
  primary key (id_pessoa, dia)
);

create table public.honra_alteracoes_configuracao (
  id bigint generated always as identity primary key,
  id_administrador uuid not null references public.usuarios("idUsuario"),
  tipo text not null,
  identificador text not null,
  valor_anterior jsonb,
  valor_novo jsonb not null,
  criado_em timestamptz not null default now()
);

create table public.anotacoes_pessoais_questoes (
  id_pessoa uuid not null references public.pessoas("idPessoa") on delete cascade,
  id_questao uuid not null references public.questoes("idQuestao") on delete cascade,
  conteudo text not null check (length(btrim(conteudo)) between 1 and 10000),
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  primary key (id_pessoa, id_questao)
);

alter table public.honra_titulos enable row level security;
alter table public.honra_regras enable row level security;
alter table public.honra_progresso enable row level security;
alter table public.honra_movimentacoes enable row level security;
alter table public.honra_questoes_pontuadas enable row level security;
alter table public.honra_dias_estudo enable row level security;
alter table public.honra_alteracoes_configuracao enable row level security;
alter table public.anotacoes_pessoais_questoes enable row level security;

create policy honra_titulos_leitura on public.honra_titulos for select to concursa_dados using (true);
create policy honra_regras_leitura on public.honra_regras for select to concursa_dados using (true);
create policy honra_progresso_leitura on public.honra_progresso for select to concursa_dados using (id_pessoa = (select auth.uid()) or (select public.eh_administrador()));
create policy honra_movimentacoes_leitura on public.honra_movimentacoes for select to concursa_dados using (id_pessoa = (select auth.uid()) or (select public.eh_administrador()));
create policy honra_questoes_leitura on public.honra_questoes_pontuadas for select to concursa_dados using (id_pessoa = (select auth.uid()) or (select public.eh_administrador()));
create policy honra_dias_leitura on public.honra_dias_estudo for select to concursa_dados using (id_pessoa = (select auth.uid()) or (select public.eh_administrador()));
create policy honra_alteracoes_leitura on public.honra_alteracoes_configuracao for select to concursa_dados using ((select public.eh_administrador()));
create policy anotacoes_leitura on public.anotacoes_pessoais_questoes for select to concursa_dados using (id_pessoa = (select auth.uid()));

revoke all on public.honra_titulos, public.honra_regras, public.honra_progresso,
  public.honra_movimentacoes, public.honra_questoes_pontuadas, public.honra_dias_estudo,
  public.honra_alteracoes_configuracao, public.anotacoes_pessoais_questoes
  from public, anon, authenticated, concursa_dados;
grant select on public.honra_titulos, public.honra_regras, public.honra_progresso,
  public.honra_movimentacoes, public.honra_questoes_pontuadas, public.honra_dias_estudo,
  public.honra_alteracoes_configuracao, public.anotacoes_pessoais_questoes to concursa_dados;

create function honra_privado.registrar_movimentacao(
  p_id_pessoa uuid, p_codigo_regra text, p_tipo_origem text, p_id_origem text,
  p_pontos integer, p_descricao text, p_chave text, p_justificativa text default null,
  p_id_administrador uuid default null, p_permitir_saldo_negativo boolean default false
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_inseriu boolean;
begin
  if p_pontos = 0 then return false; end if;

  insert into public.honra_progresso(id_pessoa) values (p_id_pessoa) on conflict do nothing;
  perform 1 from public.honra_progresso where id_pessoa = p_id_pessoa for update;

  if not p_permitir_saldo_negativo and
    (select pontos_acumulados from public.honra_progresso where id_pessoa = p_id_pessoa) + p_pontos < 0 then
    raise exception 'O ajuste não pode deixar o saldo de Honra negativo';
  end if;

  insert into public.honra_movimentacoes(
    id_pessoa, codigo_regra, tipo_origem, id_origem, pontos, descricao,
    chave_idempotencia, justificativa, id_administrador
  ) values (
    p_id_pessoa, p_codigo_regra, p_tipo_origem, p_id_origem, p_pontos, p_descricao,
    p_chave, p_justificativa, p_id_administrador
  ) on conflict (chave_idempotencia) do nothing;
  v_inseriu := found;

  if v_inseriu then
    update public.honra_progresso set pontos_acumulados = pontos_acumulados + p_pontos,
      atualizado_em = now() where id_pessoa = p_id_pessoa;
  end if;

  return v_inseriu;
end $$;

create function honra_privado.registrar_dia_estudo(p_id_pessoa uuid, p_id_questao uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_dia date; v_sequencia integer; v_regra public.honra_regras;
begin
  v_dia := (now() at time zone 'America/Sao_Paulo')::date;
  if exists(select 1 from public.honra_dias_estudo where id_pessoa = p_id_pessoa and dia = v_dia) then return; end if;

  select coalesce(max(dias_consecutivos), 0) + 1 into v_sequencia
  from public.honra_dias_estudo where id_pessoa = p_id_pessoa and dia = v_dia - 1;

  insert into public.honra_dias_estudo(id_pessoa, dia, dias_consecutivos)
  values (p_id_pessoa, v_dia, v_sequencia) on conflict do nothing;
  if not found then return; end if;

  select * into v_regra from public.honra_regras where codigo = 'primeiro_estudo_diario' and ativo;
  if found then
    perform honra_privado.registrar_movimentacao(p_id_pessoa, v_regra.codigo, 'dia_estudo', v_dia::text,
      v_regra.pontos, 'Primeiro estudo válido do dia', 'estudo:' || p_id_pessoa || ':' || v_dia);
  end if;

  if v_sequencia % 7 = 0 then
    select * into v_regra from public.honra_regras where codigo = 'sequencia_sete_dias' and ativo;
    if found then
      perform honra_privado.registrar_movimentacao(p_id_pessoa, v_regra.codigo, 'sequencia_estudo', v_dia::text,
        v_regra.pontos, 'Sequência de sete dias de estudo', 'sequencia:' || p_id_pessoa || ':' || v_dia);
    end if;
  end if;
end $$;

create function honra_privado.pontuar_primeira_resposta() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_pessoa uuid; v_gabarito public.gabaritos; v_resolucao public.honra_regras;
  v_acerto public.honra_regras; v_pontos_resolucao integer; v_pontos_acerto integer;
begin
  if new."idAlternativaSelecionada" is null then return new; end if;

  select t."idPessoa" into v_pessoa from public.tentativas_simulado t
  where t."idTentativa" = new."idTentativa";
  if v_pessoa is null then return new; end if;

  -- O bloqueio do gabarito sincroniza respostas com retificações concorrentes.
  select * into v_gabarito from public.gabaritos where "idQuestao" = new."idQuestao" for share;
  if not found or v_gabarito.status <> 'definitivo' then return new; end if;

  -- A linha de progresso serializa respostas concorrentes da mesma pessoa.
  insert into public.honra_progresso(id_pessoa) values (v_pessoa) on conflict do nothing;
  perform 1 from public.honra_progresso where id_pessoa = v_pessoa for update;

  select * into v_resolucao from public.honra_regras where codigo = 'primeira_resolucao';
  select * into v_acerto from public.honra_regras where codigo = 'primeiro_acerto';
  v_pontos_resolucao := case when v_resolucao.ativo then v_resolucao.pontos else 0 end;
  v_pontos_acerto := case when v_acerto.ativo then v_acerto.pontos else 0 end;

  insert into public.honra_questoes_pontuadas(
    id_pessoa, id_questao, id_tentativa_primeira, id_alternativa_primeira,
    pontos_resolucao_regra, pontos_acerto_regra, pontos_atribuidos
  ) values (
    v_pessoa, new."idQuestao", new."idTentativa", new."idAlternativaSelecionada",
    v_pontos_resolucao, v_pontos_acerto,
    v_pontos_resolucao + case when new."idAlternativaSelecionada" = v_gabarito."idAlternativaCorreta" then v_pontos_acerto else 0 end
  ) on conflict (id_pessoa, id_questao) do nothing;
  if not found then return new; end if;

  if v_pontos_resolucao > 0 then
    perform honra_privado.registrar_movimentacao(v_pessoa, 'primeira_resolucao', 'questao', new."idQuestao"::text,
      v_pontos_resolucao, 'Primeira resolução válida da questão', 'questao:' || v_pessoa || ':' || new."idQuestao");
  end if;

  if new."idAlternativaSelecionada" = v_gabarito."idAlternativaCorreta" and v_pontos_acerto > 0 then
    perform honra_privado.registrar_movimentacao(v_pessoa, 'primeiro_acerto', 'questao', new."idQuestao"::text,
      v_pontos_acerto, 'Acerto na primeira resolução', 'acerto:' || v_pessoa || ':' || new."idQuestao");
  end if;

  perform honra_privado.registrar_dia_estudo(v_pessoa, new."idQuestao");
  return new;
end $$;

create trigger honra_apos_responder_questao after insert or update of "idAlternativaSelecionada"
on public.respostas_simulado for each row execute function honra_privado.pontuar_primeira_resposta();

create function honra_privado.pontuar_conclusao_tentativa() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_regra public.honra_regras; v_simulado public.simulados; v_total integer;
  v_respondidas integer; v_ineditas integer; v_hoje integer; v_origem text;
begin
  if new.status <> 'finalizada' or old.status = 'finalizada' then return new; end if;

  select * into v_simulado from public.simulados where "idSimulado" = new."idSimulado";
  select * into v_regra from public.honra_regras
  where codigo = case when v_simulado.tipo = 'prova' then 'prova_concluida' else 'simulado_concluido' end;
  if not found or not v_regra.ativo then return new; end if;

  insert into public.honra_progresso(id_pessoa) values (new."idPessoa") on conflict do nothing;
  perform 1 from public.honra_progresso where id_pessoa = new."idPessoa" for update;

  select count(*), count(r."idAlternativaSelecionada") into v_total, v_respondidas
  from public.simulado_questoes sq left join public.respostas_simulado r
    on r."idTentativa" = new."idTentativa" and r."idQuestao" = sq."idQuestao"
  where sq."idSimulado" = new."idSimulado";
  if v_total < v_regra.minimo_questoes or v_total = 0
    or v_respondidas * 100 < v_total * v_regra.percentual_minimo_respostas then return new; end if;

  select count(*) into v_ineditas from public.honra_questoes_pontuadas
  where id_pessoa = new."idPessoa" and id_tentativa_primeira = new."idTentativa";
  if v_ineditas < v_regra.minimo_questoes_ineditas then return new; end if;

  if v_regra.limite_diario > 0 then
    select count(*) into v_hoje from public.honra_movimentacoes
    where id_pessoa = new."idPessoa" and codigo_regra = v_regra.codigo
      and (criado_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date;
    if v_hoje >= v_regra.limite_diario then return new; end if;
  end if;

  v_origem := case when v_simulado.tipo = 'prova' then v_simulado."idConcurso"::text else v_simulado."idSimulado"::text end;
  perform honra_privado.registrar_movimentacao(new."idPessoa", v_regra.codigo, v_simulado.tipo,
    v_origem, v_regra.pontos, case when v_simulado.tipo = 'prova' then 'Prova concluída' else 'Simulado concluído' end,
    'conclusao:' || v_regra.codigo || ':' || new."idPessoa" || ':' || v_origem);
  return new;
end $$;

create trigger honra_apos_finalizar_tentativa after update of status on public.tentativas_simulado
for each row execute function honra_privado.pontuar_conclusao_tentativa();

create function honra_privado.ajustar_pontos_apos_retificacao_gabarito() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_resposta public.honra_questoes_pontuadas; v_pontos_devidos integer; v_diferenca integer;
begin
  if old.status = new.status and old."idAlternativaCorreta" is not distinct from new."idAlternativaCorreta" then return new; end if;

  for v_resposta in select * from public.honra_questoes_pontuadas
    where id_questao = new."idQuestao" order by id_pessoa for update loop
    v_pontos_devidos := case when new.status = 'definitivo' then
      v_resposta.pontos_resolucao_regra + case when v_resposta.id_alternativa_primeira = new."idAlternativaCorreta"
        then v_resposta.pontos_acerto_regra else 0 end else 0 end;
    v_diferenca := v_pontos_devidos - v_resposta.pontos_atribuidos;
    if v_diferenca <> 0 then
      update public.honra_questoes_pontuadas set pontos_atribuidos = v_pontos_devidos,
        versao_ajuste = versao_ajuste + 1
      where id_pessoa = v_resposta.id_pessoa and id_questao = v_resposta.id_questao;
      perform honra_privado.registrar_movimentacao(v_resposta.id_pessoa, null, 'retificacao_gabarito',
        new."idQuestao"::text, v_diferenca, 'Ajuste auditável após alteração do gabarito',
        'gabarito:' || v_resposta.id_pessoa || ':' || new."idQuestao" || ':' || (v_resposta.versao_ajuste + 1),
        'Status anterior: ' || old.status || '; status atual: ' || new.status,
        null, true);
    end if;
  end loop;
  return new;
end $$;

create trigger honra_apos_retificar_gabarito after update of status, "idAlternativaCorreta"
on public.gabaritos for each row execute function honra_privado.ajustar_pontos_apos_retificacao_gabarito();

create function honra_privado.salvar_titulo(p_dados jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_nivel integer; v_pontos integer; v_anterior jsonb; v_novo jsonb;
begin
  if not public.eh_administrador() then raise exception 'Acesso administrativo necessário' using errcode = '42501'; end if;
  v_id := nullif(p_dados->>'id', '')::uuid;
  v_nivel := (p_dados->>'nivel')::integer;
  v_pontos := (p_dados->>'pontuacaoMinima')::integer;
  if v_nivel is null or v_nivel < 1 or v_pontos is null or v_pontos < 0
    or (v_nivel = 1 and (v_pontos <> 0 or p_dados->>'ativo' = 'false')) then
    raise exception 'Nível ou pontuação mínima inválidos'; end if;
  if v_id is not null and exists(select 1 from public.honra_titulos
    where id = v_id and nivel = 1) and (v_nivel <> 1 or v_pontos <> 0
      or p_dados->>'ativo' = 'false') then
    raise exception 'O título inicial de nível um deve permanecer ativo com zero pontos'; end if;
  if exists(select 1 from public.honra_titulos where id <> coalesce(v_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and ((nivel < v_nivel and pontuacao_minima >= v_pontos) or (nivel > v_nivel and pontuacao_minima <= v_pontos))) then
    raise exception 'A pontuação mínima deve crescer com o nível'; end if;

  if v_id is null then
    insert into public.honra_titulos(nivel, nome, descricao, pontuacao_minima, icone, cor, ativo)
    values(v_nivel, btrim(p_dados->>'nome'), coalesce(p_dados->>'descricao', ''), v_pontos,
      coalesce(nullif(p_dados->>'icone', ''), 'estrela'), coalesce(p_dados->>'cor', '#59677b'),
      coalesce((p_dados->>'ativo')::boolean, true)) returning id into v_id;
  else
    select to_jsonb(t) into v_anterior from public.honra_titulos t where id = v_id for update;
    if not found then raise exception 'Título não encontrado'; end if;
    update public.honra_titulos set nivel = v_nivel, nome = btrim(p_dados->>'nome'),
      descricao = coalesce(p_dados->>'descricao', ''), pontuacao_minima = v_pontos,
      icone = coalesce(nullif(p_dados->>'icone', ''), 'estrela'), cor = coalesce(p_dados->>'cor', '#59677b'),
      ativo = coalesce((p_dados->>'ativo')::boolean, true), atualizado_em = now() where id = v_id;
  end if;
  select to_jsonb(t) into v_novo from public.honra_titulos t where id = v_id;
  insert into public.honra_alteracoes_configuracao(id_administrador, tipo, identificador, valor_anterior, valor_novo)
  values(auth.uid(), 'titulo', v_id::text, v_anterior, v_novo);
  return v_id;
end $$;

create function honra_privado.salvar_regra(p_codigo text, p_dados jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_anterior jsonb; v_novo jsonb;
begin
  if not public.eh_administrador() then raise exception 'Acesso administrativo necessário' using errcode = '42501'; end if;
  select to_jsonb(r) into v_anterior from public.honra_regras r where codigo = p_codigo for update;
  if not found then raise exception 'Regra não encontrada'; end if;
  if p_codigo = 'revisao' and (p_dados->>'pontos')::integer <> 0 then
    raise exception 'Revisões não podem conceder pontos de Honra'; end if;
  update public.honra_regras set pontos = (p_dados->>'pontos')::integer,
    minimo_questoes = coalesce((p_dados->>'minimoQuestoes')::integer, minimo_questoes),
    minimo_questoes_ineditas = coalesce((p_dados->>'minimoQuestoesIneditas')::integer, minimo_questoes_ineditas),
    percentual_minimo_respostas = coalesce((p_dados->>'percentualMinimoRespostas')::integer, percentual_minimo_respostas),
    limite_diario = coalesce((p_dados->>'limiteDiario')::integer, limite_diario),
    ativo = coalesce((p_dados->>'ativo')::boolean, ativo), atualizado_em = now()
  where codigo = p_codigo;
  select to_jsonb(r) into v_novo from public.honra_regras r where codigo = p_codigo;
  insert into public.honra_alteracoes_configuracao(id_administrador, tipo, identificador, valor_anterior, valor_novo)
  values(auth.uid(), 'regra', p_codigo, v_anterior, v_novo);
end $$;

create function honra_privado.ajustar_saldo(p_id_pessoa uuid, p_pontos integer, p_justificativa text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.eh_administrador() then raise exception 'Acesso administrativo necessário' using errcode = '42501'; end if;
  if p_pontos = 0 or abs(p_pontos) > 10000 or length(btrim(coalesce(p_justificativa, ''))) < 10 then
    raise exception 'Informe pontos válidos e justificativa com ao menos dez caracteres'; end if;
  if not exists(select 1 from public.estudantes where "idEstudante" = p_id_pessoa) then
    raise exception 'Estudante não encontrado'; end if;
  perform honra_privado.registrar_movimentacao(p_id_pessoa, null, 'ajuste_administrativo', p_id_pessoa::text,
    p_pontos, 'Ajuste administrativo de Pontos de Honra', gen_random_uuid()::text,
    p_justificativa, auth.uid());
end $$;

create function honra_privado.salvar_anotacao(p_id_questao uuid, p_conteudo text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pessoa uuid;
begin
  select "idPessoa" into v_pessoa from public.usuarios where "idUsuario" = auth.uid()
    and tipo = 'estudante' and estado_cadastro = 'ativo' and cadastro_completo;
  if v_pessoa is null then raise exception 'Cadastro de estudante necessário' using errcode = '42501'; end if;
  if p_conteudo is null or length(btrim(p_conteudo)) > 10000 then raise exception 'Anotação inválida'; end if;
  if length(btrim(p_conteudo)) = 0 then
    delete from public.anotacoes_pessoais_questoes where id_pessoa = v_pessoa and id_questao = p_id_questao;
  else
    insert into public.anotacoes_pessoais_questoes(id_pessoa, id_questao, conteudo)
    values(v_pessoa, p_id_questao, btrim(p_conteudo))
    on conflict(id_pessoa, id_questao) do update set conteudo = excluded.conteudo, atualizada_em = now();
  end if;
end $$;

revoke all on all functions in schema honra_privado from public, anon, authenticated, concursa_dados;
grant usage on schema honra_privado to concursa_dados;
grant execute on function honra_privado.salvar_titulo(jsonb),
  honra_privado.salvar_regra(text,jsonb), honra_privado.ajustar_saldo(uuid,integer,text),
  honra_privado.salvar_anotacao(uuid,text) to concursa_dados;

notify pgrst, 'reload schema';
commit;
