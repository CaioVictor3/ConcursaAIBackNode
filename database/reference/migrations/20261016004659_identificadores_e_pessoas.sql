-- Evolucao sem recriacao de dados: chaves explicitas no formato idEntidade.
drop function public.salvar_questao(jsonb,jsonb,jsonb,uuid);
drop function public.salvar_simulado(jsonb,uuid[],uuid);
drop function public.iniciar_tentativa(uuid);
drop function public.responder_questao(uuid,uuid,uuid);
drop function public.finalizar_tentativa(uuid);
drop function public.obter_resultado_tentativa(uuid);

alter table public.perfis rename column id to "idPessoa";
alter table public.concursos rename column id to "idConcurso";
alter table public.bancas rename column id to "idBanca";
alter table public.disciplinas rename column id to "idDisciplina";
alter table public.assuntos rename column id to "idAssunto";
alter table public.assuntos rename column disciplina_id to "idDisciplina";
alter table public.assuntos rename column assunto_pai_id to "idAssuntoPai";
alter table public.questoes rename column id to "idQuestao";
alter table public.questoes rename column concurso_id to "idConcurso";
alter table public.questoes rename column banca_id to "idBanca";
alter table public.questoes rename column disciplina_id to "idDisciplina";
alter table public.questoes rename column assunto_id to "idAssunto";
alter table public.questoes rename column criada_por to "idPessoaCriadora";
alter table public.alternativas rename column id to "idAlternativa";
alter table public.alternativas rename column questao_id to "idQuestao";
alter table public.gabaritos rename column questao_id to "idQuestao";
alter table public.gabaritos rename column alternativa_correta_id to "idAlternativaCorreta";
alter table public.simulados rename column id to "idSimulado";
alter table public.simulados rename column concurso_id to "idConcurso";
alter table public.simulados rename column criado_por to "idPessoaCriadora";
alter table public.simulado_questoes rename column id to "idSimuladoQuestao";
alter table public.simulado_questoes rename column simulado_id to "idSimulado";
alter table public.simulado_questoes rename column questao_id to "idQuestao";
alter table public.tentativas_simulado rename column id to "idTentativa";
alter table public.tentativas_simulado rename column simulado_id to "idSimulado";
alter table public.tentativas_simulado rename column usuario_id to "idPessoa";
alter table public.respostas_simulado rename column id to "idResposta";
alter table public.respostas_simulado rename column tentativa_id to "idTentativa";
alter table public.respostas_simulado rename column questao_id to "idQuestao";
alter table public.respostas_simulado rename column alternativa_selecionada_id to "idAlternativaSelecionada";

-- Resultados antigos mantem a mesma informacao com as novas chaves JSON.
update public.tentativas_simulado t set correcao_json = (
  select coalesce(jsonb_agg((item - 'questao_id' - 'alternativa_selecionada_id' - 'alternativa_correta_id') ||
    jsonb_build_object('idQuestao', item->'questao_id',
      'idAlternativaSelecionada', item->'alternativa_selecionada_id',
      'idAlternativaCorreta', item->'alternativa_correta_id')), '[]'::jsonb)
  from jsonb_array_elements(t.correcao_json) as lista(item)
) where t.correcao_json is not null;

create function public.cpf_valido(p_cpf text) returns boolean
language plpgsql immutable strict set search_path = '' as $$
declare v_posicao integer; v_indice integer; v_soma integer; v_digito integer;
begin
  if p_cpf !~ '^[0-9]{11}$' or p_cpf = repeat(left(p_cpf, 1), 11) then
    return false;
  end if;
  for v_posicao in 1..2 loop
    v_soma := 0;
    for v_indice in 1..(8 + v_posicao) loop
      v_soma := v_soma + substr(p_cpf, v_indice, 1)::integer * (10 + v_posicao - v_indice);
    end loop;
    v_digito := 11 - (v_soma % 11);
    if v_digito >= 10 then v_digito := 0; end if;
    if v_digito <> substr(p_cpf, 9 + v_posicao, 1)::integer then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function public.cpf_valido(text) from public, anon, authenticated;

create table public.pessoas (
  "idPessoa" uuid primary key references auth.users(id) on delete cascade,
  nome_completo text not null check (length(btrim(nome_completo)) >= 3),
  data_nascimento date check (data_nascimento >= date '1900-01-01'),
  cpf text unique check (cpf is null or public.cpf_valido(cpf)),
  cep text check (cep is null or cep ~ '^[0-9]{8}$'),
  logradouro text, numero text, complemento text, bairro text, cidade text,
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
create table public.estudantes (
  "idEstudante" uuid primary key references public.pessoas("idPessoa") on delete cascade,
  criado_em timestamptz not null default now()
);
alter table public.perfis add column cadastro_completo boolean not null default false;
insert into public.pessoas("idPessoa", nome_completo)
select "idPessoa", case when length(btrim(nome_completo)) >= 3 then nome_completo else 'Pessoa sem cadastro completo' end
from public.perfis;
alter table public.perfis add constraint perfis_pessoa_fk
  foreign key ("idPessoa") references public.pessoas("idPessoa") on delete cascade;
insert into public.estudantes("idEstudante")
select "idPessoa" from public.perfis where papel = 'estudante';

alter table public.pessoas enable row level security;
alter table public.estudantes enable row level security;
revoke all on public.pessoas, public.estudantes from public, anon, authenticated;

create or replace function public.eh_administrador() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.perfis where "idPessoa" = (select auth.uid())
    and papel = 'administrador' and estado_cadastro = 'ativo' and cadastro_completo)
$$;

create function public.sincronizar_papel_estudante() returns trigger
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
create trigger ao_alterar_papel_estudante after insert or update of papel on public.perfis
  for each row execute function public.sincronizar_papel_estudante();

create or replace function public.sincronizar_perfil_autenticacao() returns trigger
language plpgsql security definer set search_path = '' as $$
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
    insert into public.perfis("idPessoa", nome_completo, email, avatar_url,
      estado_cadastro, ultimo_acesso_em, cadastro_completo)
    values (new.id, v_nome, coalesce(new.email, ''), v_dados->>'avatar_url',
      case when new.email_confirmed_at is not null then 'ativo'
           when new.invited_at is not null then 'convite_pendente'
           else 'verificacao_pendente' end, new.last_sign_in_at, true);
  else
    update public.perfis set email = coalesce(new.email, ''),
      estado_cadastro = case when new.email_confirmed_at is not null then 'ativo'
        when new.invited_at is not null then 'convite_pendente'
        else 'verificacao_pendente' end,
      ultimo_acesso_em = new.last_sign_in_at, atualizado_em = now()
    where "idPessoa" = new.id;
  end if;
  return new;
end $$;

-- Dados pessoais: acesso apenas por funcoes que conferem a pessoa da sessao.
create function public.obter_minha_pessoa() returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(p) from public.pessoas p where p."idPessoa" = (select auth.uid())
$$;
create function public.salvar_minha_pessoa(p_pessoa jsonb) returns void
language plpgsql security definer set search_path = '' as $$
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
  update public.perfis set nome_completo = v_nome, cadastro_completo = true,
    atualizado_em = now() where "idPessoa" = v_idPessoa;
end $$;

create function public.salvar_questao(p_questao jsonb, p_alternativas jsonb,
  p_gabarito jsonb, p_idQuestao uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_idQuestao uuid := coalesce(p_idQuestao, gen_random_uuid()); v_alternativa jsonb; v_idsAlternativas uuid[] := '{}';
begin
  if not public.eh_administrador() then raise exception 'Acesso negado'; end if;
  if jsonb_typeof(p_alternativas) <> 'array' or jsonb_array_length(p_alternativas) < 2 then
    raise exception 'Informe pelo menos duas alternativas'; end if;
  if p_idQuestao is not null and not exists(select 1 from public.questoes where "idQuestao" = p_idQuestao) then
    raise exception 'Questao nao encontrada'; end if;
  if p_idQuestao is not null and exists(select 1 from public.simulado_questoes sq
    join public.tentativas_simulado t on t."idSimulado" = sq."idSimulado"
    where sq."idQuestao" = p_idQuestao) then
    raise exception 'Questao com tentativas registradas nao pode ser editada'; end if;
  if p_idQuestao is not null and exists(select 1 from public.simulado_questoes sq
    join public.simulados s on s."idSimulado" = sq."idSimulado"
    where sq."idQuestao" = p_idQuestao and s.status = 'publicado') then
    raise exception 'Retire a questao dos simulados publicados antes de editar'; end if;
  insert into public.questoes("idQuestao", "idConcurso", "idBanca", "idDisciplina", "idAssunto",
    enunciado, tipo, dificuldade, ano, fonte, imagem_url, explicacao, status, "idPessoaCriadora")
  values(v_idQuestao, (p_questao->>'idConcurso')::uuid, (p_questao->>'idBanca')::uuid,
    (p_questao->>'idDisciplina')::uuid, (p_questao->>'idAssunto')::uuid,
    p_questao->>'enunciado', coalesce(p_questao->>'tipo','multipla_escolha'),
    p_questao->>'dificuldade', (p_questao->>'ano')::integer,
    coalesce(p_questao->>'fonte',''), p_questao->>'imagem_url',
    coalesce(p_questao->>'explicacao',''), p_questao->>'status', auth.uid())
  on conflict ("idQuestao") do update set "idConcurso" = excluded."idConcurso",
    "idBanca" = excluded."idBanca", "idDisciplina" = excluded."idDisciplina",
    "idAssunto" = excluded."idAssunto", enunciado = excluded.enunciado,
    dificuldade = excluded.dificuldade, ano = excluded.ano, fonte = excluded.fonte,
    imagem_url = excluded.imagem_url, explicacao = excluded.explicacao,
    status = excluded.status, atualizada_em = now();
  delete from public.gabaritos where "idQuestao" = v_idQuestao;
  delete from public.alternativas where "idQuestao" = v_idQuestao;
  for v_alternativa in select item from jsonb_array_elements(p_alternativas) as lista(item) loop
    insert into public.alternativas("idAlternativa", "idQuestao", letra, texto, ordem)
    values ((v_alternativa->>'idAlternativa')::uuid, v_idQuestao,
      upper(btrim(v_alternativa->>'letra')), v_alternativa->>'texto', (v_alternativa->>'ordem')::integer);
    v_idsAlternativas := array_append(v_idsAlternativas, (v_alternativa->>'idAlternativa')::uuid);
  end loop;
  if p_gabarito->>'status' <> 'anulada' and
     not ((p_gabarito->>'idAlternativaCorreta')::uuid = any(v_idsAlternativas)) then
    raise exception 'Gabarito invalido'; end if;
  insert into public.gabaritos("idQuestao", "idAlternativaCorreta", status, explicacao)
  values (v_idQuestao, (p_gabarito->>'idAlternativaCorreta')::uuid,
    p_gabarito->>'status', coalesce(p_gabarito->>'explicacao', ''));
  return v_idQuestao;
end $$;

create function public.salvar_simulado(p_simulado jsonb, p_idsQuestoes uuid[],
  p_idSimulado uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_idSimulado uuid := coalesce(p_idSimulado, gen_random_uuid()); v_idQuestao uuid; v_ordem integer := 0;
begin
  if not public.eh_administrador() then raise exception 'Acesso negado'; end if;
  if coalesce(array_length(p_idsQuestoes, 1), 0) = 0 or
     (select count(distinct item) from unnest(p_idsQuestoes) as lista(item)) <> array_length(p_idsQuestoes, 1) then
    raise exception 'Selecione questoes sem repeticao'; end if;
  if exists(select 1 from unnest(p_idsQuestoes) as lista(item) left join public.questoes q
    on q."idQuestao" = lista.item where q.status is distinct from 'publicada') then
    raise exception 'Todas as questoes devem estar publicadas'; end if;
  if p_idSimulado is not null and exists(select 1 from public.tentativas_simulado where "idSimulado" = p_idSimulado) then
    raise exception 'Simulado com tentativas nao pode ser editado'; end if;
  if p_idSimulado is not null and not exists(select 1 from public.simulados where "idSimulado" = p_idSimulado) then
    raise exception 'Simulado nao encontrado'; end if;
  insert into public.simulados("idSimulado", nome, descricao, "idConcurso", duracao_minutos,
    tipo, publico, status, "idPessoaCriadora")
  values(v_idSimulado, p_simulado->>'nome', coalesce(p_simulado->>'descricao',''),
    (p_simulado->>'idConcurso')::uuid, (p_simulado->>'duracao_minutos')::integer,
    p_simulado->>'tipo', (p_simulado->>'publico')::boolean,
    p_simulado->>'status', auth.uid())
  on conflict ("idSimulado") do update set nome = excluded.nome, descricao = excluded.descricao,
    "idConcurso" = excluded."idConcurso", duracao_minutos = excluded.duracao_minutos,
    tipo = excluded.tipo, publico = excluded.publico, status = excluded.status;
  delete from public.simulado_questoes where "idSimulado" = v_idSimulado;
  foreach v_idQuestao in array p_idsQuestoes loop
    v_ordem := v_ordem + 1;
    insert into public.simulado_questoes("idSimulado", "idQuestao", ordem)
    values(v_idSimulado, v_idQuestao, v_ordem);
  end loop;
  return v_idSimulado;
end $$;

create function public.iniciar_tentativa(p_idSimulado uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_idTentativa uuid;
begin
  if not exists(select 1 from public.perfis p join public.estudantes e on e."idEstudante" = p."idPessoa"
    where p."idPessoa" = auth.uid() and p.estado_cadastro = 'ativo' and p.cadastro_completo) then
    raise exception 'Cadastro de estudante ativo e completo necessario'; end if;
  if not exists(select 1 from public.simulados where "idSimulado" = p_idSimulado
    and status = 'publicado' and publico = true) then raise exception 'Simulado indisponivel'; end if;
  insert into public.tentativas_simulado("idSimulado", "idPessoa")
    values(p_idSimulado, auth.uid()) returning "idTentativa" into v_idTentativa;
  return v_idTentativa;
end $$;

create function public.responder_questao(p_idTentativa uuid, p_idQuestao uuid,
  p_idAlternativa uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_idSimulado uuid;
begin
  select "idSimulado" into v_idSimulado from public.tentativas_simulado
  where "idTentativa" = p_idTentativa and "idPessoa" = auth.uid() and status = 'em_andamento'
  for update;
  if v_idSimulado is null then raise exception 'Tentativa indisponivel'; end if;
  if not exists(select 1 from public.simulado_questoes
    where "idSimulado" = v_idSimulado and "idQuestao" = p_idQuestao) then
    raise exception 'Questao fora do simulado'; end if;
  if p_idAlternativa is not null and not exists(select 1 from public.alternativas
    where "idAlternativa" = p_idAlternativa and "idQuestao" = p_idQuestao) then
    raise exception 'Alternativa invalida'; end if;
  insert into public.respostas_simulado("idTentativa", "idQuestao",
    "idAlternativaSelecionada", respondida_em)
  values(p_idTentativa, p_idQuestao, p_idAlternativa,
    case when p_idAlternativa is null then null else now() end)
  on conflict ("idTentativa", "idQuestao") do update set
    "idAlternativaSelecionada" = excluded."idAlternativaSelecionada",
    respondida_em = excluded.respondida_em;
end $$;

create function public.finalizar_tentativa(p_idTentativa uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_tentativa public.tentativas_simulado%rowtype; v_itens jsonb; v_acertos integer;
  v_erros integer; v_vazias integer; v_total integer; v_pontuacao numeric(5,1);
begin
  select * into v_tentativa from public.tentativas_simulado
    where "idTentativa" = p_idTentativa and "idPessoa" = auth.uid() for update;
  if not found then raise exception 'Tentativa nao encontrada'; end if;
  if v_tentativa.status <> 'em_andamento' then raise exception 'Tentativa ja encerrada'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'idQuestao', sq."idQuestao",
      'idAlternativaSelecionada', r."idAlternativaSelecionada",
      'idAlternativaCorreta', case when g.status = 'anulada' then null else g."idAlternativaCorreta" end,
      'anulada', g.status = 'anulada',
      'acertou', coalesce(g.status = 'anulada' or r."idAlternativaSelecionada" = g."idAlternativaCorreta", false),
      'explicacao', coalesce(nullif(g.explicacao,''), q.explicacao)) order by sq.ordem), '[]'::jsonb),
    count(*)::integer,
    count(*) filter (where g.status = 'anulada' or r."idAlternativaSelecionada" = g."idAlternativaCorreta")::integer,
    count(*) filter (where g.status <> 'anulada' and r."idAlternativaSelecionada" is null)::integer
  into v_itens, v_total, v_acertos, v_vazias
  from public.simulado_questoes sq
  join public.questoes q on q."idQuestao" = sq."idQuestao"
  join public.gabaritos g on g."idQuestao" = q."idQuestao"
  left join public.respostas_simulado r on r."idTentativa" = v_tentativa."idTentativa" and r."idQuestao" = q."idQuestao"
  where sq."idSimulado" = v_tentativa."idSimulado";
  if v_total <> (select count(*) from public.simulado_questoes
      where "idSimulado" = v_tentativa."idSimulado") then
    raise exception 'Simulado possui questao sem gabarito'; end if;
  v_erros := v_total - v_acertos - v_vazias;
  v_pontuacao := case when v_total = 0 then 0
    else round(v_acertos::numeric * 100 / v_total, 1) end;
  update public.tentativas_simulado set status = 'finalizada', finalizada_em = now(),
    pontuacao = v_pontuacao, total_acertos = v_acertos, total_erros = v_erros,
    total_nao_respondidas = v_vazias,
    tempo_gasto_segundos = greatest(0, extract(epoch from now() - iniciada_em)::integer),
    correcao_json = v_itens where "idTentativa" = p_idTentativa returning * into v_tentativa;
  return jsonb_build_object('idTentativa', v_tentativa."idTentativa", 'itens', v_itens);
end $$;

create function public.obter_resultado_tentativa(p_idTentativa uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('idTentativa', "idTentativa", 'itens', correcao_json)
  from public.tentativas_simulado where "idTentativa" = p_idTentativa
    and "idPessoa" = (select auth.uid()) and status = 'finalizada'
$$;

revoke all on function public.obter_minha_pessoa(), public.salvar_minha_pessoa(jsonb),
  public.salvar_questao(jsonb,jsonb,jsonb,uuid), public.salvar_simulado(jsonb,uuid[],uuid),
  public.iniciar_tentativa(uuid), public.responder_questao(uuid,uuid,uuid),
  public.finalizar_tentativa(uuid), public.obter_resultado_tentativa(uuid) from public, anon;
grant execute on function public.obter_minha_pessoa(), public.salvar_minha_pessoa(jsonb),
  public.salvar_questao(jsonb,jsonb,jsonb,uuid), public.salvar_simulado(jsonb,uuid[],uuid),
  public.iniciar_tentativa(uuid), public.responder_questao(uuid,uuid,uuid),
  public.finalizar_tentativa(uuid), public.obter_resultado_tentativa(uuid) to authenticated;
