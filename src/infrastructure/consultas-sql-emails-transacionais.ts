// SQL transacional preservado da implementação .NET. Os nomes indicam a operação executada.
export const consultasSqlEmailsTransacionais = {
  enfileirarEmailsUsuariosInativos: `insert into comunicacao.emails_transacionais
              ("idEmailTransacional",tipo_evento,"idUsuario",email_destinatario,assunto,dados_template,maximo_tentativas,chave_idempotencia,agendado_em)
            select gen_random_uuid(),'USER_INACTIVE',u."idUsuario",u.email,'Continue seus estudos — ConcursaAI',
                   jsonb_build_object('nome',u.nome_completo,'dias',d.dias),@maximo,
                   'USER_INACTIVE/'||u."idUsuario"::text||'/'||extract(epoch from coalesce(u.ultimo_acesso_em,u.criado_em))::bigint||'/'||d.dias,
                   now()
            from public.usuarios u
            join comunicacao.preferencias p on p."idUsuario"=u."idUsuario" and p.receber_inatividade
            cross join lateral (
              select max(dia) as dias from unnest(@dias::int[]) dia
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
            limit @limite
            on conflict(chave_idempotencia) do nothing`,
  encerrarReservasExpiradas: `update comunicacao.emails_transacionais
            set status='falha',mensagem_erro='maximo_tentativas',link_protegido=null,identificador_processamento=null,expiracao_reserva_em=null
            where status='processando' and expiracao_reserva_em<now() and quantidade_tentativas>=maximo_tentativas`,
  reservarLoteEmailsPendentes: `with reservados as (
              select "idEmailTransacional" from comunicacao.emails_transacionais
              where tipo_evento=any(@tipos) and ((status='pendente' and agendado_em<=now() and (proxima_tentativa_em is null or proxima_tentativa_em<=now()))
                 or (status='processando' and expiracao_reserva_em<now()))
                and quantidade_tentativas<maximo_tentativas
              order by coalesce(proxima_tentativa_em,agendado_em),criado_em
              for update skip locked limit @limite
            )
            update comunicacao.emails_transacionais e
            set status='processando',quantidade_tentativas=e.quantidade_tentativas+1,
                ultima_tentativa_em=now(),identificador_processamento=@reserva,
                expiracao_reserva_em=now()+make_interval(secs=>@segundos)
            from reservados r where e."idEmailTransacional"=r."idEmailTransacional"
            returning e."idEmailTransacional",e.tipo_evento,e."idUsuario",e.email_destinatario,e.assunto,
                      e.dados_template::text,e.link_protegido,e.validade_link_em,e.quantidade_tentativas,
                      e.maximo_tentativas,e.chave_idempotencia,e.identificador_processamento`,
  consultarReservaEmail: `select exists(select 1 from comunicacao.emails_transacionais where "idEmailTransacional"=@id and status='processando' and identificador_processamento=@reserva and expiracao_reserva_em>now())`,
  consultarPreferenciaInatividade: `select exists(
                  select 1 from comunicacao.emails_transacionais e
                  join comunicacao.preferencias p on p."idUsuario"=e."idUsuario" and p.receber_inatividade
                  join public.usuarios u on u."idUsuario"=e."idUsuario"
                  where e."idEmailTransacional"=@email and e."idUsuario"=@id
                    and u.estado_cadastro='ativo' and u.email=e.email_destinatario
                    and coalesce(u.ultimo_acesso_em,u.criado_em)<=now()-
                      make_interval(days=>(e.dados_template->>'dias')::int)
                )`,
  validarElegibilidadeEnvioEmail: `select exists(select 1 from identidade.tokens_email where token_hash=@hash and "idUsuario"=@id and finalidade=@finalidade and usado_em is null and expira_em>now())`,
  marcarEmailAceitoProvedor: `update comunicacao.emails_transacionais set status='aceito',enviado_em=now(),id_mensagem_provedor=@provedor,link_protegido=null,identificador_processamento=null,expiracao_reserva_em=null,mensagem_erro=null where "idEmailTransacional"=@id and identificador_processamento=@reserva and status='processando'`,
  marcarFalhaProcessamentoEmail: `update comunicacao.emails_transacionais set status=@status,proxima_tentativa_em=@proxima,mensagem_erro=@erro,link_protegido=case when @definitiva then null else link_protegido end,identificador_processamento=null,expiracao_reserva_em=null where "idEmailTransacional"=@id and identificador_processamento=@reserva and status='processando'`,
  cancelarEmailTransacional: `update comunicacao.emails_transacionais set status='cancelado',mensagem_erro=@motivo,link_protegido=null,identificador_processamento=null,expiracao_reserva_em=null where "idEmailTransacional"=@id and identificador_processamento=@reserva and status='processando'`,
  devolverEmailAguardandoAtivacao: `update comunicacao.emails_transacionais
            set status='pendente',quantidade_tentativas=greatest(0,quantidade_tentativas-1),
                identificador_processamento=null,expiracao_reserva_em=null
            where "idEmailTransacional"=@id and identificador_processamento=@reserva and status='processando'`,
  registrarEventoProvedorEmail: `insert into comunicacao.eventos_resend(id_evento_webhook,id_mensagem_provedor,tipo_evento) values(@webhook,@id,@evento) on conflict(id_evento_webhook) do nothing`,
  aplicarEventosRecebidosEmail: `update comunicacao.emails_transacionais e
            set status=case
                  when exists(select 1 from comunicacao.eventos_resend r where r.id_mensagem_provedor=@id and r.tipo_evento in ('email.bounced','email.complained','email.failed')) then 'bounce'
                  when exists(select 1 from comunicacao.eventos_resend r where r.id_mensagem_provedor=@id and r.tipo_evento='email.delivered') then 'entregue'
                  else e.status end,
                entregue_em=case when exists(select 1 from comunicacao.eventos_resend r where r.id_mensagem_provedor=@id and r.tipo_evento='email.delivered') then coalesce(e.entregue_em,now()) else e.entregue_em end
            where e.id_mensagem_provedor=@id and e.status in ('aceito','entregue','bounce')`,
  limparHistoricoEmailsAntigos: `with antigos as (
              select "idEmailTransacional" from comunicacao.emails_transacionais
              where criado_em<now()-make_interval(days=>@dias)
                and status in ('aceito','entregue','falha','bounce','cancelado')
              order by criado_em limit 500
            )
            delete from comunicacao.emails_transacionais e using antigos a
            where e."idEmailTransacional"=a."idEmailTransacional"`,
  limparEventosEmailAntigos: `with antigos as (
              select id_evento_webhook from comunicacao.eventos_resend
              where recebido_em<now()-make_interval(days=>@dias)
              order by recebido_em limit 500
            )
            delete from comunicacao.eventos_resend e using antigos a
            where e.id_evento_webhook=a.id_evento_webhook`,
  reprocessarEmailFalho: `update comunicacao.emails_transacionais
            set status='pendente',quantidade_tentativas=0,proxima_tentativa_em=null,mensagem_erro=null,
                identificador_processamento=null,expiracao_reserva_em=null
            where "idEmailTransacional"=@id and status='falha'
              and tipo_evento in ('WELCOME_EMAIL','USER_INACTIVE')
              and id_mensagem_provedor is null and mensagem_erro ~ '^resend_http_4[0-9]{2}$'
              and mensagem_erro not in ('resend_http_408','resend_http_429')`,
} as const;

export type NomeConsultaEmailTransacional = keyof typeof consultasSqlEmailsTransacionais;
