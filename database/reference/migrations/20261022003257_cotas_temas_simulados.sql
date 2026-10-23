begin;

-- Substitui a assinatura anterior para evitar sobrecargas ambíguas no PostgREST.
-- Chamadas antigas continuam válidas: o novo parâmetro é opcional.
drop function public.criar_simulado_filtrado(text,integer,uuid,integer,text,text,text);
drop function provas_privado.criar_simulado_filtrado(text,integer,uuid,integer,text,text,text);

create function provas_privado.criar_simulado_filtrado(
  p_nome text,p_quantidade integer,p_idtema uuid,p_ano integer,p_orgao text,p_organizadora text,p_cargo text,p_cotas_temas jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_pessoa uuid; v_elegiveis uuid[]; v_ids uuid[]:='{}'; v_sorteio uuid[];
  v_simulado uuid; v_tentativa uuid; v_disponiveis integer; v_restantes integer;
  v_cota record; v_tema text;
begin
  v_pessoa:=provas_privado.exigir_estudante();
  if p_nome is null or length(btrim(p_nome)) not between 3 and 200 or p_quantidade is null or p_quantidade not between 1 and 500
    or (p_ano is not null and p_ano not between 1000 and 9999)
    or length(btrim(p_orgao))>200 or length(btrim(p_organizadora))>200 or length(btrim(p_cargo))>200 then
    raise exception 'Informe nome, filtros válidos e quantidade entre 1 e 500';
  end if;
  if p_idtema is not null and not exists(select 1 from public.temas where "idTema"=p_idtema) then raise exception 'Tema não encontrado'; end if;
  if jsonb_typeof(p_cotas_temas) is distinct from 'array' then raise exception 'Informe uma lista de quantidades por tema'; end if;
  if jsonb_array_length(p_cotas_temas)>25 then raise exception 'Informe no máximo 25 temas'; end if;
  if p_idtema is not null and jsonb_array_length(p_cotas_temas)>0 then raise exception 'Escolha um único tema ou distribua as questões por tema'; end if;
  if exists(select 1 from jsonb_array_elements(p_cotas_temas) c where
    jsonb_typeof(c) is distinct from 'object' or jsonb_typeof(c->'idTema') is distinct from 'string'
    or coalesce(c->>'idTema','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(c->'quantidade') is distinct from 'number' or coalesce(c->>'quantidade','') !~ '^[0-9]{1,3}$') then
    raise exception 'Informe temas válidos e quantidades inteiras entre 0 e 500';
  end if;
  if exists(select 1 from jsonb_to_recordset(p_cotas_temas) c("idTema" uuid,quantidade integer)
    where quantidade>500 or not exists(select 1 from public.temas t where t."idTema"=c."idTema")) then raise exception 'Tema ou quantidade inválidos na distribuição'; end if;
  if (select count(*)<>count(distinct "idTema") from jsonb_to_recordset(p_cotas_temas) c("idTema" uuid,quantidade integer)) then raise exception 'Há temas repetidos na distribuição'; end if;
  if (select coalesce(sum(quantidade),0)>p_quantidade from jsonb_to_recordset(p_cotas_temas) c("idTema" uuid,quantidade integer)) then raise exception 'A soma das quantidades por tema excede o total de questões'; end if;

  -- O mesmo acervo e os mesmos filtros se aplicam às cotas e ao complemento.
  select array_agg(x."idQuestao") into v_elegiveis from (
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
  v_disponiveis:=coalesce(cardinality(v_elegiveis),0);
  if v_disponiveis<p_quantidade then raise exception 'Há apenas % questões disponíveis para os critérios escolhidos',v_disponiveis; end if;

  for v_cota in select * from jsonb_to_recordset(p_cotas_temas) c("idTema" uuid,quantidade integer) loop
    select count(*) into v_disponiveis from public.questoes where "idQuestao"=any(v_elegiveis) and "idTema"=v_cota."idTema";
    if v_disponiveis<v_cota.quantidade then
      select nome into v_tema from public.temas where "idTema"=v_cota."idTema";
      raise exception 'O tema "%" possui apenas % questões disponíveis para os filtros escolhidos. Você solicitou %.',v_tema,v_disponiveis,v_cota.quantidade;
    end if;
    select array_agg("idQuestao") into v_sorteio from (
      select "idQuestao" from public.questoes where "idQuestao"=any(v_elegiveis) and "idTema"=v_cota."idTema" order by random() limit v_cota.quantidade
    ) s;
    v_ids:=v_ids||coalesce(v_sorteio,'{}'::uuid[]);
  end loop;
  v_restantes:=p_quantidade-cardinality(v_ids);
  -- Temas com cota exata (inclusive zero) não participam do complemento.
  select array_agg("idQuestao") into v_sorteio from (
    select q."idQuestao" from public.questoes q where q."idQuestao"=any(v_elegiveis)
      and not exists(select 1 from jsonb_to_recordset(p_cotas_temas) c("idTema" uuid,quantidade integer) where c."idTema"=q."idTema")
    order by random() limit v_restantes
  ) s;
  if coalesce(cardinality(v_sorteio),0)<v_restantes then
    raise exception 'A distribuição permite completar apenas % de % questões. Ajuste as quantidades por tema ou os filtros.',cardinality(v_ids)+coalesce(cardinality(v_sorteio),0),p_quantidade;
  end if;
  v_ids:=v_ids||coalesce(v_sorteio,'{}'::uuid[]);
  select array_agg(id) into v_ids from (select id from unnest(v_ids) ids(id) order by random()) s;
  insert into public.simulados(nome,tipo,publico,status,"idPessoaCriadora") values(btrim(p_nome),'personalizado',false,'publicado',v_pessoa) returning "idSimulado" into v_simulado;
  insert into public.simulado_questoes("idSimulado","idQuestao",ordem) select v_simulado,id,ordem::integer from unnest(v_ids) with ordinality ids(id,ordem);
  insert into public.tentativas_simulado("idSimulado","idPessoa") values(v_simulado,v_pessoa) returning "idTentativa" into v_tentativa;
  return v_tentativa;
end $$;

create function public.criar_simulado_filtrado(p_nome text,p_quantidade integer,p_idtema uuid default null,p_ano integer default null,p_orgao text default null,p_organizadora text default null,p_cargo text default null,p_cotas_temas jsonb default '[]') returns uuid
language sql security invoker set search_path='' as $$select provas_privado.criar_simulado_filtrado(p_nome,p_quantidade,p_idtema,p_ano,p_orgao,p_organizadora,p_cargo,p_cotas_temas)$$;
revoke all on function public.criar_simulado_filtrado(text,integer,uuid,integer,text,text,text,jsonb),provas_privado.criar_simulado_filtrado(text,integer,uuid,integer,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.criar_simulado_filtrado(text,integer,uuid,integer,text,text,text,jsonb),provas_privado.criar_simulado_filtrado(text,integer,uuid,integer,text,text,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
