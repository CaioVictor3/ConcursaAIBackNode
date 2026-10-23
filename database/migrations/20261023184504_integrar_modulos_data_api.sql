begin;
grant usage on schema honra_privado to authenticated;
grant select on public.honra_titulos,public.honra_regras,public.honra_progresso,
 public.honra_movimentacoes,public.honra_questoes_pontuadas,public.honra_dias_estudo,
 public.honra_alteracoes_configuracao,public.anotacoes_pessoais_questoes,
 public.ia_consumo_analises,public.ia_perguntas_contextuais to authenticated;
do $$ declare v record; begin
 for v in select schemaname,tablename,policyname from pg_policies
 where schemaname='public' and tablename=any(array['honra_titulos','honra_regras','honra_progresso','honra_movimentacoes','honra_questoes_pontuadas','honra_dias_estudo','honra_alteracoes_configuracao','anotacoes_pessoais_questoes','ia_consumo_analises','ia_perguntas_contextuais'])
 loop execute format('alter policy %I on %I.%I to concursa_dados, authenticated',v.policyname,v.schemaname,v.tablename); end loop;
end $$;

create function public.consultar_indicadores_honra() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin if not exists(select 1 from public.usuarios where "idUsuario"=auth.uid() and tipo='estudante' and estado_cadastro='ativo' and cadastro_completo) then raise exception 'Cadastro de estudante necessário' using errcode='42501'; end if;
 return jsonb_build_object('titulos',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
  select id, nivel, nome, descricao, pontuacao_minima as "pontuacaoMinima",
    icone, cor, ativo, criado_em as "criadoEm", atualizado_em as "atualizadoEm"
  from public.honra_titulos order by nivel
) x),'indicadores',(select to_jsonb(x) from (select
            coalesce((select pontos_acumulados from public.honra_progresso where id_pessoa = auth.uid()), 0)::integer as "pontosAcumulados",
            coalesce((select sum(pontos) from public.honra_movimentacoes where id_pessoa = auth.uid()
              and criado_em >= date_trunc('week', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'), 0)::integer as "pontosSemana",
            coalesce((select sum(pontos) from public.honra_movimentacoes where id_pessoa = auth.uid()
              and criado_em >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'), 0)::integer as "pontosMes",
            coalesce((select dias_consecutivos from public.honra_dias_estudo where id_pessoa = auth.uid()
              and dia >= (now() at time zone 'America/Sao_Paulo')::date - 1
              order by dia desc limit 1), 0)::integer as "diasConsecutivos",
            (select count(*)::integer from public.honra_questoes_pontuadas where id_pessoa = auth.uid()) as "questoesIneditasPontuadas") x));
end $$;
create function public.consultar_painel_desempenho() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin if not exists(select 1 from public.usuarios where "idUsuario"=auth.uid() and tipo='estudante' and estado_cadastro='ativo' and cadastro_completo) then raise exception 'Cadastro de estudante necessário' using errcode='42501'; end if;
 return jsonb_build_object('indicadores',(select to_jsonb(x) from (with tentativas as (
            select t."idTentativa", t.status, t.total_acertos, t.total_erros,
              t.total_nao_respondidas, t.tempo_gasto_segundos, s.tipo as tipo_simulado
            from public.tentativas_simulado t
            join public.simulados s on s."idSimulado" = t."idSimulado"
            where t."idPessoa" = auth.uid()
          ), respostas as (
            select r."idQuestao" from public.respostas_simulado r
            join tentativas t on t."idTentativa" = r."idTentativa"
            where r."idAlternativaSelecionada" is not null
          )
          select
            (select count(*)::integer from respostas) as "totalRespostas",
            (select count(distinct "idQuestao")::integer from respostas) as "questoesUnicasResolvidas",
            coalesce(sum(total_acertos) filter(where status = 'finalizada'), 0)::integer as "acertosTentativas",
            coalesce(sum(total_erros) filter(where status = 'finalizada'), 0)::integer as "errosTentativas",
            coalesce(sum(total_nao_respondidas) filter(where status = 'finalizada'), 0)::integer as "respostasEmBrancoTentativas",
            count(*) filter(where status = 'finalizada' and tipo_simulado = 'prova')::integer as "provasConcluidas",
            count(*) filter(where status = 'finalizada' and tipo_simulado <> 'prova')::integer as "simuladosConcluidos",
            count(*) filter(where status = 'em_andamento')::integer as "atividadesEmAndamento",
            coalesce(round(sum(tempo_gasto_segundos) filter(where status = 'finalizada') / 60.0), 0)::integer as "tempoEstudoMinutos",
            coalesce((select pontos_acumulados from public.honra_progresso where id_pessoa = auth.uid()), 0)::integer as "pontosHonra"
          from tentativas) x),'desempenhoPorTema',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (select te."idTema", te.nome as "nomeTema",
            count(*)::integer as avaliadas,
            count(*) filter(where (item->>'acertou')::boolean)::integer as acertos,
            count(*) filter(where not (item->>'acertou')::boolean and item->>'idAlternativaSelecionada' is not null)::integer as erros,
            round(100 * count(*) filter(where (item->>'acertou')::boolean) / nullif(count(*), 0))::integer as "percentualAcertos"
          from public.tentativas_simulado t
          cross join lateral jsonb_array_elements(public.obter_resultado_tentativa(t."idTentativa")->'itens') item
          join public.questoes q on q."idQuestao" = (item->>'idQuestao')::uuid
          join public.temas te on te."idTema" = q."idTema"
          where t."idPessoa" = auth.uid() and t.status = 'finalizada'
            and not coalesce((item->>'anulada')::boolean, false)
            and not coalesce((item->>'semGabarito')::boolean, false)
          group by te."idTema", te.nome order by "percentualAcertos", avaliadas desc) x),'evolucaoDiaria',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (select (finalizada_em at time zone 'America/Sao_Paulo')::date::text as dia,
            count(*)::integer as "tentativasConcluidas",
            sum(total_acertos + total_erros)::integer as respostas,
            sum(total_acertos)::integer as acertos,
            round(100 * sum(total_acertos) / nullif(sum(total_acertos + total_erros), 0))::integer as "percentualAcertos"
          from public.tentativas_simulado
          where "idPessoa" = auth.uid() and status = 'finalizada'
            and finalizada_em >= now() - interval '30 days'
          group by (finalizada_em at time zone 'America/Sao_Paulo')::date
          order by dia) x));
end $$;
create function public.consultar_painel_administrativo_honra() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if not public.eh_administrador() then raise exception 'Acesso administrativo necessário' using errcode='42501'; end if;
 return jsonb_build_object('titulos',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
  select id, nivel, nome, descricao, pontuacao_minima as "pontuacaoMinima",
    icone, cor, ativo, criado_em as "criadoEm", atualizado_em as "atualizadoEm"
  from public.honra_titulos order by nivel
) x),'regras',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
  select codigo, descricao, pontos, minimo_questoes as "minimoQuestoes",
    minimo_questoes_ineditas as "minimoQuestoesIneditas",
    percentual_minimo_respostas as "percentualMinimoRespostas",
    limite_diario as "limiteDiario", ativo, atualizado_em as "atualizadoEm"
  from public.honra_regras order by codigo
) x),'indicadores',(select to_jsonb(x) from (select count(*)::integer as participantes,
            coalesce(sum(pontos_acumulados), 0)::integer as pontos from public.honra_progresso) x),'distribuicaoTitulos',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (select coalesce(t.nome, 'Iniciante') as titulo, count(*)::integer as estudantes
          from public.honra_progresso p left join lateral (
            select nome from public.honra_titulos where ativo and pontuacao_minima <= p.pontos_acumulados
            order by pontuacao_minima desc limit 1
          ) t on true group by t.nome order by estudantes desc) x),'pontosPorAtividade',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (select tipo_origem as atividade, sum(pontos)::integer as pontos
          from public.honra_movimentacoes group by tipo_origem order by pontos desc) x),'evolucaoParticipacao',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (with dias as (
            select generate_series(
              (now() at time zone 'America/Sao_Paulo')::date - 29,
              (now() at time zone 'America/Sao_Paulo')::date,
              interval '1 day'
            )::date as dia
          ), participacao as (
            select id_pessoa,
              (criado_em at time zone 'America/Sao_Paulo')::date as dia
            from public.honra_movimentacoes
          ), primeira_participacao as (
            select id_pessoa, min(dia) as dia from participacao group by id_pessoa
          )
          select dias.dia::text as dia,
            count(distinct participacao.id_pessoa)::integer as "estudantesAtivos",
            count(distinct primeira_participacao.id_pessoa)::integer as "novosParticipantes"
          from dias
          left join participacao on participacao.dia = dias.dia
          left join primeira_participacao on primeira_participacao.dia = dias.dia
          group by dias.dia order by dias.dia) x),'movimentacoesRecentes',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
  select id::integer, id_pessoa as "idPessoa", codigo_regra as "codigoRegra",
    tipo_origem as "tipoOrigem", id_origem as "idOrigem", pontos, descricao,
    justificativa, criado_em as "criadoEm"
  from public.honra_movimentacoes
 order by criado_em desc, id desc limit 20) x));
end $$;
create function public.consultar_historico_honra(p_idpessoa uuid,p_pagina integer,p_quantidade integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null or (p_idpessoa<>auth.uid() and not public.eh_administrador()) then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
 if p_pagina is null or p_pagina not between 1 and 100000 or p_quantidade is null or p_quantidade not between 1 and 50 then raise exception 'Paginação inválida'; end if;
 return jsonb_build_object('itens',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
  select id::integer, id_pessoa as "idPessoa", codigo_regra as "codigoRegra",
    tipo_origem as "tipoOrigem", id_origem as "idOrigem", pontos, descricao,
    justificativa, criado_em as "criadoEm"
  from public.honra_movimentacoes
 where id_pessoa = p_idpessoa order by criado_em desc, id desc limit p_quantidade offset ((p_pagina-1)*p_quantidade)) x),'total',(select count(*) from public.honra_movimentacoes where id_pessoa=p_idpessoa),'pagina',p_pagina,'quantidadePorPagina',p_quantidade);
end $$;

create function public.salvar_titulo_honra(p_dados jsonb) returns uuid language sql security invoker set search_path='' as $$ select honra_privado.salvar_titulo(p_dados) $$;
create function public.salvar_regra_honra(p_codigo text,p_dados jsonb) returns void language sql security invoker set search_path='' as $$ select honra_privado.salvar_regra(p_codigo,p_dados) $$;
create function public.ajustar_pontos_honra(p_idpessoa uuid,p_pontos integer,p_justificativa text) returns void language sql security invoker set search_path='' as $$ select honra_privado.ajustar_saldo(p_idpessoa,p_pontos,p_justificativa) $$;
create function public.salvar_anotacao_pessoal(p_idquestao uuid,p_conteudo text) returns void language sql security invoker set search_path='' as $$ select honra_privado.salvar_anotacao(p_idquestao,p_conteudo) $$;
grant execute on function honra_privado.salvar_titulo(jsonb),honra_privado.salvar_regra(text,jsonb),honra_privado.ajustar_saldo(uuid,integer,text),honra_privado.salvar_anotacao(uuid,text) to authenticated;

do $$ declare v record; begin
 for v in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname=any(array['consultar_indicadores_honra','consultar_painel_desempenho','consultar_painel_administrativo_honra','consultar_historico_honra','salvar_titulo_honra','salvar_regra_honra','ajustar_pontos_honra','salvar_anotacao_pessoal'])
 loop execute format('revoke all on function %s from public,anon',v.assinatura);
 execute format('grant execute on function %s to authenticated',v.assinatura); end loop;
end $$;

-- A tabela de outbox permanece privada. Esta função entrega somente os campos
-- públicos de administração e exige a identidade da sessão em cada operação.
create function comunicacao.operar_api(p_operacao text,p_dados jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_receber boolean; v_linhas integer;
 v_pagina integer; v_quantidade integer; v_resultado jsonb;
begin
 if v_uid is null or not exists(select 1 from public.usuarios where "idUsuario"=v_uid and estado_cadastro='ativo') then
  raise exception 'Autenticação necessária' using errcode='42501';
 end if;
 if p_operacao='obter_preferencia' then
  return to_jsonb(coalesce((select receber_inatividade from comunicacao.preferencias where "idUsuario"=v_uid),false));
 elsif p_operacao='salvar_preferencia' then
  v_receber:=(p_dados->>'receber')::boolean;
  if v_receber is null then raise exception 'Preferência inválida'; end if;
  insert into comunicacao.preferencias("idUsuario",receber_inatividade,atualizado_em)
  values(v_uid,v_receber,now()) on conflict("idUsuario") do update set receber_inatividade=excluded.receber_inatividade,atualizado_em=now();
  if not v_receber then update comunicacao.emails_transacionais set status='cancelado',identificador_processamento=null,expiracao_reserva_em=null
   where "idUsuario"=v_uid and tipo_evento='USER_INACTIVE' and status in ('pendente','processando'); end if;
  return 'true'::jsonb;
 end if;
 if not public.eh_administrador() then raise exception 'Acesso administrativo necessário' using errcode='42501'; end if;
 if p_operacao='fluxos' then
  return (select jsonb_agg(jsonb_build_object('tipoEvento',t.tipo,'habilitado',coalesce(w.habilitado,t.tipo<>'USER_INACTIVE'),'dataHoraAtualizacao',w.atualizado_em) order by t.ordem)
   from (values(1,'EMAIL_VERIFICATION'),(2,'WELCOME_EMAIL'),(3,'PASSWORD_RESET'),(4,'USER_INACTIVE')) t(ordem,tipo)
   left join comunicacao.workflows w on w.tipo_evento=t.tipo);
 elsif p_operacao='salvar_fluxo' then
  if p_dados->>'tipo' not in ('EMAIL_VERIFICATION','WELCOME_EMAIL','PASSWORD_RESET','USER_INACTIVE') or p_dados->>'habilitado' is null then raise exception 'Fluxo inválido'; end if;
  insert into comunicacao.workflows(tipo_evento,habilitado,atualizado_em)
  values(p_dados->>'tipo',(p_dados->>'habilitado')::boolean,now()) on conflict(tipo_evento) do update set habilitado=excluded.habilitado,atualizado_em=now();
  return (select jsonb_build_object('tipoEvento',tipo_evento,'habilitado',habilitado,'dataHoraAtualizacao',atualizado_em) from comunicacao.workflows where tipo_evento=p_dados->>'tipo');
 elsif p_operacao='metricas' then
  return (select jsonb_build_object('pendentes',count(*) filter(where status='pendente'),'processando',count(*) filter(where status='processando'),'aceitos',count(*) filter(where status='aceito'),'entregues',count(*) filter(where status='entregue'),'falhas',count(*) filter(where status='falha'),'bounces',count(*) filter(where status='bounce')) from comunicacao.emails_transacionais);
 elsif p_operacao='historico' then
  v_pagina:=coalesce((p_dados->>'pagina')::integer,1); v_quantidade:=coalesce((p_dados->>'quantidade')::integer,20);
  if v_pagina not between 1 and 100000 or v_quantidade not between 1 and 100 then raise exception 'Paginação inválida'; end if;
  with filtrados as (
   select * from comunicacao.emails_transacionais
   where ((p_dados->>'idUsuario') is null or "idUsuario"=(p_dados->>'idUsuario')::uuid)
    and ((p_dados->>'tipoEvento') is null or tipo_evento=p_dados->>'tipoEvento')
    and ((p_dados->>'status') is null or status=p_dados->>'status')
    and ((p_dados->>'de') is null or criado_em>=(p_dados->>'de')::timestamptz)
    and ((p_dados->>'ate') is null or criado_em<=(p_dados->>'ate')::timestamptz)
  ), pagina as (
   select "idEmailTransacional","idUsuario",tipo_evento as "tipoEvento",email_destinatario as "emailDestinatario",status,
   quantidade_tentativas as "quantidadeTentativas",maximo_tentativas as "maximoTentativas",
   criado_em as "dataHoraCriacao",enviado_em as "dataHoraEnvio",entregue_em as "dataHoraEntrega",mensagem_erro as "codigoErro"
   from filtrados order by criado_em desc,"idEmailTransacional" desc limit v_quantidade offset (v_pagina-1)*v_quantidade
  ) select jsonb_build_object('itens',coalesce((select jsonb_agg(to_jsonb(p)) from pagina p),'[]'::jsonb),'total',(select count(*) from filtrados),'pagina',v_pagina) into v_resultado;
  return v_resultado;
 elsif p_operacao='reprocessar' then
  update comunicacao.emails_transacionais set status='pendente',quantidade_tentativas=0,proxima_tentativa_em=null,mensagem_erro=null,identificador_processamento=null,expiracao_reserva_em=null
  where "idEmailTransacional"=(p_dados->>'id')::uuid and status='falha' and tipo_evento in ('WELCOME_EMAIL','USER_INACTIVE')
  and id_mensagem_provedor is null and mensagem_erro ~ '^resend_http_4[0-9]{2}$' and mensagem_erro not in ('resend_http_408','resend_http_429');
  get diagnostics v_linhas=row_count;
  return to_jsonb(v_linhas=1);
 end if;
 raise exception 'Operação inválida';
end $$;
create function public.operar_comunicacao(p_operacao text,p_dados jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select comunicacao.operar_api(p_operacao,p_dados) $$;
revoke all on function comunicacao.operar_api(text,jsonb),public.operar_comunicacao(text,jsonb) from public,anon;
grant usage on schema comunicacao to authenticated;
grant execute on function comunicacao.operar_api(text,jsonb),public.operar_comunicacao(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
