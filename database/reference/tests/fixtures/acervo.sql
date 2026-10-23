-- Fixture independente da apostila, dentro da transação aberta pelo teste chamador.
insert into public.bancas("idBanca",nome,sigla) values('d0000000-0000-4000-8000-000000000001','Organizadora de teste','OT');
insert into public.concursos("idConcurso",nome,orgao,ano,"idOrganizadora") values('d0000000-0000-4000-8000-000000000002','Prova de teste','Órgão de teste',2026,'d0000000-0000-4000-8000-000000000001');
do $$ declare v_id uuid;v_a uuid;v_b uuid;v_tema uuid;i integer;
begin
  for i in 1..4 loop
    v_id:=gen_random_uuid();v_a:=gen_random_uuid();v_b:=gen_random_uuid();
    select "idTema" into v_tema from public.temas where nome=case when i<=2 then 'Endodontia' else 'Periodontia' end;
    insert into public.questoes("idQuestao","idConcurso","idTema",numero,enunciado,status)
      values(v_id,'d0000000-0000-4000-8000-000000000002',v_tema,i,'Questão de teste '||i,'publicada');
    insert into public.alternativas("idAlternativa","idQuestao",letra,texto,ordem) values(v_a,v_id,'A','Alternativa correta',1),(v_b,v_id,'B','Alternativa incorreta',2);
    insert into public.gabaritos("idQuestao","idAlternativaCorreta") values(v_id,v_a);
  end loop;
end $$;
