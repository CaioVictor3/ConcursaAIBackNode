-- Evolução aditiva: concursos continua sendo o cadastro físico de provas.
-- Não inventa organizadora, numeração original ou classificação de questões legadas.
begin;
set local lock_timeout = '10s';
create schema if not exists provas_privado;
revoke all on schema provas_privado from public, anon, authenticated;

alter table public.concursos add column "idOrganizadora" uuid references public.bancas("idBanca") on delete restrict;
alter table public.concursos add column composicao_confirmada boolean not null default false;
alter table public.concursos drop constraint concursos_ano_check;
alter table public.concursos add constraint concursos_ano_check check (ano between 1000 and 9999);
alter table public.concursos add constraint provas_textos_check check (
  length(btrim(orgao)) between 1 and 200 and length(btrim(cargo)) <= 200) not valid;
create index provas_filtros_idx on public.concursos(ano, "idOrganizadora");
-- Uma organizadora é verificável apenas quando todas as referências da prova concordam.
update public.concursos p set "idOrganizadora" = x.id
from (select "idConcurso", (array_agg(distinct "idBanca"))[1] id
  from public.questoes group by "idConcurso"
  having count(distinct "idBanca") = 1 and count(*) = count("idBanca")) x
where p."idConcurso" = x."idConcurso" and p."idOrganizadora" is null;

create table public.temas (
  "idTema" uuid primary key default gen_random_uuid(),
  nome text not null check (nome = btrim(nome) and length(nome) between 1 and 200)
);
create unique index temas_nome_normalizado_idx on public.temas(lower(btrim(nome)));
alter table public.temas enable row level security;
revoke all on public.temas from public, anon, authenticated;
grant select on public.temas to authenticated;
create policy temas_leitura on public.temas for select to authenticated using (true);

-- Seed repetível; reaproveita IDs de assuntos equivalentes sem tocar em seus vínculos.
create function provas_privado.cadastrar_temas() returns void
language plpgsql security invoker set search_path = '' as $seed$
declare v_nome text; v_id uuid;
begin
  for v_nome in select nome from (values
  ('Anatomia e Fisiologia Bucal'),
  ('Biossegurança e Controle de Infecção'),
  ('Materiais Odontológicos'),
  ('Instrumentais e Equipamentos Odontológicos'),
  ('Odontologia Preventiva e Cariologia'),
  ('Saúde Pública e Saúde Coletiva'),
  ('Dentística Restauradora'),
  ('Endodontia'),
  ('Periodontia'),
  ('Cirurgia Oral e Bucomaxilofacial'),
  ('Radiologia Odontológica'),
  ('Odontopediatria'),
  ('Prótese Dentária'),
  ('Ortodontia e Ortopedia Facial'),
  ('Patologia Bucal e Estomatologia'),
  ('Farmacologia e Anestesiologia'),
  ('Diagnóstico e Semiologia'),
  ('Ética e Legislação Odontológica'),
  ('Gestão e Rotinas do Consultório Odontológico'),
  ('Urgências e Emergências Odontológicas'),
  ('Implantodontia'),
  ('Odontologia Legal'),
  ('Odontologia para Pacientes com Necessidades Especiais'),
  ('Odontogeriatria'),
  ('Ciências Básicas da Saúde')
  ) catalogo(nome) loop
    if exists(select 1 from public.temas where lower(btrim(nome)) = lower(v_nome)) then
      update public.temas set nome = v_nome where lower(btrim(nome)) = lower(v_nome);
      continue;
    end if;
    select a."idAssunto" into v_id from public.assuntos a
      where lower(btrim(a.nome)) = lower(v_nome) and not exists(select 1 from public.temas t where t."idTema" = a."idAssunto")
      order by a.criado_em, a."idAssunto" limit 1;
    insert into public.temas("idTema", nome) values(coalesce(v_id, gen_random_uuid()), v_nome);
  end loop;
end $seed$;
select provas_privado.cadastrar_temas();

alter table public.questoes add column "idTema" uuid references public.temas("idTema") on delete restrict;
alter table public.questoes add column numero integer check (numero > 0);
-- Campos legados ficam disponíveis para auditoria/histórico; novos cadastros não exigem hierarquia.
alter table public.questoes alter column "idDisciplina" drop not null;
alter table public.questoes alter column "idAssunto" drop not null;
create unique index questoes_prova_numero_idx on public.questoes("idConcurso", numero);
create index questoes_tema_status_idx on public.questoes("idTema", status);
-- Somente equivalências textuais inequívocas; não usa "Conteúdo geral" como tema.
update public.questoes q set "idTema" = t."idTema"
from public.assuntos a, public.temas t
where q."idAssunto" = a."idAssunto" and lower(btrim(a.nome)) = lower(btrim(t.nome));
update public.questoes q set "idTema" = t."idTema"
from public.disciplinas d, public.temas t
where q."idTema" is null and q."idDisciplina" = d."idDisciplina"
  and lower(btrim(d.nome)) = lower(btrim(t.nome));

-- A view é o contrato canônico; não duplica órgão/ano/cargo nem o nome da banca.
create view public.provas with (security_invoker = true) as
select p."idConcurso" as "idProva", p.ano, p.orgao, p."idOrganizadora",
  b.nome as organizadora, nullif(btrim(p.cargo),'') as cargo,
  p.composicao_confirmada,
  (p."idOrganizadora" is null or length(btrim(p.orgao)) not between 1 and 200
    or exists(select 1 from public.questoes q where q."idConcurso" = p."idConcurso"
      and (q."idTema" is null or q.numero is null))) as revisao_pendente
from public.concursos p left join public.bancas b on b."idBanca" = p."idOrganizadora";
revoke all on public.provas from public, anon, authenticated;
grant select on public.provas to authenticated;
grant select ("idTema", numero) on public.questoes to authenticated;

create view public.pendencias_provas_questoes with (security_invoker = true) as
select 'prova'::text entidade, p."idProva" id, concat_ws('; ',
  case when p."idOrganizadora" is null then 'Organizadora não informada' end,
  case when not p.composicao_confirmada then 'Composição e ordem original não confirmadas' end,
  case when length(btrim(p.orgao)) not between 1 and 200 then 'Órgão inválido' end) motivo
from public.provas p where p.revisao_pendente or not p.composicao_confirmada
union all
select 'questao', q."idQuestao", concat_ws('; ',
  case when q."idConcurso" is null then 'Prova não identificada' end,
  case when q."idTema" is null then 'Tema requer revisão' end,
  case when q.numero is null then 'Número original não confirmado (número da apostila não é o da prova)' end)
from public.questoes q where q."idConcurso" is null or q."idTema" is null or q.numero is null;
revoke all on public.pendencias_provas_questoes from public, anon, authenticated;
-- O relatório é administrativo; acesso por RPC com verificação de papel.
create function provas_privado.listar_pendencias(p_pagina integer, p_quantidade integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_itens jsonb; v_total integer;
begin
  if not public.eh_administrador() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_pagina < 1 or p_quantidade not between 1 and 100 then raise exception 'Paginação inválida'; end if;
  select count(*) into v_total from public.pendencias_provas_questoes;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_itens from (
    select * from public.pendencias_provas_questoes order by entidade,id offset (p_pagina-1)*p_quantidade limit p_quantidade) x;
  return jsonb_build_object('itens',v_itens,'total',v_total,'pagina',p_pagina,'quantidadePorPagina',p_quantidade);
end $$;
create function public.listar_pendencias_provas(p_pagina integer, p_quantidade integer) returns jsonb
language sql security invoker set search_path = '' as $$select provas_privado.listar_pendencias(p_pagina,p_quantidade)$$;

create function provas_privado.salvar_prova(p_idprova uuid, p_ano integer, p_orgao text,
  p_idorganizadora uuid, p_cargo text, p_composicao_confirmada boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_idprova,gen_random_uuid());
begin
  if not public.eh_administrador() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if p_ano is null or p_ano not between 1000 and 9999 or p_orgao is null or length(btrim(p_orgao)) not between 1 and 200
    or length(btrim(coalesce(p_cargo,''))) > 200 or p_idorganizadora is null
    or not exists(select 1 from public.bancas where "idBanca"=p_idorganizadora and length(btrim(nome)) between 1 and 200)
    or p_composicao_confirmada is null then raise exception 'Informe ano, órgão e organizadora válidos'; end if;
  if p_idprova is not null then
    perform 1 from public.concursos where "idConcurso"=p_idprova for update;
    if not found then raise exception 'Prova não encontrada'; end if;
  end if;
  if p_composicao_confirmada and (not exists(select 1 from public.questoes where "idConcurso"=v_id)
    or exists(select 1 from public.questoes where "idConcurso"=v_id and (numero is null or "idTema" is null))) then
    raise exception 'Revise o tema e a numeração original de todas as questões antes de confirmar a composição'; end if;
  insert into public.concursos("idConcurso",nome,ano,orgao,"idOrganizadora",cargo,composicao_confirmada)
    values(v_id,concat(btrim(p_orgao),' · ',p_ano),p_ano,btrim(p_orgao),p_idorganizadora,btrim(coalesce(p_cargo,'')),p_composicao_confirmada)
  on conflict("idConcurso") do update set ano=excluded.ano,orgao=excluded.orgao,"idOrganizadora"=excluded."idOrganizadora",
    cargo=excluded.cargo,composicao_confirmada=excluded.composicao_confirmada;
  return v_id;
end $$;
create function public.salvar_prova(p_idprova uuid,p_ano integer,p_orgao text,p_idorganizadora uuid,p_cargo text,p_composicao_confirmada boolean) returns uuid
language sql security invoker set search_path = '' as $$select provas_privado.salvar_prova(p_idprova,p_ano,p_orgao,p_idorganizadora,p_cargo,p_composicao_confirmada)$$;

-- Finalização controlada: só aplicar obrigatoriedade após o relatório ficar vazio.
create function provas_privado.concluir_migracao() returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if exists(select 1 from public.pendencias_provas_questoes) then raise exception 'Resolva as pendências antes de aplicar as restrições finais'; end if;
  alter table public.questoes alter column "idConcurso" set not null;
  alter table public.questoes alter column "idTema" set not null;
  alter table public.questoes alter column numero set not null;
  alter table public.concursos alter column "idOrganizadora" set not null;
  alter table public.concursos validate constraint provas_textos_check;
end $$;

-- Validação transacional da questão; alternativas são atualizadas preservando os IDs existentes.
create or replace function public.salvar_questao(p_questao jsonb,p_alternativas jsonb,p_gabarito jsonb,p_idquestao uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_idquestao,gen_random_uuid()); v_alt jsonb; v_ids uuid[] := '{}'; v_prova uuid := (p_questao->>'idProva')::uuid; v_tema uuid := (p_questao->>'idTema')::uuid;
begin
  if not public.eh_administrador() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if v_prova is null or v_tema is null or coalesce((p_questao->>'numero')::integer,0)<1
    or not exists(select 1 from public.provas where "idProva"=v_prova and "idOrganizadora" is not null)
    or not exists(select 1 from public.temas where "idTema"=v_tema) then raise exception 'Informe prova, tema do catálogo e número original válidos'; end if;
  -- O mesmo bloqueio é usado ao iniciar uma prova, impedindo alterações concorrentes da composição.
  perform 1 from public.concursos where "idConcurso"=v_prova for update;
  if p_idquestao is not null then
    perform 1 from public.questoes where "idQuestao"=p_idquestao for update;
    if not found then raise exception 'Questão não encontrada'; end if;
    if exists(select 1 from public.simulado_questoes sq join public.simulados s using("idSimulado")
      where sq."idQuestao"=p_idquestao and (s.status='publicado' or exists(select 1 from public.tentativas_simulado t where t."idSimulado"=s."idSimulado"))) then
      raise exception 'Questão com simulado publicado ou tentativa não pode ser editada'; end if;
  end if;
  if p_questao->>'enunciado' is null or length(btrim(p_questao->>'enunciado')) not between 1 and 24000
    or jsonb_typeof(p_alternativas) is distinct from 'array' or jsonb_array_length(p_alternativas) not between 2 and 10 then raise exception 'Questão ou alternativas inválidas'; end if;
  insert into public.questoes("idQuestao","idConcurso","idTema",numero,enunciado,tipo,dificuldade,fonte,imagem_url,explicacao,status,"idPessoaCriadora")
    values(v_id,v_prova,v_tema,(p_questao->>'numero')::integer,btrim(p_questao->>'enunciado'),'multipla_escolha',coalesce(p_questao->>'dificuldade','nao_informada'),
      coalesce(p_questao->>'fonte',''),p_questao->>'imagem_url',coalesce(p_questao->>'explicacao',''),p_questao->>'status',auth.uid())
  on conflict("idQuestao") do update set "idConcurso"=excluded."idConcurso","idTema"=excluded."idTema",numero=excluded.numero,
    enunciado=excluded.enunciado,dificuldade=excluded.dificuldade,fonte=excluded.fonte,imagem_url=excluded.imagem_url,
    explicacao=excluded.explicacao,status=excluded.status,atualizada_em=now();
  for v_alt in select value from jsonb_array_elements(p_alternativas) loop
    if (v_alt->>'idAlternativa') is null or length(btrim(v_alt->>'letra'))<>1 or length(btrim(v_alt->>'texto')) not between 1 and 8000 then raise exception 'Alternativa inválida'; end if;
    if (v_alt->>'idAlternativa')::uuid=any(v_ids) then raise exception 'Alternativa repetida'; end if;
    v_ids:=array_append(v_ids,(v_alt->>'idAlternativa')::uuid);
  end loop;
  -- Restrições de ordem/letra são deferidas pela atualização em duas fases.
  delete from public.gabaritos where "idQuestao"=v_id;
  delete from public.alternativas where "idQuestao"=v_id and not("idAlternativa"=any(v_ids));
  update public.alternativas set letra='tmp-'||"idAlternativa"::text, ordem=ordem+10000 where "idQuestao"=v_id;
  for v_alt in select value from jsonb_array_elements(p_alternativas) loop
    insert into public.alternativas("idAlternativa","idQuestao",letra,texto,ordem)
      values((v_alt->>'idAlternativa')::uuid,v_id,upper(btrim(v_alt->>'letra')),btrim(v_alt->>'texto'),(v_alt->>'ordem')::integer)
    on conflict("idAlternativa") do update set letra=excluded.letra,texto=excluded.texto,ordem=excluded.ordem
      where alternativas."idQuestao"=v_id;
    if not found then raise exception 'Identificador de alternativa pertence a outra questão'; end if;
  end loop;
  if p_gabarito is not null and jsonb_typeof(p_gabarito)='object' and p_gabarito->>'status'<>'pendente' then
    if p_gabarito->>'status' <> 'anulada' and not coalesce((p_gabarito->>'idAlternativaCorreta')::uuid=any(v_ids),false) then raise exception 'Gabarito inválido'; end if;
    insert into public.gabaritos("idQuestao","idAlternativaCorreta",status,explicacao)
      values(v_id,case when p_gabarito->>'status'='anulada' then null else (p_gabarito->>'idAlternativaCorreta')::uuid end,p_gabarito->>'status',coalesce(p_gabarito->>'explicacao',''));
  end if;
  return v_id;
end $$;
-- Mantém a função privilegiada fora do schema exposto.
alter function public.salvar_questao(jsonb,jsonb,jsonb,uuid) set schema provas_privado;
create function public.salvar_questao(p_questao jsonb,p_alternativas jsonb,p_gabarito jsonb,p_idquestao uuid default null) returns uuid
language sql security invoker set search_path = '' as $$select provas_privado.salvar_questao(p_questao,p_alternativas,p_gabarito,p_idquestao)$$;

alter table public.simulados drop constraint simulados_tipo_check;
alter table public.simulados add constraint simulados_tipo_check check (tipo in ('padrao','personalizado','prova'));
-- O vínculo existente idConcurso identifica a prova original; tipo diferencia o fluxo.
create unique index simulado_prova_pessoa_idx on public.simulados("idConcurso","idPessoaCriadora") where tipo='prova';
alter table public.tentativas_simulado add column total_anuladas integer not null default 0;
alter table public.tentativas_simulado add column total_sem_gabarito integer not null default 0;
revoke select on public.tentativas_simulado from authenticated;
grant select("idTentativa","idSimulado","idPessoa",status,iniciada_em,finalizada_em,pontuacao,total_acertos,total_erros,total_nao_respondidas,tempo_gasto_segundos,total_anuladas,total_sem_gabarito) on public.tentativas_simulado to authenticated;
-- Nenhum administrador lê simulados pessoais alheios por meio da Data API.
drop policy simulados_leitura on public.simulados;
create policy simulados_leitura on public.simulados for select to authenticated using (
  (status='publicado' and publico) or "idPessoaCriadora"=auth.uid()
  or (publico and (select public.eh_administrador())));

create function provas_privado.exigir_estudante() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  select u."idPessoa" into v_id from public.usuarios u join public.estudantes e on e."idEstudante"=u."idPessoa"
  where u."idUsuario"=auth.uid() and u.tipo='estudante' and u.estado_cadastro='ativo' and u.cadastro_completo;
  if v_id is null then raise exception 'Cadastro de estudante ativo e completo necessário' using errcode='42501'; end if;
  return v_id;
end $$;

create function provas_privado.criar_simulado_filtrado(p_nome text,p_quantidade integer,p_idtema uuid,p_ano integer,p_orgao text,p_organizadora text,p_cargo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_pessoa uuid; v_ids uuid[]; v_simulado uuid; v_tentativa uuid; v_disponiveis integer;
begin
  v_pessoa:=provas_privado.exigir_estudante();
  if p_nome is null or length(btrim(p_nome)) not between 3 and 200 or p_quantidade is null or p_quantidade not between 1 and 500
    or (p_ano is not null and p_ano not between 1000 and 9999) then raise exception 'Informe nome e quantidade entre 1 e 500'; end if;
  if p_idtema is not null and not exists(select 1 from public.temas where "idTema"=p_idtema) then raise exception 'Tema não encontrado'; end if;
  -- Bloqueia as questões selecionáveis contra edição até persistir a composição.
  select array_agg(x."idQuestao") into v_ids from (
    select q."idQuestao" from public.questoes q join public.concursos p on p."idConcurso"=q."idConcurso"
    join public.bancas b on b."idBanca"=p."idOrganizadora"
    where q.status='publicada' and q."idTema" is not null and q.numero is not null
      and (p_idtema is null or q."idTema"=p_idtema) and (p_ano is null or p.ano=p_ano)
      and (nullif(btrim(p_orgao),'') is null or strpos(lower(p.orgao),lower(btrim(p_orgao)))>0)
      and (nullif(btrim(p_organizadora),'') is null or strpos(lower(b.nome),lower(btrim(p_organizadora)))>0)
      and (nullif(btrim(p_cargo),'') is null or strpos(lower(p.cargo),lower(btrim(p_cargo)))>0)
      and (select count(*) from public.alternativas a where a."idQuestao"=q."idQuestao")>=2
    order by q."idQuestao" for share of q
  ) x;
  v_disponiveis:=coalesce(cardinality(v_ids),0);
  if v_disponiveis<p_quantidade then raise exception 'Há apenas % questões disponíveis para os critérios escolhidos',v_disponiveis; end if;
  select array_agg(id) into v_ids from (select id from unnest(v_ids) ids(id) order by random() limit p_quantidade) sorteio;
  insert into public.simulados(nome,tipo,publico,status,"idPessoaCriadora") values(btrim(p_nome),'personalizado',false,'publicado',v_pessoa) returning "idSimulado" into v_simulado;
  insert into public.simulado_questoes("idSimulado","idQuestao",ordem) select v_simulado,id,ordem::integer from unnest(v_ids) with ordinality ids(id,ordem);
  insert into public.tentativas_simulado("idSimulado","idPessoa") values(v_simulado,v_pessoa) returning "idTentativa" into v_tentativa;
  return v_tentativa;
end $$;
create function public.criar_simulado_filtrado(p_nome text,p_quantidade integer,p_idtema uuid default null,p_ano integer default null,p_orgao text default null,p_organizadora text default null,p_cargo text default null) returns uuid
language sql security invoker set search_path = '' as $$select provas_privado.criar_simulado_filtrado(p_nome,p_quantidade,p_idtema,p_ano,p_orgao,p_organizadora,p_cargo)$$;

create function provas_privado.iniciar_prova(p_idprova uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_pessoa uuid; v_simulado uuid; v_tentativa uuid; v_prova public.concursos;
begin
  v_pessoa:=provas_privado.exigir_estudante();
  select * into v_prova from public.concursos where "idConcurso"=p_idprova for update;
  if not found or not v_prova.composicao_confirmada or v_prova."idOrganizadora" is null then raise exception 'Prova pendente de revisão da composição original'; end if;
  if not exists(select 1 from public.questoes where "idConcurso"=p_idprova)
    or exists(select 1 from public.questoes q where q."idConcurso"=p_idprova and
      (q.numero is null or q."idTema" is null or q.status<>'publicada' or (select count(*) from public.alternativas a where a."idQuestao"=q."idQuestao")<2)) then
    raise exception 'Todas as questões da prova precisam estar revisadas e publicadas'; end if;
  select "idSimulado" into v_simulado from public.simulados where tipo='prova' and "idConcurso"=p_idprova and "idPessoaCriadora"=v_pessoa;
  if v_simulado is null then
    insert into public.simulados(nome,"idConcurso",tipo,publico,status,"idPessoaCriadora")
      values(concat(v_prova.orgao,' · ',v_prova.ano,' · ',v_prova.cargo),p_idprova,'prova',false,'publicado',v_pessoa) returning "idSimulado" into v_simulado;
    insert into public.simulado_questoes("idSimulado","idQuestao",ordem)
      select v_simulado,"idQuestao",row_number() over(order by numero,"idQuestao") from public.questoes where "idConcurso"=p_idprova order by numero;
  end if;
  select "idTentativa" into v_tentativa from public.tentativas_simulado where "idSimulado"=v_simulado and "idPessoa"=v_pessoa and status='em_andamento';
  if v_tentativa is null then insert into public.tentativas_simulado("idSimulado","idPessoa") values(v_simulado,v_pessoa) returning "idTentativa" into v_tentativa; end if;
  return v_tentativa;
end $$;
create function public.iniciar_prova(p_idprova uuid) returns uuid
language sql security invoker set search_path = '' as $$select provas_privado.iniciar_prova(p_idprova)$$;

-- Questões anuladas e sem gabarito são excluídas do denominador e dos erros.
create or replace function public.finalizar_tentativa(p_idtentativa uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_t public.tentativas_simulado; v_itens jsonb; v_acertos integer; v_erros integer; v_brancas integer; v_anuladas integer; v_sem integer; v_avaliadas integer;
begin
  select * into v_t from public.tentativas_simulado where "idTentativa"=p_idtentativa and "idPessoa"=provas_privado.exigir_estudante() for update;
  if not found then raise exception 'Tentativa não encontrada' using errcode='42501'; end if;
  if v_t.status<>'em_andamento' then raise exception 'Tentativa já encerrada'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('idQuestao',sq."idQuestao",'idAlternativaSelecionada',r."idAlternativaSelecionada",
    'idAlternativaCorreta',g."idAlternativaCorreta",'anulada',coalesce(g.status='anulada',false),'semGabarito',g."idQuestao" is null,
    'acertou',coalesce(g.status<>'anulada' and r."idAlternativaSelecionada"=g."idAlternativaCorreta",false),
    'explicacao',coalesce(g.explicacao,'')) order by sq.ordem),'[]'),
    count(*) filter(where g.status<>'anulada' and r."idAlternativaSelecionada"=g."idAlternativaCorreta"),
    count(*) filter(where g.status<>'anulada' and r."idAlternativaSelecionada" is not null and r."idAlternativaSelecionada"<>g."idAlternativaCorreta"),
    count(*) filter(where g.status<>'anulada' and r."idAlternativaSelecionada" is null),
    count(*) filter(where g.status='anulada'),count(*) filter(where g."idQuestao" is null),count(*) filter(where g.status<>'anulada')
  into v_itens,v_acertos,v_erros,v_brancas,v_anuladas,v_sem,v_avaliadas
  from public.simulado_questoes sq left join public.gabaritos g on g."idQuestao"=sq."idQuestao"
  left join public.respostas_simulado r on r."idTentativa"=v_t."idTentativa" and r."idQuestao"=sq."idQuestao" where sq."idSimulado"=v_t."idSimulado";
  update public.tentativas_simulado set status='finalizada',finalizada_em=now(),total_acertos=v_acertos,total_erros=v_erros,total_nao_respondidas=v_brancas,
    total_anuladas=v_anuladas,total_sem_gabarito=v_sem,pontuacao=case when v_avaliadas=0 then null else round(v_acertos::numeric*100/v_avaliadas,1) end,
    tempo_gasto_segundos=greatest(0,extract(epoch from now()-iniciada_em)::integer),correcao_json=v_itens where "idTentativa"=p_idtentativa;
  return jsonb_build_object('idTentativa',p_idtentativa,'itens',v_itens);
end $$;
alter function public.finalizar_tentativa(uuid) set schema provas_privado;
create function public.finalizar_tentativa(p_idtentativa uuid) returns jsonb language sql security invoker set search_path='' as $$select provas_privado.finalizar_tentativa(p_idtentativa)$$;

-- Preserva a validação completa de cadastro por senha; o Google cria um perfil incompleto.
alter function public.sincronizar_perfil_autenticacao() rename to sincronizar_perfil_senha;
-- Triggers continuam apontando para a função renomeada; substitui somente os triggers de Auth.
drop trigger ao_criar_usuario_concursa on auth.users;
drop trigger ao_atualizar_usuario_concursa on auth.users;
create function public.sincronizar_perfil_autenticacao() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' and new.raw_app_meta_data->>'provider'='google' then
    insert into public.pessoas("idPessoa",nome_completo) values(new.id,btrim(coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name','')));
    insert into public.usuarios("idUsuario","idPessoa",nome_completo,email,avatar_url,tipo,estado_cadastro,cadastro_completo,ultimo_acesso_em)
      values(new.id,new.id,btrim(coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name','')),coalesce(new.email,''),
        new.raw_user_meta_data->>'avatar_url','estudante',case when new.email_confirmed_at is not null then 'ativo' else 'verificacao_pendente' end,false,new.last_sign_in_at);
  elsif tg_op='UPDATE' then
    update public.usuarios set email=coalesce(new.email,''),estado_cadastro=case when new.email_confirmed_at is not null then 'ativo' when new.invited_at is not null then 'convite_pendente' else 'verificacao_pendente' end,
      ultimo_acesso_em=new.last_sign_in_at,atualizado_em=now() where "idUsuario"=new.id;
  else
    -- Exige o mesmo conjunto de dados do cadastro atual, sem replicar sua validação.
    raise exception 'Cadastro por senha deve usar o fluxo de cadastro completo';
  end if;
  return new;
end $$;
-- A função legada permanece como trigger para INSERT por senha com condição explícita.
create trigger ao_criar_usuario_senha after insert on auth.users for each row
  when (coalesce(new.raw_app_meta_data->>'provider','email')<>'google') execute function public.sincronizar_perfil_senha();
create trigger ao_criar_usuario_concursa after insert on auth.users for each row
  when (new.raw_app_meta_data->>'provider'='google') execute function public.sincronizar_perfil_autenticacao();
create trigger ao_atualizar_usuario_concursa after update of email,email_confirmed_at,invited_at,last_sign_in_at on auth.users
  for each row execute function public.sincronizar_perfil_autenticacao();
revoke all on function public.sincronizar_perfil_autenticacao() from public,anon,authenticated;

-- Whitelist explícita de RPCs; auxiliares e conclusão da migração continuam privados.
grant usage on schema provas_privado to authenticated;
revoke all on all functions in schema provas_privado from public,anon,authenticated;
grant execute on function provas_privado.salvar_prova(uuid,integer,text,uuid,text,boolean),provas_privado.listar_pendencias(integer,integer),
  provas_privado.salvar_questao(jsonb,jsonb,jsonb,uuid),provas_privado.criar_simulado_filtrado(text,integer,uuid,integer,text,text,text),
  provas_privado.iniciar_prova(uuid),provas_privado.finalizar_tentativa(uuid) to authenticated;
revoke all on function public.salvar_prova(uuid,integer,text,uuid,text,boolean),public.listar_pendencias_provas(integer,integer),
  public.salvar_questao(jsonb,jsonb,jsonb,uuid),public.criar_simulado_filtrado(text,integer,uuid,integer,text,text,text),public.iniciar_prova(uuid),public.finalizar_tentativa(uuid) from public,anon;
grant execute on function public.salvar_prova(uuid,integer,text,uuid,text,boolean),public.listar_pendencias_provas(integer,integer),
  public.salvar_questao(jsonb,jsonb,jsonb,uuid),public.criar_simulado_filtrado(text,integer,uuid,integer,text,text,text),public.iniciar_prova(uuid),public.finalizar_tentativa(uuid) to authenticated;


-- Os contratos históricos de estudo mantêm seus nomes; o agrupamento agora é pelo único tema.
create or replace function public.questoes_elegiveis_odonto()
returns table("idQuestao" uuid,"idAssunto" uuid,"idDisciplina" uuid)
language sql stable security definer set search_path='' as $$
select q."idQuestao",q."idTema",'00000000-0000-0000-0000-000000000001'::uuid from public.questoes q
join public.concursos p on p."idConcurso"=q."idConcurso" where q.status='publicada' and q."idTema" is not null and q.numero is not null and p."idOrganizadora" is not null
and (select count(*) from public.alternativas a where a."idQuestao"=q."idQuestao")>=2
and exists(select 1 from public.gabaritos g where g."idQuestao"=q."idQuestao" and g.status<>'anulada') $$;
create or replace function public.disponibilidade_assuntos_odonto()
returns table("idAssunto" uuid,assunto text,"idDisciplina" uuid,disciplina text,quantidade integer)
language plpgsql stable security definer set search_path='' as $$
begin perform provas_privado.exigir_estudante();
return query select t."idTema",t.nome,'00000000-0000-0000-0000-000000000001'::uuid,'Odontologia'::text,count(e."idQuestao")::integer
from public.temas t left join public.questoes_elegiveis_odonto() e on e."idAssunto"=t."idTema" group by t."idTema" order by t.nome;
end $$;
create or replace function public.estatisticas_assuntos()
returns table("idAssunto" uuid,assunto text,"idDisciplina" uuid,disciplina text,avaliadas integer,acertos integer,erros integer,em_branco integer)
language sql stable security definer set search_path='' as $$
select a."idTema",a.nome,'00000000-0000-0000-0000-000000000001'::uuid,'Odontologia'::text,count(*)::integer,
count(*) filter(where (i->>'acertou')::boolean)::integer,
count(*) filter(where not (i->>'acertou')::boolean and i->>'idAlternativaSelecionada' is not null)::integer,
count(*) filter(where not (i->>'acertou')::boolean and i->>'idAlternativaSelecionada' is null)::integer
from public.tentativas_simulado t cross join lateral jsonb_array_elements(t.correcao_json) i
join public.questoes q on q."idQuestao"=(i->>'idQuestao')::uuid join public.temas a on a."idTema"=q."idTema"
where t."idPessoa"=auth.uid() and t.status='finalizada' and not coalesce((i->>'anulada')::boolean,false) and not coalesce((i->>'semGabarito')::boolean,false)
group by a."idTema" order by a.nome $$;
create or replace function public.resumo_revisao_odonto() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_resultado jsonb;
begin perform public.quantidade_questoes_odonto();
with revisao as (select e.*,h.pendente,h.recuperada from public.questoes_elegiveis_odonto() e join public.ultimas_correcoes_odonto() h using("idQuestao")),
assuntos as(select a."idTema" as "idAssunto",a.nome assunto,'00000000-0000-0000-0000-000000000001'::uuid as "idDisciplina",'Odontologia'::text disciplina,count(*)::integer quantidade
from revisao r join public.temas a on a."idTema"=r."idAssunto" where r.pendente group by a."idTema" order by a.nome)
select jsonb_build_object('pendentes',(select count(*) from revisao where pendente),'recuperadas',(select count(*) from revisao where recuperada),'assuntos',coalesce((select jsonb_agg(to_jsonb(a)) from assuntos a),'[]')) into v_resultado;
return v_resultado;end $$;

CREATE OR REPLACE FUNCTION public.gerar_simulado_odonto(p_quantidade integer, p_assuntos jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pessoa uuid := auth.uid(); v_pool uuid[]; v_selecionadas uuid[] := '{}'::uuid[]; v_sorteio uuid[];
  v_assuntos uuid[] := '{}'::uuid[]; v_item jsonb; v_id uuid; v_cota integer; v_soma bigint := 0;
  v_simulado uuid; v_tentativa uuid;
begin
  -- Também valida a sessão antes de consultar qualquer questão.
  perform public.quantidade_questoes_odonto();
  if p_quantidade is null or p_quantidade < 1 then
    raise exception 'Informe uma quantidade inteira de pelo menos 1 questão'; end if;
  if p_assuntos is null or jsonb_typeof(p_assuntos) <> 'array' then
    raise exception 'Informe uma lista válida de assuntos'; end if;

  select array_agg(x."idQuestao") into v_pool from (
    select q."idQuestao" from public.questoes q
    
    join public.questoes_elegiveis_odonto() e on e."idQuestao" = q."idQuestao"
    order by q."idQuestao" for share of q
  ) x;
  v_pool := coalesce(v_pool, '{}'::uuid[]);
  if p_quantidade > cardinality(v_pool) then
    raise exception 'Há apenas % questões de Odontologia disponíveis', cardinality(v_pool); end if;

  for v_item in select value from jsonb_array_elements(p_assuntos) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item->'quantidade') is distinct from 'number'
      or (v_item->>'quantidade')::numeric < 0 or (v_item->>'quantidade')::numeric > p_quantidade
      or trunc((v_item->>'quantidade')::numeric) <> (v_item->>'quantidade')::numeric then
      raise exception 'A quantidade por assunto deve ser inteira, não negativa e menor ou igual ao total'; end if;
    select a."idTema" into v_id from public.temas a
      where a."idTema"::text = v_item->>'idAssunto' ;
    if v_id is null then raise exception 'Assunto indisponível para Odontologia'; end if;
    if v_id = any(v_assuntos) then raise exception 'Há assuntos repetidos na distribuição'; end if;
    v_assuntos := array_append(v_assuntos, v_id);
    v_cota := (v_item->>'quantidade')::integer;
    v_soma := v_soma + v_cota;
    if v_soma > p_quantidade then raise exception 'A soma por assunto ultrapassa o total de questões'; end if;
    select coalesce(array_agg(x."idQuestao"), '{}'::uuid[]) into v_sorteio from (
      select q."idQuestao" from public.questoes q where q."idQuestao" = any(v_pool) and q."idTema" = v_id
      order by random() limit v_cota
    ) x;
    if cardinality(v_sorteio) <> v_cota then raise exception 'Quantidade indisponível para um dos assuntos selecionados'; end if;
    v_selecionadas := v_selecionadas || v_sorteio;
  end loop;
  -- Cotas são exatas, inclusive zero. O restante vem apenas de assuntos sem cota.
  select coalesce(array_agg(x."idQuestao"), '{}'::uuid[]) into v_sorteio from (
    select q."idQuestao" from public.questoes q where q."idQuestao" = any(v_pool) and not(q."idTema" = any(v_assuntos))
    order by random() limit (p_quantidade - v_soma)
  ) x;
  v_selecionadas := v_selecionadas || v_sorteio;
  if cardinality(v_selecionadas) <> p_quantidade then
    raise exception 'Os demais assuntos não têm questões suficientes para completar o total. Ajuste a distribuição'; end if;
  select array_agg(id order by random()) into v_selecionadas from unnest(v_selecionadas) as itens(id);

  insert into public.simulados(nome, descricao, tipo, publico, status, "idPessoaCriadora")
    values ('Odontologia · ' || p_quantidade || case when p_quantidade = 1 then ' questão' else ' questões' end,
      'Simulado pessoal com questões sorteadas por assunto.', 'personalizado', false, 'publicado', v_pessoa)
    returning "idSimulado" into v_simulado;
  insert into public.simulado_questoes("idSimulado", "idQuestao", ordem)
    select v_simulado, item, ordem::integer from unnest(v_selecionadas) with ordinality as itens(item, ordem);
  insert into public.tentativas_simulado("idSimulado", "idPessoa") values(v_simulado, v_pessoa)
    returning "idTentativa" into v_tentativa;
  return v_tentativa;
end $function$;

CREATE OR REPLACE FUNCTION public.gerar_treino_odonto(p_quantidade integer, p_modo text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_pool uuid[]; v_ids uuid[]; v_simulado uuid; v_tentativa uuid; v_titulo text;
begin
  perform public.quantidade_questoes_odonto();
  if p_modo is null or p_modo not in ('revisao', 'recomendado') then raise exception 'Tipo de treino inválido'; end if;
  if p_quantidade is null or p_quantidade < 1 then raise exception 'Informe uma quantidade inteira de pelo menos 1 questão'; end if;
  select coalesce(array_agg(x."idQuestao"), '{}'::uuid[]) into v_pool from (
    select q."idQuestao" from public.questoes q
    
    join public.questoes_elegiveis_odonto() e on e."idQuestao" = q."idQuestao"
    left join public.ultimas_correcoes_odonto() h on h."idQuestao" = q."idQuestao"
    where p_modo = 'recomendado' or h.pendente
    order by q."idQuestao" for share of q
  ) x;
  if p_quantidade > cardinality(v_pool) then raise exception 'Há apenas % questões disponíveis para este treino', cardinality(v_pool); end if;
  -- A taxa de erros/brancos prioriza assuntos. Sem histórico, prioridade intermediária.
  select array_agg(x."idQuestao" order by random()) into v_ids from (
    select q."idQuestao" from public.questoes q
    left join public.estatisticas_assuntos() e on e."idAssunto" = q."idTema"
    where q."idQuestao" = any(v_pool)
    order by case when p_modo = 'recomendado'
      then coalesce((e.erros + e.em_branco)::numeric / nullif(e.avaliadas, 0), .5) else 0 end desc,
      random() limit p_quantidade
  ) x;
  v_titulo := case when p_modo = 'revisao' then 'Revisão de erros' else 'Treino recomendado' end;
  insert into public.simulados(nome, descricao, tipo, publico, status, "idPessoaCriadora")
    values(v_titulo || ' · ' || p_quantidade || case when p_quantidade = 1 then ' questão' else ' questões' end,
      case when p_modo = 'revisao' then 'Questões com erro ou em branco na correção mais recente.'
        else 'Treino priorizado pelo desempenho por assunto; sem histórico, sorteio geral.' end,
      'personalizado', false, 'publicado', auth.uid()) returning "idSimulado" into v_simulado;
  insert into public.simulado_questoes("idSimulado", "idQuestao", ordem)
    select v_simulado, item, ordem::integer from unnest(v_ids) with ordinality as itens(item, ordem);
  insert into public.tentativas_simulado("idSimulado", "idPessoa") values(v_simulado, auth.uid())
    returning "idTentativa" into v_tentativa;
  return v_tentativa;
end $function$;

CREATE OR REPLACE FUNCTION public.listar_questoes_revisao(p_pagina integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v_itens jsonb; v_total integer;
begin
  if p_pagina is null or p_pagina < 1 or p_pagina > 100000 then raise exception 'Página inválida.'; end if;
  perform public.quantidade_questoes_odonto();
  with recentes as (
    select distinct on (i->>'idQuestao') t."idTentativa", t.finalizada_em, i
    from public.tentativas_simulado t cross join lateral jsonb_array_elements(public.obter_resultado_tentativa(t."idTentativa")->'itens') i
    where t."idPessoa" = auth.uid() and t.status = 'finalizada'
    order by i->>'idQuestao', t.finalizada_em desc, t.iniciada_em desc, t."idTentativa" desc
  ), pendentes as (
    select r."idTentativa", q."idQuestao", q.enunciado, r.finalizada_em as "finalizadaEm", a.nome as assunto, 'Odontologia'::text as disciplina
    from recentes r join public.questoes q on q."idQuestao" = (r.i->>'idQuestao')::uuid
    join public.temas a on a."idTema" = q."idTema"
    where not (r.i->>'acertou')::boolean and not (r.i->>'anulada')::boolean and not coalesce((r.i->>'semGabarito')::boolean,false) and r.i->>'idAlternativaSelecionada' is not null
      and q.status = 'publicada' 
  ), pagina as (select * from pendentes order by "finalizadaEm" desc, "idQuestao" limit 5 offset (p_pagina - 1) * 5)
  select (select count(*)::integer from pendentes), coalesce((select jsonb_agg(to_jsonb(p)) from pagina p), '[]'::jsonb) into v_total, v_itens;
  return jsonb_build_object('itens', v_itens, 'total', v_total, 'pagina', p_pagina, 'por_pagina', 5);
end $function$;

CREATE OR REPLACE FUNCTION public.ultimas_correcoes_odonto()
 RETURNS TABLE("idQuestao" uuid, pendente boolean, recuperada boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with historico as (
    select (i->>'idQuestao')::uuid as questao, (i->>'acertou')::boolean as acertou,
      coalesce((i->>'anulada')::boolean, false) as anulada,
      t.finalizada_em, t.iniciada_em, t."idTentativa",
      bool_or(not (i->>'acertou')::boolean and not coalesce((i->>'anulada')::boolean, false))
        over (partition by i->>'idQuestao') as ja_errou
    from public.tentativas_simulado t cross join lateral jsonb_array_elements(t.correcao_json) i
    where t."idPessoa" = auth.uid() and t.status = 'finalizada' and not coalesce((i->>'semGabarito')::boolean,false)
  )
  select distinct on (questao) questao, not acertou and not anulada, acertou and ja_errou and not anulada
  from historico order by questao, finalizada_em desc, iniciada_em desc, "idTentativa" desc;
$function$;


-- Leituras de questões já respondidas continuam possíveis após arquivamento.
drop policy questoes_leitura on public.questoes;
create policy questoes_leitura on public.questoes for select to authenticated using (status='publicada' or (select public.eh_administrador()) or exists(
select 1 from public.simulado_questoes sq join public.tentativas_simulado t using("idSimulado") where sq."idQuestao"=questoes."idQuestao" and t."idPessoa"=auth.uid()));

create function provas_privado.validar_cadastro_questao() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' or (new."idConcurso",new."idTema",new.numero) is distinct from (old."idConcurso",old."idTema",old.numero) then
    if new."idConcurso" is null or new."idTema" is null or new.numero is null then raise exception 'Informe prova, tema e número original'; end if;
    perform 1 from public.concursos where "idConcurso"=new."idConcurso" and "idOrganizadora" is not null for update;
    if not found then raise exception 'Revise os dados obrigatórios da prova'; end if;
    if exists(select 1 from public.simulados s where s.tipo='prova' and (s."idConcurso"=new."idConcurso" or (tg_op='UPDATE' and s."idConcurso"=old."idConcurso"))) then
      raise exception 'Composição de prova com tentativas deve permanecer preservada'; end if;
    update public.concursos set composicao_confirmada=false where "idConcurso"=new."idConcurso" or (tg_op='UPDATE' and "idConcurso"=old."idConcurso");
  end if;
  return new;
end $$;
create trigger validar_cadastro_questao before insert or update of "idConcurso","idTema",numero on public.questoes for each row execute function provas_privado.validar_cadastro_questao();
create function provas_privado.validar_cadastro_prova() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' and new."idOrganizadora" is null then raise exception 'Informe a organizadora pelo cadastro de provas'; end if;
  if new."idOrganizadora" is distinct from old."idOrganizadora" and new."idOrganizadora" is null then raise exception 'Organizadora obrigatória'; end if;
  return new;
end $$;
create trigger validar_cadastro_prova before insert or update on public.concursos for each row execute function provas_privado.validar_cadastro_prova();

-- Reaplica os grants após criar também os auxiliares de triggers.
revoke all on all functions in schema provas_privado from public,anon,authenticated;
grant execute on function provas_privado.salvar_prova(uuid,integer,text,uuid,text,boolean),provas_privado.listar_pendencias(integer,integer),
  provas_privado.salvar_questao(jsonb,jsonb,jsonb,uuid),provas_privado.criar_simulado_filtrado(text,integer,uuid,integer,text,text,text),
  provas_privado.iniciar_prova(uuid),provas_privado.finalizar_tentativa(uuid) to authenticated;
commit;
