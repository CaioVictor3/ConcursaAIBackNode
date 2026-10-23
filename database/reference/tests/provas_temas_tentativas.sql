-- PostgreSQL 17 / Supabase. Executar após todas as migrations; rollback ao fim.
begin;
\ir fixtures/identidade_nativa.sql
-- O seed é repetível e conserva todos os IDs.
create temporary table temas_antes as select * from public.temas;
create temporary table acervo_antes as select
  (select count(*) from public.questoes where fonte like 'Apostila Questões Concurso Público%') questoes,
  (select count(*) from public.alternativas a join public.questoes q using("idQuestao") where q.fonte like 'Apostila Questões Concurso Público%') alternativas,
  (select count(*) from public.gabaritos g join public.questoes q using("idQuestao") where q.fonte like 'Apostila Questões Concurso Público%') gabaritos;
select provas_privado.cadastrar_temas();
do $$ begin
  assert (select count(*) from public.temas)=25;
  assert not exists((select * from temas_antes except select * from public.temas) union all (select * from public.temas except select * from temas_antes));
  begin insert into public.temas(nome) values('  Tema com espaço  '); raise exception 'Aceitou nome sem normalizar'; exception when check_violation then null; end;
  begin insert into public.temas(nome) values('ENDODONTIA'); raise exception 'Aceitou tema duplicado'; exception when unique_violation then null; end;
  if exists(select 1 from public.pendencias_provas_questoes) then
    begin perform provas_privado.concluir_migracao(); raise exception 'Concluiu com pendências'; exception when raise_exception then assert sqlerrm like 'Resolva as pendências%'; end;
  end if;
end $$;

insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data)
select id,email,now(),jsonb_build_object('nome_completo','Pessoa Teste','data_nascimento','2000-01-01','cpf',cpf,'cep','01001000','logradouro','Rua Teste','numero','1','bairro','Centro','cidade','Teste','uf','SP'),'{"provider":"email"}'
from (values ('a0000000-0000-0000-0000-000000000001'::uuid,'admin-prova@example.invalid','52998224725'),
 ('a0000000-0000-0000-0000-000000000002'::uuid,'aluno-prova@example.invalid','11144477735')) u(id,email,cpf);
-- Perfil mínimo Google é completado pelo fluxo existente, nunca por metadados de autorização.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data)
values('a0000000-0000-0000-0000-000000000003','google-prova@example.invalid',now(),'{"full_name":"Pessoa Google","tipo":"administrador"}','{"provider":"google"}');
do $$ begin assert exists(select 1 from public.usuarios where "idUsuario"='a0000000-0000-0000-0000-000000000003' and tipo='estudante' and not cadastro_completo); end $$;
update public.usuarios set tipo='administrador' where "idUsuario"='a0000000-0000-0000-0000-000000000001';
insert into public.bancas("idBanca",nome,sigla) values('b0000000-0000-0000-0000-000000000001','Organizadora de teste','OT');
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);
set local role concursa_dados;
do $$
declare v_prova uuid; v_tema uuid; v_id uuid; v_a uuid; v_b uuid; v_ids uuid[]:='{}'; i integer;
begin
  select "idTema" into v_tema from public.temas where nome='Endodontia';
  v_prova:=public.salvar_prova(null,2026,'Órgão de teste','b0000000-0000-0000-0000-000000000001','Dentista',false);
  perform set_config('teste.prova',v_prova::text,true);
  for i in 1..5 loop
    select "idTema" into v_tema from public.temas where nome=case when i=5 then 'Farmacologia e Anestesiologia' else 'Endodontia' end;
    v_a:=gen_random_uuid();v_b:=gen_random_uuid();
    v_id:=public.salvar_questao(jsonb_build_object('idProva',v_prova,'idTema',v_tema,'numero',i*10,'enunciado','Questão de teste '||i,'explicacao','Comentário '||i,'status','publicada'),
      jsonb_build_array(jsonb_build_object('idAlternativa',v_a,'letra','A','texto','Alternativa A','ordem',1),jsonb_build_object('idAlternativa',v_b,'letra','B','texto','Alternativa B','ordem',2)),
      case when i=5 then '{"status":"pendente"}'::jsonb when i=4 then '{"status":"anulada"}'::jsonb else jsonb_build_object('status','definitivo','idAlternativaCorreta',v_a) end);
    v_ids:=array_append(v_ids,v_id);
  end loop;
  perform set_config('teste.questoes',v_ids::text,true);
  assert public.obter_explicacao_questao(v_ids[5])='Comentário 5','Perdeu explicação de questão sem gabarito';
  -- ID de prova não depende de unicidade artificial por ano/órgão/organizadora.
  perform public.salvar_prova(null,2026,'Órgão de teste','b0000000-0000-0000-0000-000000000001','Outro cargo',false);
  perform public.salvar_prova(v_prova,2026,'Órgão de teste','b0000000-0000-0000-0000-000000000001','Dentista',true);
end $$;
reset role;
do $$ declare v_id uuid:=current_setting('teste.prova')::uuid; v_tema uuid;
begin
  select "idTema" into v_tema from public.temas where nome='Endodontia';
  begin insert into public.questoes("idConcurso","idTema",numero,enunciado) values(v_id,v_tema,10,'Repetida');raise exception 'Aceitou número repetido';exception when unique_violation then null;end;
  begin delete from public.temas where "idTema"=v_tema;raise exception 'Excluiu tema vinculado';exception when foreign_key_violation then null;end;
  begin delete from public.concursos where "idConcurso"=v_id;raise exception 'Excluiu prova vinculada';exception when foreign_key_violation then null;end;
  begin insert into public.questoes(enunciado) values('Incompleta');raise exception 'Aceitou questão nova sem vínculos';exception when raise_exception then assert sqlerrm='Informe prova, tema e número original';end;
end $$;
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000002',true);
set local role concursa_dados;
do $$ declare v_id uuid;v_s uuid;v_prova uuid:=current_setting('teste.prova')::uuid;v_ids uuid[]:=current_setting('teste.questoes')::uuid[];v_a uuid;v_p uuid;v_ordem uuid[];v_resultado jsonb;v_n integer;v_filtro jsonb;
begin
  assert (select count(*) from public.gabaritos)=0,'Gabarito exposto antes da resolução';
  begin perform public.obter_explicacao_questao(v_ids[1]);raise exception 'Explicação administrativa exposta';exception when insufficient_privilege then null;end;
  begin perform public.criar_simulado_filtrado('Sem acervo',6,null,2026,'Órgão de teste',null,null);raise exception 'Sorteio aceitou quantidade insuficiente';exception when raise_exception then assert sqlerrm like 'Há apenas 5 questões disponíveis%';end;
  assert (select count(*) from public.tentativas_simulado)=0,'Falha deixou tentativa parcial';
  for v_filtro in select value from jsonb_array_elements('[{"ano":2025},{"orgao":"Órgão inexistente"},{"organizadora":"Banca inexistente"},{"cargo":"Cargo inexistente"}]'::jsonb) loop
    begin
      perform public.criar_simulado_filtrado('Filtro sem acervo',1,null,(v_filtro->>'ano')::integer,v_filtro->>'orgao',v_filtro->>'organizadora',v_filtro->>'cargo');
      raise exception 'Ignorou filtro de prova';
    exception when raise_exception then assert sqlerrm like 'Há apenas 0 questões disponíveis%';end;
  end loop;
  begin
    perform public.criar_simulado_filtrado('Tema sem acervo',1,(select "idTema" from public.temas where nome='Odontopediatria'),null,null,null,null);
    raise exception 'Ignorou filtro de tema';
  exception when raise_exception then assert sqlerrm like 'Há apenas 0 questões disponíveis%';end;
  v_id:=public.criar_simulado_filtrado('Meu simulado',5,null,2026,'Órgão de teste','Organizadora de teste','Dentista');
  select "idSimulado" into v_s from public.tentativas_simulado where "idTentativa"=v_id;
  assert (select count(distinct "idQuestao")=5 from public.simulado_questoes where "idSimulado"=v_s);
  select array_agg("idQuestao" order by ordem) into v_ordem from public.simulado_questoes where "idSimulado"=v_s;
  assert (select array_agg("idQuestao" order by ordem)=v_ordem from public.simulado_questoes where "idSimulado"=v_s),'Reabertura mudou a ordem';
  select "idAlternativa" into v_a from public.alternativas where "idQuestao"=v_ids[1] and letra='A';
  perform public.responder_questao(v_id,v_ids[1],v_a);
  select "idAlternativa" into v_a from public.alternativas where "idQuestao"=v_ids[2] and letra='B';
  perform public.responder_questao(v_id,v_ids[2],v_a);
  -- Não aceita alternativa de outra questão.
  begin perform public.responder_questao(v_id,v_ids[3],v_a);raise exception 'Aceitou alternativa alheia';exception when raise_exception then assert sqlerrm like 'Alternativa%';end;
  v_resultado:=public.finalizar_tentativa(v_id);
  assert exists(select 1 from public.tentativas_simulado where "idTentativa"=v_id and total_acertos=1 and total_erros=1 and total_nao_respondidas=1 and total_anuladas=1 and total_sem_gabarito=1 and pontuacao=33.3);
  assert jsonb_array_length(v_resultado->'itens')=5;
  begin perform public.responder_questao(v_id,v_ids[1],null);raise exception 'Alterou finalizada';exception when raise_exception then assert sqlerrm like 'Tentativa%';end;
  assert public.obter_resultado_tentativa(v_id)->'itens'=v_resultado->'itens','Correção mudou depois de finalizar';
  begin perform correcao_json from public.tentativas_simulado where "idTentativa"=v_id;raise exception 'Coluna protegida exposta';exception when insufficient_privilege then null;end;
  assert (select sum(quantidade)=3 from public.disponibilidade_assuntos_odonto()),'Acervo de estudo divergente';
  assert (select sum(avaliadas)=3 from public.estatisticas_assuntos()),'Anuladas ou sem gabarito entraram nas estatísticas';
  assert (public.resumo_revisao_odonto()->>'pendentes')::integer=2;
  v_id:=public.criar_simulado_filtrado('Somente sem gabarito',1,(select "idTema" from public.temas where nome='Farmacologia e Anestesiologia'),null,null,null,null);
  perform public.finalizar_tentativa(v_id);
  assert exists(select 1 from public.tentativas_simulado where "idTentativa"=v_id and pontuacao is null and total_erros=0 and total_acertos=0 and total_nao_respondidas=0 and total_sem_gabarito=1),'Pontuou questão sem gabarito';
  perform public.gerar_simulado_odonto(2,'[]'::jsonb);
  perform public.gerar_treino_odonto(2,'revisao');
  v_p:=public.iniciar_prova(v_prova);
  assert public.iniciar_prova(v_prova)=v_p,'Criou duas tentativas ao retomar';
  select "idSimulado" into v_s from public.tentativas_simulado where "idTentativa"=v_p;
  assert public.iniciar_tentativa(v_s)=v_p,'Retomar criou nova tentativa';
  assert exists(select 1 from public.simulados where "idSimulado"=v_s and tipo='prova' and not publico);
  assert (select array_agg("idQuestao" order by ordem)=v_ids from public.simulado_questoes where "idSimulado"=v_s),'Ordem original perdida';
  perform set_config('teste.tentativa',v_p::text,true);
  perform set_config('teste.simulado',v_s::text,true);
end $$;
reset role;
insert into public.simulados("idSimulado",nome,tipo,publico,status,"idPessoaCriadora") values('c0000000-0000-4000-8000-000000000001','Pessoal sem tentativa','personalizado',false,'rascunho','a0000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);
set local role concursa_dados;
do $$ begin
  assert not exists(select 1 from public.tentativas_simulado),'Administrador leu tentativa alheia';
  assert not exists(select 1 from public.simulados where "idSimulado"=current_setting('teste.simulado')::uuid),'Administrador leu simulado pessoal alheio';
  assert public.obter_resultado_tentativa(current_setting('teste.tentativa')::uuid) is null;
  begin
    perform public.salvar_simulado('{"nome":"Edição alheia","tipo":"personalizado","status":"publicado","publico":false}'::jsonb,current_setting('teste.questoes')::uuid[],'c0000000-0000-4000-8000-000000000001'::uuid);
    raise exception 'Admin alterou simulado pessoal alheio';
  exception when insufficient_privilege then null;end;
  begin perform public.responder_questao(current_setting('teste.tentativa')::uuid,(current_setting('teste.questoes')::uuid[])[1],null);raise exception 'IDOR de resposta';exception when raise_exception then assert sqlerrm like 'Tentativa%';end;
end $$;
reset role;
-- Preservação do material importado: IDs, alternativas e gabaritos permanecem existentes.
do $$ begin
  assert (select count(*) from public.questoes where fonte like 'Apostila Questões Concurso Público%')=(select questoes from acervo_antes);
  assert (select count(*) from public.alternativas a join public.questoes q using("idQuestao") where q.fonte like 'Apostila Questões Concurso Público%')=(select alternativas from acervo_antes);
  assert (select count(*) from public.gabaritos g join public.questoes q using("idQuestao") where q.fonte like 'Apostila Questões Concurso Público%')=(select gabaritos from acervo_antes);
end $$;
rollback;
