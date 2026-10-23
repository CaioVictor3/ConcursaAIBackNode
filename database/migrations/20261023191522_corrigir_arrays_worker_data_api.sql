begin;
create or replace function comunicacao.operar_worker(p_operacao text,p_dados jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_registro record; v_rows jsonb:='[]'::jsonb; v_linhas integer:=0;
begin
 if jsonb_typeof(p_dados)<>'object' then raise exception 'Parâmetros inválidos'; end if;
 case p_operacao
when 'enfileirarEmailsUsuariosInativos' then
insert into comunicacao.emails_transacionais
              ("idEmailTransacional",tipo_evento,"idUsuario",email_destinatario,assunto,dados_template,maximo_tentativas,chave_idempotencia,agendado_em)
            select gen_random_uuid(),'USER_INACTIVE',u."idUsuario",u.email,'Continue seus estudos — ConcursaAI',
                   jsonb_build_object('nome',u.nome_completo,'dias',d.dias),(p_dados->>'maximo')::integer,
                   'USER_INACTIVE/'||u."idUsuario"::text||'/'||extract(epoch from coalesce(u.ultimo_acesso_em,u.criado_em))::bigint||'/'||d.dias,
                   now()
            from public.usuarios u
            join comunicacao.preferencias p on p."idUsuario"=u."idUsuario" and p.receber_inatividade
            cross join lateral (
              select max(dia) as dias from unnest(array(select x::integer from jsonb_array_elements_text(p_dados->'dias') x)::int[]) dia
              where coalesce(u.ultimo_acesso_em,u.criado_em)<=now()-make_interval(days=>dia)
            ) d
            where u.tipo='estudante' and u.estado_cadastro='ativo'
              and d.dias is not null
              and u.email<>''
              and not exists (
                select 1 from comunicacao.emails_transacionais existente
                where existente.chave_idempotencia='USER_INACTIVE/'||u."idUsuario"::text||'/'||
                  extract(epoch from coalesce(u.ultimo_acesso_em,u.criado_em))::bigint||'/'||d.dias
              )
            order by coalesce(u.ultimo_acesso_em,u.criado_em) desc, d.dias
            limit (p_dados->>'limite')::integer
            on conflict(chave_idempotencia) do nothing;
get diagnostics v_linhas=row_count;
when 'encerrarReservasExpiradas' then
update comunicacao.emails_transacionais
            set status='falha',mensagem_erro='maximo_tentativas',link_protegido=null,identificador_processamento=null,expiracao_reserva_em=null
            where status='processando' and expiracao_reserva_em<now() and quantidade_tentativas>=maximo_tentativas;
get diagnostics v_linhas=row_count;
when 'reservarLoteEmailsPendentes' then
for v_registro in with reservados as (
              select "idEmailTransacional" from comunicacao.emails_transacionais
              where tipo_evento=any(array(select x from jsonb_array_elements_text(p_dados->'tipos') x)) and ((status='pendente' and agendado_em<=now() and (proxima_tentativa_em is null or proxima_tentativa_em<=now()))
                 or (status='processando' and expiracao_reserva_em<now()))
                and quantidade_tentativas<maximo_tentativas
              order by coalesce(proxima_tentativa_em,agendado_em),criado_em
              for update skip locked limit (p_dados->>'limite')::integer
            )
            update comunicacao.emails_transacionais e
            set status='processando',quantidade_tentativas=e.quantidade_tentativas+1,
                ultima_tentativa_em=now(),identificador_processamento=(p_dados->>'reserva')::uuid,
                expiracao_reserva_em=now()+make_interval(secs=>(p_dados->>'segundos')::integer)
            from reservados r where e."idEmailTransacional"=r."idEmailTransacional"
            returning e."idEmailTransacional",e.tipo_evento,e."idUsuario",e.email_destinatario,e.assunto,
                      e.dados_template::text,e.link_protegido,e.validade_link_em,e.quantidade_tentativas,
                      e.maximo_tentativas,e.chave_idempotencia,e.identificador_processamento loop v_rows:=v_rows||jsonb_build_array(to_jsonb(v_registro)); end loop;
v_linhas:=jsonb_array_length(v_rows);
when 'consultarReservaEmail' then
for v_registro in select exists(select 1 from comunicacao.emails_transacionais where "idEmailTransacional"=(p_dados->>'id')::uuid and status='processando' and identificador_processamento=(p_dados->>'reserva')::uuid and expiracao_reserva_em>now()) loop v_rows:=v_rows||jsonb_build_array(to_jsonb(v_registro)); end loop;
v_linhas:=jsonb_array_length(v_rows);
when 'consultarPreferenciaInatividade' then
for v_registro in select exists(
                  select 1 from comunicacao.emails_transacionais e
                  join comunicacao.preferencias p on p."idUsuario"=e."idUsuario" and p.receber_inatividade
                  join public.usuarios u on u."idUsuario"=e."idUsuario"
                  where e."idEmailTransacional"=(p_dados->>'email')::uuid and e."idUsuario"=(p_dados->>'id')::uuid
                    and u.estado_cadastro='ativo' and u.email=e.email_destinatario
                    and coalesce(u.ultimo_acesso_em,u.criado_em)<=now()-
                      make_interval(days=>(e.dados_template->>'dias')::int)
                ) loop v_rows:=v_rows||jsonb_build_array(to_jsonb(v_registro)); end loop;
v_linhas:=jsonb_array_length(v_rows);
when 'validarElegibilidadeEnvioEmail' then
for v_registro in select exists(select 1 from identidade.tokens_email where token_hash=(p_dados->>'hash')::text and "idUsuario"=(p_dados->>'id')::uuid and finalidade=(p_dados->>'finalidade')::text and usado_em is null and expira_em>now()) loop v_rows:=v_rows||jsonb_build_array(to_jsonb(v_registro)); end loop;
v_linhas:=jsonb_array_length(v_rows);
when 'marcarEmailAceitoProvedor' then
update comunicacao.emails_transacionais set status='aceito',enviado_em=now(),id_mensagem_provedor=(p_dados->>'provedor')::text,link_protegido=null,identificador_processamento=null,expiracao_reserva_em=null,mensagem_erro=null where "idEmailTransacional"=(p_dados->>'id')::uuid and identificador_processamento=(p_dados->>'reserva')::uuid and status='processando';
get diagnostics v_linhas=row_count;
when 'marcarFalhaProcessamentoEmail' then
update comunicacao.emails_transacionais set status=(p_dados->>'status')::text,proxima_tentativa_em=(p_dados->>'proxima')::timestamptz,mensagem_erro=(p_dados->>'erro')::text,link_protegido=case when (p_dados->>'definitiva')::boolean then null else link_protegido end,identificador_processamento=null,expiracao_reserva_em=null where "idEmailTransacional"=(p_dados->>'id')::uuid and identificador_processamento=(p_dados->>'reserva')::uuid and status='processando';
get diagnostics v_linhas=row_count;
when 'cancelarEmailTransacional' then
update comunicacao.emails_transacionais set status='cancelado',mensagem_erro=(p_dados->>'motivo')::text,link_protegido=null,identificador_processamento=null,expiracao_reserva_em=null where "idEmailTransacional"=(p_dados->>'id')::uuid and identificador_processamento=(p_dados->>'reserva')::uuid and status='processando';
get diagnostics v_linhas=row_count;
when 'devolverEmailAguardandoAtivacao' then
update comunicacao.emails_transacionais
            set status='pendente',quantidade_tentativas=greatest(0,quantidade_tentativas-1),
                identificador_processamento=null,expiracao_reserva_em=null
            where "idEmailTransacional"=(p_dados->>'id')::uuid and identificador_processamento=(p_dados->>'reserva')::uuid and status='processando';
get diagnostics v_linhas=row_count;
when 'registrarEventoProvedorEmail' then
insert into comunicacao.eventos_resend(id_evento_webhook,id_mensagem_provedor,tipo_evento) values((p_dados->>'webhook')::text,(p_dados->>'id')::text,(p_dados->>'evento')::text) on conflict(id_evento_webhook) do nothing;
get diagnostics v_linhas=row_count;
when 'aplicarEventosRecebidosEmail' then
update comunicacao.emails_transacionais e
            set status=case
                  when exists(select 1 from comunicacao.eventos_resend r where r.id_mensagem_provedor=(p_dados->>'id')::text and r.tipo_evento in ('email.bounced','email.complained','email.failed')) then 'bounce'
                  when exists(select 1 from comunicacao.eventos_resend r where r.id_mensagem_provedor=(p_dados->>'id')::text and r.tipo_evento='email.delivered') then 'entregue'
                  else e.status end,
                entregue_em=case when exists(select 1 from comunicacao.eventos_resend r where r.id_mensagem_provedor=(p_dados->>'id')::text and r.tipo_evento='email.delivered') then coalesce(e.entregue_em,now()) else e.entregue_em end
            where e.id_mensagem_provedor=(p_dados->>'id')::text and e.status in ('aceito','entregue','bounce');
get diagnostics v_linhas=row_count;
when 'limparHistoricoEmailsAntigos' then
with antigos as (
              select "idEmailTransacional" from comunicacao.emails_transacionais
              where criado_em<now()-make_interval(days=>(p_dados->>'dias')::integer)
                and status in ('aceito','entregue','falha','bounce','cancelado')
              order by criado_em limit 500
            )
            delete from comunicacao.emails_transacionais e using antigos a
            where e."idEmailTransacional"=a."idEmailTransacional";
get diagnostics v_linhas=row_count;
when 'limparEventosEmailAntigos' then
with antigos as (
              select id_evento_webhook from comunicacao.eventos_resend
              where recebido_em<now()-make_interval(days=>(p_dados->>'dias')::integer)
              order by recebido_em limit 500
            )
            delete from comunicacao.eventos_resend e using antigos a
            where e.id_evento_webhook=a.id_evento_webhook;
get diagnostics v_linhas=row_count;
when 'reprocessarEmailFalho' then
update comunicacao.emails_transacionais
            set status='pendente',quantidade_tentativas=0,proxima_tentativa_em=null,mensagem_erro=null,
                identificador_processamento=null,expiracao_reserva_em=null
            where "idEmailTransacional"=(p_dados->>'id')::uuid and status='falha'
              and tipo_evento in ('WELCOME_EMAIL','USER_INACTIVE')
              and id_mensagem_provedor is null and mensagem_erro ~ '^resend_http_4[0-9]{2}$'
              and mensagem_erro not in ('resend_http_408','resend_http_429');
get diagnostics v_linhas=row_count;
when 'listarFluxos' then
 for v_registro in select tipo_evento,habilitado,atualizado_em from comunicacao.workflows loop v_rows:=v_rows||jsonb_build_array(to_jsonb(v_registro)); end loop;
 v_linhas:=jsonb_array_length(v_rows);
when 'confirmarEnvio' then
 update comunicacao.emails_transacionais set status='aceito',enviado_em=now(),id_mensagem_provedor=(p_dados->>'provedor')::text,link_protegido=null,identificador_processamento=null,expiracao_reserva_em=null,mensagem_erro=null where "idEmailTransacional"=(p_dados->>'id')::uuid and identificador_processamento=(p_dados->>'reserva')::uuid and status='processando';
 get diagnostics v_linhas=row_count;
 if v_linhas=1 then
 update comunicacao.emails_transacionais e
            set status=case
                  when exists(select 1 from comunicacao.eventos_resend r where r.id_mensagem_provedor=(p_dados->>'provedor')::text and r.tipo_evento in ('email.bounced','email.complained','email.failed')) then 'bounce'
                  when exists(select 1 from comunicacao.eventos_resend r where r.id_mensagem_provedor=(p_dados->>'provedor')::text and r.tipo_evento='email.delivered') then 'entregue'
                  else e.status end,
                entregue_em=case when exists(select 1 from comunicacao.eventos_resend r where r.id_mensagem_provedor=(p_dados->>'provedor')::text and r.tipo_evento='email.delivered') then coalesce(e.entregue_em,now()) else e.entregue_em end
            where e.id_mensagem_provedor=(p_dados->>'provedor')::text and e.status in ('aceito','entregue','bounce');
 end if;
else raise exception 'Operação do worker não permitida' using errcode='42501';
end case;
return jsonb_build_object('rows',v_rows,'rowCount',v_linhas);
end $$;

notify pgrst,'reload schema';
commit;
