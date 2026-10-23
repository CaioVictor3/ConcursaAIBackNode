-- Executar em banco de testes após todas as migrations. Nenhum dado é mantido.
begin;
\ir fixtures/identidade_nativa.sql
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data)
values('c0100000-0000-4000-8000-000000000001','cotas@example.invalid',now(),
'{"nome_completo":"Aluno Cotas","data_nascimento":"2000-01-01","cpf":"52998224725","cep":"01001000","logradouro":"Rua Teste","numero":"1","bairro":"Centro","cidade":"Teste","uf":"SP"}','{"provider":"email"}');
insert into public.bancas("idBanca",nome,sigla) values('c0100000-0000-4000-8000-000000000002','Banca Cotas','BC');
insert into public.concursos("idConcurso",nome,orgao,ano,"idOrganizadora",cargo) values
('c0100000-0000-4000-8000-000000000003','Prova Cotas','Órgão Cotas',2026,'c0100000-0000-4000-8000-000000000002','Dentista'),
('c0100000-0000-4000-8000-000000000004','Prova anterior','Órgão Cotas',2025,'c0100000-0000-4000-8000-000000000002','Dentista');
do $$ declare v_q uuid;v_tema uuid;i integer;
begin
  for i in 1..10 loop
    v_q:=gen_random_uuid();
    select "idTema" into v_tema from public.temas where nome=case when i<=3 or i>=9 then 'Endodontia' when i<=6 then 'Periodontia' else 'Odontopediatria' end;
    insert into public.questoes("idQuestao","idConcurso","idTema",numero,enunciado,status) values
      (v_q,case when i<=8 then 'c0100000-0000-4000-8000-000000000003'::uuid else 'c0100000-0000-4000-8000-000000000004'::uuid end,v_tema,i,'Questão cotas '||i,'publicada');
    insert into public.alternativas("idQuestao",letra,texto,ordem) values(v_q,'A','Alternativa A',1),(v_q,'B','Alternativa B',2);
  end loop;
end $$;
select set_config('request.jwt.claim.sub','c0100000-0000-4000-8000-000000000001',true);
set local role concursa_dados;
do $$ declare v_e uuid;v_p uuid;v_o uuid;v_id uuid;v_s uuid;v_ordem uuid[];v_invalida jsonb;v_antes integer;
begin
  select "idTema" into v_e from public.temas where nome='Endodontia';
  select "idTema" into v_p from public.temas where nome='Periodontia';
  select "idTema" into v_o from public.temas where nome='Odontopediatria';
  v_id:=public.criar_simulado_filtrado('Distribuição parcial',5,null,2026,'Órgão Cotas','Banca Cotas','Dentista',
    jsonb_build_array(jsonb_build_object('idTema',v_e,'quantidade',1),jsonb_build_object('idTema',v_p,'quantidade',2)));
  select "idSimulado" into v_s from public.tentativas_simulado where "idTentativa"=v_id;
  assert (select count(*)=5 and count(distinct "idQuestao")=5 from public.simulado_questoes where "idSimulado"=v_s),'Total ou unicidade incorretos';
  assert (select count(*)=1 from public.simulado_questoes s join public.questoes q using("idQuestao") where s."idSimulado"=v_s and q."idTema"=v_e),'Ignorou cota exata';
  assert (select count(*)=2 from public.simulado_questoes s join public.questoes q using("idQuestao") where s."idSimulado"=v_s and q."idTema"=v_p),'Ignorou segunda cota';
  assert (select count(*)=2 from public.simulado_questoes s join public.questoes q using("idQuestao") where s."idSimulado"=v_s and q."idTema"=v_o),'Complemento reutilizou temas com cotas';
  assert not exists(select 1 from public.simulado_questoes s join public.questoes q using("idQuestao") where s."idSimulado"=v_s and q."idConcurso"<>'c0100000-0000-4000-8000-000000000003'),'Ignorou filtro de ano';
  select array_agg("idQuestao" order by ordem) into v_ordem from public.simulado_questoes where "idSimulado"=v_s;
  assert public.iniciar_tentativa(v_s)=v_id,'Reabertura criou outra tentativa';
  assert (select array_agg("idQuestao" order by ordem)=v_ordem from public.simulado_questoes where "idSimulado"=v_s),'Reabertura sorteou novamente';

  v_id:=public.criar_simulado_filtrado('Distribuição completa',2,null,2026,null,null,null,
    jsonb_build_array(jsonb_build_object('idTema',v_e,'quantidade',1),jsonb_build_object('idTema',v_p,'quantidade',1)));
  select "idSimulado" into v_s from public.tentativas_simulado where "idTentativa"=v_id;
  assert (select count(*)=2 from public.simulado_questoes where "idSimulado"=v_s);
  assert not exists(select 1 from public.simulado_questoes s join public.questoes q using("idQuestao") where s."idSimulado"=v_s and q."idTema"=v_o);

  v_id:=public.criar_simulado_filtrado('Excluir um tema',5,null,2026,null,null,null,jsonb_build_array(jsonb_build_object('idTema',v_e,'quantidade',0)));
  select "idSimulado" into v_s from public.tentativas_simulado where "idTentativa"=v_id;
  assert not exists(select 1 from public.simulado_questoes s join public.questoes q using("idQuestao") where s."idSimulado"=v_s and q."idTema"=v_e),'Cota zero não excluiu o tema';

  -- Compatibilidade com o filtro único e com chamadas sem o novo parâmetro.
  v_id:=public.criar_simulado_filtrado('Um único tema',3,v_e,2026,null,null,null);
  select "idSimulado" into v_s from public.tentativas_simulado where "idTentativa"=v_id;
  assert (select count(*)=3 from public.simulado_questoes where "idSimulado"=v_s);
  assert not exists(select 1 from public.simulado_questoes s join public.questoes q using("idQuestao") where s."idSimulado"=v_s and q."idTema"<>v_e);

  select count(*) into v_antes from public.simulados;
  begin
    perform public.criar_simulado_filtrado('Faltam no tema',4,null,2026,null,null,null,jsonb_build_array(jsonb_build_object('idTema',v_e,'quantidade',4)));
    raise exception 'Aceitou cota sem acervo';
  exception when raise_exception then assert sqlerrm like 'O tema "Endodontia" possui apenas 3 questões%';end;
  begin
    perform public.criar_simulado_filtrado('Complemento insuficiente',7,null,2026,null,null,null,jsonb_build_array(jsonb_build_object('idTema',v_e,'quantidade',1)));
    raise exception 'Complemento usou tema com cota';
  exception when raise_exception then assert sqlerrm like 'A distribuição permite completar apenas 6 de 7 questões%';end;
  begin
    perform public.criar_simulado_filtrado('Filtro sem questões',1,null,2024,null,null,null,jsonb_build_array(jsonb_build_object('idTema',v_e,'quantidade',1)));
    raise exception 'Ignorou filtros nas cotas';
  exception when raise_exception then assert sqlerrm like 'Há apenas 0 questões%';end;
  begin
    perform public.criar_simulado_filtrado('Temas duplicados',2,null,2026,null,null,null,jsonb_build_array(jsonb_build_object('idTema',v_e,'quantidade',1),jsonb_build_object('idTema',v_e,'quantidade',1)));
    raise exception 'Aceitou repetição';
  exception when raise_exception then assert sqlerrm like 'Há temas repetidos%';end;
  begin
    perform public.criar_simulado_filtrado('Total excedido',1,null,2026,null,null,null,jsonb_build_array(jsonb_build_object('idTema',v_e,'quantidade',2)));
    raise exception 'Aceitou soma excedida';
  exception when raise_exception then assert sqlerrm like 'A soma das quantidades%';end;
  for v_invalida in select value from jsonb_array_elements(jsonb_build_array(null,'{}'::jsonb,'[null]'::jsonb,
    jsonb_build_array(jsonb_build_object('idTema',v_e,'quantidade',-1)),jsonb_build_array(jsonb_build_object('idTema',v_e,'quantidade',1.5)),
    jsonb_build_array(jsonb_build_object('idTema','00000000-0000-0000-0000-000000000000','quantidade',1)))) loop
    begin
      perform public.criar_simulado_filtrado('Entrada inválida',1,null,2026,null,null,null,v_invalida);
      raise exception 'Aceitou distribuição inválida';
    exception when raise_exception then assert sqlerrm not like 'Aceitou%';end;
  end loop;
  assert (select count(*)=v_antes from public.simulados),'Falha criou simulado parcial';
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.criar_simulado_filtrado('Sem autenticação',1);raise exception 'Anônimo criou simulado';exception when insufficient_privilege then null;end;
end $$;
rollback;
