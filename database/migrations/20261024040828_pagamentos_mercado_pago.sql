begin;
create schema financeiro;
revoke all on schema financeiro from public,anon,authenticated,concursa_dados;

create table financeiro.configuracao (
 id boolean primary key default true check(id), ambiente text not null check(ambiente in ('teste','producao'))
);
insert into financeiro.configuracao(id,ambiente) values(true,'teste') on conflict do nothing;
alter table financeiro.configuracao enable row level security;
revoke all on financeiro.configuracao from public,anon,authenticated,concursa_dados;

create table public.planos_comerciais (
 id uuid primary key default gen_random_uuid(), codigo text not null unique,
 nome text not null check(length(nome) between 2 and 100), descricao text not null default '',
 valor numeric(12,2) not null check(valor>0), moeda text not null default 'BRL' check(moeda='BRL'),
 duracao_meses integer not null check(duracao_meses between 1 and 120),
 beneficios jsonb not null check(jsonb_typeof(beneficios)='array'),
 ordem integer not null default 0, ativo boolean not null default true, destaque boolean not null default false,
 criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
insert into public.planos_comerciais(codigo,nome,valor,duracao_meses,ordem,destaque,beneficios)
select codigo,nome,valor,meses,ordem,destaque,
 '["Banco completo de questões","Provas anteriores","Simulados personalizados","Correção e explicações por IA","Anotações por questão","Dashboard e métricas de estudo","Sistema de Honra","Histórico de provas e simulados"]'::jsonb
from (values ('mensal','Mensal',19.90,1,1,false),('semestral','Semestral',101.40,6,2,false),('anual','Anual',166.80,12,3,true)) v(codigo,nome,valor,meses,ordem,destaque)
on conflict(codigo) do nothing;

create table public.pedidos_pagamento (
 id uuid primary key default gen_random_uuid(), id_pessoa uuid not null references public.pessoas("idPessoa") on delete restrict,
 id_plano uuid not null references public.planos_comerciais(id) on delete restrict,
 plano_nome text not null, duracao_meses integer not null check(duracao_meses between 1 and 120), beneficios jsonb not null,
 valor numeric(12,2) not null check(valor>0), moeda text not null check(moeda='BRL'),
 status text not null default 'pendente' check(status in ('pendente','processando','aprovado','rejeitado','cancelado','estornado','contestado')),
 ambiente text not null check(ambiente in ('teste','producao')),
 chave_idempotencia uuid not null unique, referencia_externa text not null unique,
 id_order_mp text unique, checkout_url text, checkout_payload jsonb,
 criado_em timestamptz not null default now(), expira_em timestamptz not null default now()+interval '1 day',
 atualizado_em timestamptz not null default now(), consultado_em timestamptz,
 reserva_ate timestamptz, reserva uuid, ultima_versao_mp timestamptz,
 webhook_confirmado boolean not null default false
);
create index pedidos_pessoa_data_idx on public.pedidos_pagamento(id_pessoa,criado_em desc);
create index pedidos_plano_idx on public.pedidos_pagamento(id_plano);
create index pedidos_conciliacao_idx on public.pedidos_pagamento(consultado_em nulls first,criado_em) where id_order_mp is not null;
create unique index pedidos_abertos_idx on public.pedidos_pagamento(id_pessoa,id_plano,ambiente) where status in ('pendente','processando');

create table public.pagamentos (
 id uuid primary key default gen_random_uuid(), id_pedido uuid not null unique references public.pedidos_pagamento(id) on delete restrict,
 id_pessoa uuid not null references public.pessoas("idPessoa") on delete restrict,
 id_plano uuid not null references public.planos_comerciais(id), id_order_mp text not null unique,
 id_pagamento_mp text, referencia_pagamento_mp text,
 valor numeric(12,2) not null, moeda text not null check(moeda='BRL'), status text not null,
 metodo text, parcelas integer, valor_estornado numeric(12,2) not null default 0,
 aprovado_em timestamptz, criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
 detalhe_status text
);
create index pagamentos_pessoa_data_idx on public.pagamentos(id_pessoa,criado_em desc);
create index pagamentos_plano_idx on public.pagamentos(id_plano);
create unique index pagamentos_mp_idx on public.pagamentos(id_pagamento_mp) where id_pagamento_mp is not null;

-- Each paid purchase owns its own immutable calendar period. Reversals cannot remove another purchase's rights.
create table public.assinaturas (
 id uuid primary key default gen_random_uuid(), id_pessoa uuid not null references public.pessoas("idPessoa") on delete restrict,
 id_pedido uuid not null unique references public.pedidos_pagamento(id), id_pagamento uuid unique references public.pagamentos(id),
 id_plano uuid not null references public.planos_comerciais(id), plano_nome text not null,
 valor numeric(12,2) not null, duracao_meses integer not null, beneficios jsonb not null,
 status text not null default 'pendente' check(status in ('pendente','ativa','expirada','cancelada','suspensa')),
 inicio_em timestamptz, fim_em timestamptz, cancelamento_em timestamptz,
 criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
 check((inicio_em is null and fim_em is null) or fim_em>inicio_em)
);
create index assinaturas_pessoa_vigencia_idx on public.assinaturas(id_pessoa,inicio_em,fim_em) where status='ativa';
create index assinaturas_vencimento_idx on public.assinaturas(fim_em) where status='ativa';
create index assinaturas_plano_idx on public.assinaturas(id_plano);
create table public.historico_assinaturas (
 id bigint generated always as identity primary key, id_pessoa uuid not null references public.pessoas("idPessoa"),
 id_assinatura uuid references public.assinaturas(id), tipo text not null, dados jsonb not null default '{}',
 id_administrador uuid references public.usuarios("idUsuario"), chave text unique, criado_em timestamptz not null default now()
);
create index historico_assinaturas_pessoa_idx on public.historico_assinaturas(id_pessoa,criado_em desc);
create index historico_assinaturas_assinatura_idx on public.historico_assinaturas(id_assinatura);
create index historico_assinaturas_admin_idx on public.historico_assinaturas(id_administrador);
create table financeiro.webhooks (
 chave text primary key, recurso text not null, tipo text not null default 'order', recebido_em timestamptz not null default now(),
 status text not null default 'pendente' check(status in ('pendente','processando','processado','falha')),
 tentativas integer not null default 0, proxima_tentativa_em timestamptz not null default now(),
 reserva uuid, reserva_ate timestamptz, processado_em timestamptz, erro text
);
create index webhooks_fila_idx on financeiro.webhooks(proxima_tentativa_em) where status in ('pendente','processando');
create table financeiro.auditoria (
 id bigint generated always as identity primary key, id_administrador uuid references public.usuarios("idUsuario"),
 acao text not null, recurso text not null, dados jsonb not null default '{}', criado_em timestamptz not null default now()
);
create table public.avisos_assinatura (
 id uuid primary key default gen_random_uuid(), id_pessoa uuid not null references public.pessoas("idPessoa"),
 id_assinatura uuid not null references public.assinaturas(id), dias integer not null, fim_em timestamptz not null,
 mensagem text not null, criado_em timestamptz not null default now(), unique(id_assinatura,dias,fim_em)
);
create index avisos_pessoa_idx on public.avisos_assinatura(id_pessoa,criado_em desc);

create table financeiro.limites_requisicoes (
 chave text not null, minuto timestamptz not null, quantidade integer not null,
 primary key(chave,minuto)
);
alter table financeiro.limites_requisicoes enable row level security;
revoke all on financeiro.limites_requisicoes from public,anon,authenticated,concursa_dados;

create function financeiro.tem_premium(p_pessoa uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.assinaturas a join public.pagamentos p on p.id=a.id_pagamento join public.usuarios u on u."idUsuario"=a.id_pessoa and u.estado_cadastro='ativo'
 where exists(select 1 from public.pedidos_pagamento o,financeiro.configuracao c where o.id=a.id_pedido and o.ambiente=c.ambiente) and a.id_pessoa=p_pessoa and a.status='ativa' and a.inicio_em<=now() and a.fim_em>now() and p.status='aprovado')
$$;
create function public.tem_acesso_premium() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (public.eh_administrador() or financeiro.tem_premium(auth.uid()))
$$;
create function public.exigir_acesso_premium() returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.tem_acesso_premium() then raise exception 'É necessário um plano Premium vigente.' using errcode='42501'; end if;
end $$;
revoke all on function financeiro.tem_premium(uuid),public.tem_acesso_premium(),public.exigir_acesso_premium() from public,anon,authenticated;
grant execute on function public.tem_acesso_premium(),public.exigir_acesso_premium() to authenticated,concursa_dados,concursa_backend;

-- Public catalogue; all financial writes and internal inboxes are server-only.
do $$ declare t text; begin
 foreach t in array array['planos_comerciais','pedidos_pagamento','pagamentos','assinaturas','historico_assinaturas','avisos_assinatura'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,concursa_dados',t);
  execute format('grant select on public.%I to authenticated',t);
  if t='planos_comerciais' then
   execute 'grant select on public.planos_comerciais to anon';
   execute 'create policy planos_catalogo_publico on public.planos_comerciais for select to anon using (ativo)';
   execute 'create policy planos_catalogo on public.planos_comerciais for select to authenticated using (ativo or (select public.eh_administrador()))';
  else
   execute format('create policy financeiro_proprietario on public.%I for select to authenticated using (id_pessoa=(select auth.uid()) or (select public.eh_administrador()))',t);
  end if;
 end loop;
end $$;
alter table financeiro.webhooks enable row level security;
alter table financeiro.auditoria enable row level security;
revoke all on all tables in schema financeiro from public,anon,authenticated,concursa_dados;

create function financeiro.json_pedido(p public.pedidos_pagamento) returns jsonb language sql immutable set search_path='' as $$
 select (to_jsonb(p)-'checkout_payload'-'reserva'-'reserva_ate')||jsonb_build_object('valor',p.valor::text)
$$;

create function financeiro.operar_backend(p_operacao text,p_dados jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_pessoa uuid; v_admin uuid; v_pedido public.pedidos_pagamento; v_plano public.planos_comerciais;
 v_ass public.assinaturas; v_pag public.pagamentos; v_json jsonb; v_inicio timestamptz; v_fim timestamptz;
 v_status text; v_reserva uuid; v_versao timestamptz; v_count integer; v_row record; v_dias integer;
begin
 v_pessoa:=nullif(p_dados->>'pessoa','')::uuid;
 v_admin:=nullif(p_dados->>'administrador','')::uuid;
 if v_admin is not null and not exists(select 1 from public.usuarios where "idUsuario"=v_admin and tipo='administrador' and estado_cadastro='ativo') then
  raise exception 'Administrador indisponível' using errcode='42501';
 end if;
 case p_operacao
 when 'limitar_requisicao' then
  insert into financeiro.limites_requisicoes(chave,minuto,quantidade) values(p_dados->>'chave',date_trunc('minute',now()),1)
   on conflict(chave,minuto) do update set quantidade=limites_requisicoes.quantidade+1 returning quantidade into v_count;
  if v_count>least((p_dados->>'limite')::integer,30) then raise exception 'Muitas solicitações financeiras. Aguarde um minuto.' using errcode='P0429'; end if;
  return 'true'::jsonb;
 when 'criar_pedido' then
  if p_dados->>'ambiente'<>(select ambiente from financeiro.configuracao) then raise exception 'Ambiente financeiro do banco e da API não correspondem'; end if;
  if not exists(select 1 from public.usuarios where "idUsuario"=v_pessoa and tipo='estudante' and estado_cadastro='ativo' and cadastro_completo) then raise exception 'Cadastro de estudante incompleto' using errcode='42501'; end if;
  -- Lock the existing identity row to serialize all checkouts and renewals for one student.
  perform 1 from public.pessoas where "idPessoa"=v_pessoa for update;
  select * into v_pedido from public.pedidos_pagamento where chave_idempotencia=(p_dados->>'chave')::uuid;
  if found then
   if v_pedido.id_pessoa<>v_pessoa or v_pedido.id_plano<>(p_dados->>'plano')::uuid or v_pedido.ambiente<>p_dados->>'ambiente' then raise exception 'Chave de idempotência já utilizada'; end if;
   return financeiro.json_pedido(v_pedido);
  end if;
  select * into v_pedido from public.pedidos_pagamento where id_pessoa=v_pessoa and id_plano=(p_dados->>'plano')::uuid and ambiente=p_dados->>'ambiente' and status in ('pendente','processando');
  if found then return financeiro.json_pedido(v_pedido); end if;
  select * into v_plano from public.planos_comerciais where id=(p_dados->>'plano')::uuid and ativo for share;
  if not found then raise exception 'Plano indisponível'; end if;
  insert into public.pedidos_pagamento(id_pessoa,id_plano,plano_nome,duracao_meses,beneficios,valor,moeda,ambiente,chave_idempotencia,referencia_externa)
  values(v_pessoa,v_plano.id,v_plano.nome,v_plano.duracao_meses,v_plano.beneficios,v_plano.valor,v_plano.moeda,p_dados->>'ambiente',(p_dados->>'chave')::uuid,gen_random_uuid()::text) returning * into v_pedido;
  insert into public.assinaturas(id_pessoa,id_pedido,id_plano,plano_nome,valor,duracao_meses,beneficios) values(v_pessoa,v_pedido.id,v_plano.id,v_plano.nome,v_plano.valor,v_plano.duracao_meses,v_plano.beneficios) returning * into v_ass;
  insert into public.historico_assinaturas(id_pessoa,id_assinatura,tipo,chave) values(v_pessoa,v_ass.id,'assinatura_criada',v_pedido.id::text||':criada');
  return financeiro.json_pedido(v_pedido);
 when 'pedido' then
  select * into v_pedido from public.pedidos_pagamento where id=(p_dados->>'id')::uuid;
  if not found then raise exception 'Pedido não encontrado'; end if;
  return financeiro.json_pedido(v_pedido);
 when 'pedido_order' then
  select * into v_pedido from public.pedidos_pagamento where id_order_mp=p_dados->>'order';
  if not found then return null; end if;
  return financeiro.json_pedido(v_pedido);
 when 'reservar_checkout' then
  v_reserva:=gen_random_uuid();
  update public.pedidos_pagamento set reserva=v_reserva,reserva_ate=now()+interval '45 seconds',
   checkout_payload=coalesce(checkout_payload,p_dados->'payload')
   where id=(p_dados->>'id')::uuid and id_order_mp is null and (reserva_ate is null or reserva_ate<now()) returning * into v_pedido;
  if not found then return null; end if;
  return jsonb_build_object('reserva',v_reserva,'payload',v_pedido.checkout_payload);
 when 'salvar_checkout' then
  update public.pedidos_pagamento set id_order_mp=p_dados->>'order',checkout_url=p_dados->>'url',reserva=null,reserva_ate=null,atualizado_em=now()
   where id=(p_dados->>'id')::uuid and reserva=(p_dados->>'reserva')::uuid and (id_order_mp is null or id_order_mp=p_dados->>'order') returning * into v_pedido;
  if not found then raise exception 'Reserva do checkout indisponível'; end if;
  return financeiro.json_pedido(v_pedido);
 when 'liberar_checkout' then
  update public.pedidos_pagamento set reserva=null,reserva_ate=null where id=(p_dados->>'id')::uuid and reserva=(p_dados->>'reserva')::uuid;
  return 'true'::jsonb;
 when 'receber_webhook' then
  insert into financeiro.webhooks(chave,recurso) values(p_dados->>'chave',p_dados->>'order') on conflict do nothing;
  return 'true'::jsonb;
 when 'reservar_eventos' then
  with fila as (
   select chave from financeiro.webhooks where tentativas<12 and proxima_tentativa_em<=now()
   and (status='pendente' or (status='processando' and reserva_ate<now())) order by proxima_tentativa_em for update skip locked limit least(coalesce((p_dados->>'limite')::integer,10),50)
  ), reservados as (update financeiro.webhooks w set status='processando',tentativas=tentativas+1,reserva=gen_random_uuid(),reserva_ate=now()+interval '90 seconds' from fila where w.chave=fila.chave returning w.*) select coalesce(jsonb_agg(to_jsonb(reservados)),'[]'::jsonb) into v_json from reservados;
  return v_json;
 when 'concluir_evento' then
  update financeiro.webhooks set status=case when p_dados->>'erro' is null then 'processado' when tentativas>=12 then 'falha' else 'pendente' end,
   processado_em=case when p_dados->>'erro' is null then now() end, erro=p_dados->>'erro',reserva=null,reserva_ate=null,
   proxima_tentativa_em=now()+make_interval(secs=>least(3600,30*power(2,least(tentativas,7))::integer))
   where chave=p_dados->>'chave' and reserva=(p_dados->>'reserva')::uuid;
  return 'true'::jsonb;
 when 'aplicar_order' then
  select id_pessoa into v_pessoa from public.pedidos_pagamento where id=(p_dados->>'id')::uuid;
  perform 1 from public.pessoas where "idPessoa"=v_pessoa for update;
  select * into strict v_pedido from public.pedidos_pagamento where id=(p_dados->>'id')::uuid for update;
  v_status:=p_dados->>'status'; v_versao:=(p_dados->>'versao')::timestamptz;
  if v_pedido.id_order_mp<>p_dados->>'order' or v_pedido.valor<>(p_dados->>'valor')::numeric or v_pedido.moeda<>p_dados->>'moeda' then raise exception 'Order divergente'; end if;
  if v_pedido.ultima_versao_mp>v_versao then return financeiro.json_pedido(v_pedido); end if;
  if v_pedido.ultima_versao_mp=v_versao and v_pedido.status<>v_status then raise exception 'Conflito de versão financeira'; end if;
  -- Terminal reversals are never undone by a delayed approved notification.
  if v_pedido.status in ('estornado','contestado') and v_status not in ('estornado','contestado') then return financeiro.json_pedido(v_pedido); end if;
  update public.pedidos_pagamento set status=v_status,ultima_versao_mp=v_versao,consultado_em=now(),atualizado_em=now(),
   webhook_confirmado=webhook_confirmado or coalesce((p_dados->>'webhook')::boolean,false) where id=v_pedido.id returning * into v_pedido;
  insert into public.pagamentos(id_pedido,id_pessoa,id_plano,id_order_mp,id_pagamento_mp,referencia_pagamento_mp,valor,moeda,status,metodo,parcelas,valor_estornado,detalhe_status,aprovado_em)
   values(v_pedido.id,v_pessoa,v_pedido.id_plano,v_pedido.id_order_mp,p_dados->>'pagamento',p_dados->>'referencia_pagamento',v_pedido.valor,v_pedido.moeda,v_status,p_dados->>'metodo',(p_dados->>'parcelas')::integer,coalesce((p_dados->>'estornado')::numeric,0),p_dados->>'detalhe',case when v_status='aprovado' then now() end)
   on conflict(id_pedido) do update set status=excluded.status,id_pagamento_mp=coalesce(excluded.id_pagamento_mp,pagamentos.id_pagamento_mp),referencia_pagamento_mp=coalesce(excluded.referencia_pagamento_mp,pagamentos.referencia_pagamento_mp),metodo=excluded.metodo,parcelas=excluded.parcelas,valor_estornado=excluded.valor_estornado,detalhe_status=excluded.detalhe_status,aprovado_em=coalesce(pagamentos.aprovado_em,excluded.aprovado_em),atualizado_em=now() returning * into v_pag;
  select * into strict v_ass from public.assinaturas where id_pedido=v_pedido.id for update;
  update public.assinaturas set id_pagamento=v_pag.id where id=v_ass.id;
  if v_status='aprovado' and v_ass.inicio_em is null and v_pedido.webhook_confirmado then
   select greatest(now(),coalesce(max(fim_em),now())) into v_inicio from public.assinaturas where id_pessoa=v_pessoa and status='ativa';
   v_fim:=((v_inicio at time zone 'UTC')+make_interval(months=>v_pedido.duracao_meses)) at time zone 'UTC';
   update public.assinaturas set status='ativa',inicio_em=v_inicio,fim_em=v_fim,atualizado_em=now() where id=v_ass.id;
   insert into public.historico_assinaturas(id_pessoa,id_assinatura,tipo,dados,chave)
    values(v_pessoa,v_ass.id,case when v_inicio>now() then 'renovacao' else 'ativacao' end,jsonb_build_object('inicio',v_inicio,'fim',v_fim,'pagamento',v_pag.id),v_pedido.id::text||':ativada') on conflict do nothing;
  elsif v_status in ('estornado','contestado','cancelado','rejeitado') then
   update public.assinaturas set status=case when v_status='contestado' then 'suspensa' else 'cancelada' end,
    cancelamento_em=case when v_status<>'contestado' then coalesce(cancelamento_em,now()) end,atualizado_em=now() where id=v_ass.id;
  end if;
  insert into public.historico_assinaturas(id_pessoa,id_assinatura,tipo,dados,chave)
   values(v_pessoa,v_ass.id,'pagamento_'||v_status,jsonb_build_object('detalhe',p_dados->>'detalhe','order',v_pedido.id_order_mp),v_pedido.id::text||':'||v_status||':'||v_versao::text) on conflict do nothing;
  return financeiro.json_pedido(v_pedido);
 when 'conciliar' then
  return coalesce((select jsonb_agg(financeiro.json_pedido(p)) from (
   select * from public.pedidos_pagamento where (id_order_mp is not null or checkout_payload is not null) and criado_em>now()-interval '400 days'
    and (consultado_em is null or consultado_em<now()-interval '15 minutes')
    order by consultado_em nulls first,criado_em limit least(coalesce((p_dados->>'limite')::integer,10),50)
  ) p),'[]'::jsonb);
 when 'limitar_sincronizacao' then
  update public.pedidos_pagamento set consultado_em=now() where id=(p_dados->>'id')::uuid and (consultado_em is null or consultado_em<now()-interval '10 seconds');
  if not found then raise exception 'Aguarde alguns segundos antes de consultar novamente'; end if;
  return 'true'::jsonb;
 when 'solicitar_cancelamento' then
  select * into strict v_ass from public.assinaturas where id=(p_dados->>'id')::uuid and id_pessoa=v_pessoa;
  insert into public.historico_assinaturas(id_pessoa,id_assinatura,tipo,dados,chave)
   values(v_pessoa,v_ass.id,'cancelamento_solicitado',jsonb_build_object('justificativa',p_dados->>'justificativa'),v_ass.id::text||':cancelamento_solicitado') on conflict do nothing;
  return jsonb_build_object('recebido',true,'mensagem','Solicitação registrada para análise pelo suporte. Seu período pago permanece disponível até a análise; não há cobrança automática.');
 when 'painel' then
  if v_admin is null then raise exception 'Administrador obrigatório' using errcode='42501'; end if;
  return jsonb_build_object(
   'ambiente',(select ambiente from financeiro.configuracao),
   'planos',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('valor',p.valor::text) order by p.ordem),'[]') from public.planos_comerciais p),
   'pagamentos',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('valor',p.valor::text,'valor_estornado',p.valor_estornado::text,'email',u.email)),'[]') from (
    select * from public.pagamentos p where (v_pessoa is null or p.id_pessoa=v_pessoa)
     and (nullif(p_dados->>'plano','') is null or p.id_plano=(p_dados->>'plano')::uuid)
     and (nullif(p_dados->>'status','') is null or p.status=p_dados->>'status')
     and (nullif(p_dados->>'de','') is null or p.criado_em>=(p_dados->>'de')::timestamptz)
     and (nullif(p_dados->>'ate','') is null or p.criado_em<(p_dados->>'ate')::timestamptz+interval '1 day')
     order by p.criado_em desc limit 30 offset (coalesce((p_dados->>'pagina')::integer,1)-1)*30
   ) p join public.usuarios u on u."idUsuario"=p.id_pessoa),
   'assinaturas',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('valor',a.valor::text,'email',u.email)),'[]') from (
    select * from public.assinaturas a where (v_pessoa is null or a.id_pessoa=v_pessoa)
     and (nullif(p_dados->>'plano','') is null or a.id_plano=(p_dados->>'plano')::uuid)
     and (nullif(p_dados->>'status','') is null or a.status=p_dados->>'status')
     and (nullif(p_dados->>'vencimento','') is null or a.fim_em<(p_dados->>'vencimento')::timestamptz+interval '1 day')
     order by a.criado_em desc limit 30 offset (coalesce((p_dados->>'pagina')::integer,1)-1)*30
   ) a join public.usuarios u on u."idUsuario"=a.id_pessoa),
   'historico',(select coalesce(jsonb_agg(to_jsonb(h)),'[]') from (select * from public.historico_assinaturas where v_pessoa is null or id_pessoa=v_pessoa order by criado_em desc limit 50) h),
   'eventosFalhos',(select coalesce(jsonb_agg(to_jsonb(w)-'reserva'),'[]') from (select * from financeiro.webhooks where status='falha' order by recebido_em desc limit 30) w),
   'cancelamentos',(select coalesce(jsonb_agg(to_jsonb(h)),'[]') from (select * from public.historico_assinaturas where tipo='cancelamento_solicitado' order by criado_em desc limit 30) h),
   'indicadores',(select jsonb_build_object(
    'bruto',coalesce(sum(valor) filter(where aprovado_em is not null),0)::text,
    'estornos',coalesce(sum(valor_estornado),0)::text,
    'contestado',coalesce(sum(valor) filter(where status='contestado'),0)::text,
    'liquidoEstimado',coalesce(sum(case when status='contestado' then 0 else valor-valor_estornado end) filter(where aprovado_em is not null),0)::text,
    'pendentes',count(*) filter(where status in ('pendente','processando')),
    'aprovados',count(*) filter(where status='aprovado'),'rejeitados',count(*) filter(where status='rejeitado'))
    from public.pagamentos where (nullif(p_dados->>'de','') is null or criado_em>=(p_dados->>'de')::timestamptz) and (nullif(p_dados->>'ate','') is null or criado_em<(p_dados->>'ate')::timestamptz+interval '1 day')),
   'ativos',(select count(distinct id_pessoa) from public.assinaturas where status='ativa' and inicio_em<=now() and fim_em>now()),
   'porPlano',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select plano_nome,count(*) quantidade from public.assinaturas where status='ativa' and inicio_em<=now() and fim_em>now() group by plano_nome) r),
   'vencendo',(select count(distinct id_pessoa) from public.assinaturas where status='ativa' and fim_em between now() and now()+interval '7 days' and not exists(select 1 from public.assinaturas b where b.id_pessoa=assinaturas.id_pessoa and b.status='ativa' and b.fim_em>assinaturas.fim_em)),
   'renovacoes',(select count(*) from public.historico_assinaturas where tipo='renovacao'),
   'pagina',coalesce((p_dados->>'pagina')::integer,1)
  );
 when 'marcar_consulta' then
  update public.pedidos_pagamento set consultado_em=now() where id=(p_dados->>'id')::uuid;
  return 'true'::jsonb;
 when 'manutencao' then
  delete from financeiro.limites_requisicoes where minuto<now()-interval '2 days';
  with expiradas as (update public.assinaturas set status='expirada',atualizado_em=now() where status='ativa' and fim_em<=now() returning *)
  insert into public.historico_assinaturas(id_pessoa,id_assinatura,tipo,chave) select id_pessoa,id,'expiracao',id::text||':expirada' from expiradas on conflict do nothing;
  for v_row in select a.* from public.assinaturas a where a.status in ('ativa','expirada') and a.fim_em between now()-interval '1 day' and now()+interval '8 days'
   and not exists(select 1 from public.assinaturas outra where outra.id_pessoa=a.id_pessoa and outra.status='ativa' and outra.fim_em>a.fim_em) loop
   v_dias:=greatest(0,ceil(extract(epoch from v_row.fim_em-now())/86400)::integer);
   if v_dias in (0,1,3,7) then
    insert into public.avisos_assinatura(id_pessoa,id_assinatura,dias,fim_em,mensagem)
    values(v_row.id_pessoa,v_row.id,v_dias,v_row.fim_em,case when v_dias=0 then 'Seu Premium venceu. Escolha um plano para renovar.' else 'Seu Premium vence em '||v_dias||' dia(s). A renovação é manual.' end) on conflict do nothing;
    get diagnostics v_count=row_count;
    if v_count=1 then
     insert into comunicacao.emails_transacionais("idEmailTransacional",tipo_evento,"idUsuario",email_destinatario,assunto,dados_template,maximo_tentativas,agendado_em,chave_idempotencia)
     select gen_random_uuid(),'SUBSCRIPTION_EXPIRING',u."idUsuario",u.email,'Sua assinatura ConcursaAI',jsonb_build_object('nome',u.email),5,now(),'assinatura:'||v_row.id||':'||v_dias||':'||v_row.fim_em::text
     from public.usuarios u where u."idUsuario"=v_row.id_pessoa on conflict(chave_idempotencia) do nothing;
    end if;
   end if;
  end loop;
  return 'true'::jsonb;
 when 'salvar_plano' then
  if v_admin is null then raise exception 'Administrador obrigatório' using errcode='42501'; end if;
  if nullif(p_dados->>'id','') is not null then select * into strict v_plano from public.planos_comerciais where id=(p_dados->>'id')::uuid for update; end if;
  insert into public.planos_comerciais(id,codigo,nome,descricao,valor,duracao_meses,beneficios,ordem,ativo,destaque)
   values(coalesce(v_plano.id,gen_random_uuid()),coalesce(v_plano.codigo,p_dados->>'codigo'),p_dados->>'nome',p_dados->>'descricao',(p_dados->>'valor')::numeric,(p_dados->>'duracao_meses')::integer,p_dados->'beneficios',(p_dados->>'ordem')::integer,(p_dados->>'ativo')::boolean,(p_dados->>'destaque')::boolean)
   on conflict(id) do update set nome=excluded.nome,descricao=excluded.descricao,valor=excluded.valor,duracao_meses=excluded.duracao_meses,beneficios=excluded.beneficios,ordem=excluded.ordem,ativo=excluded.ativo,destaque=excluded.destaque,atualizado_em=now() returning to_jsonb(planos_comerciais)||jsonb_build_object('valor',planos_comerciais.valor::text) into v_json;
  insert into financeiro.auditoria(id_administrador,acao,recurso,dados) values(v_admin,'salvar_plano',v_json->>'id',jsonb_build_object('antes',to_jsonb(v_plano),'depois',v_json));
  return v_json;
 when 'auditar' then
  insert into financeiro.auditoria(id_administrador,acao,recurso,dados) values(v_admin,p_dados->>'acao',p_dados->>'id',jsonb_build_object('justificativa',p_dados->>'justificativa','chave',p_dados->>'chave'));
  return 'true'::jsonb;
 when 'reprocessar_eventos' then
  if v_admin is null then raise exception 'Administrador obrigatório' using errcode='42501'; end if;
  update financeiro.webhooks set status='pendente',tentativas=0,proxima_tentativa_em=now() where status='falha';
  insert into financeiro.auditoria(id_administrador,acao,recurso) values(v_admin,'reprocessar_webhooks','fila');
  return 'true'::jsonb;
 when 'operacao_financeira' then
  if v_admin is null then raise exception 'Administrador obrigatório' using errcode='42501'; end if;
  select * into strict v_pedido from public.pedidos_pagamento where id=(p_dados->>'id')::uuid for update;
  if p_dados->>'acao'='estornar' and v_pedido.status<>'aprovado' then raise exception 'Somente pagamentos aprovados podem ser estornados'; end if;
  if p_dados->>'acao'='cancelar' and v_pedido.status not in ('pendente','processando') then raise exception 'Somente pedidos pendentes podem ser cancelados'; end if;
  insert into financeiro.auditoria(id_administrador,acao,recurso,dados) values(v_admin,p_dados->>'acao',v_pedido.id::text,jsonb_build_object('justificativa',p_dados->>'justificativa','chave',p_dados->>'chave'));
  return financeiro.json_pedido(v_pedido);
 else raise exception 'Operação financeira inválida';
 end case;
end $$;
create function public.operar_financeiro_backend(p_operacao text,p_dados jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$ select financeiro.operar_backend(p_operacao,p_dados) $$;
revoke all on all functions in schema financeiro from public,anon,authenticated,concursa_dados;
revoke all on function public.operar_financeiro_backend(text,jsonb) from public,anon,authenticated,concursa_dados;
grant usage on schema financeiro to service_role;
grant execute on function financeiro.operar_backend(text,jsonb),public.operar_financeiro_backend(text,jsonb) to service_role;

-- Transactional messages use the existing durable email worker and Resend delivery flow.
alter table comunicacao.emails_transacionais drop constraint emails_transacionais_tipo_evento_check;
alter table comunicacao.emails_transacionais add constraint emails_transacionais_tipo_evento_check check(tipo_evento in ('EMAIL_VERIFICATION','WELCOME_EMAIL','PASSWORD_RESET','USER_INACTIVE','SUBSCRIPTION_EXPIRING'));
alter table comunicacao.workflows drop constraint workflows_tipo_evento_check;
alter table comunicacao.workflows add constraint workflows_tipo_evento_check check(tipo_evento in ('EMAIL_VERIFICATION','WELCOME_EMAIL','PASSWORD_RESET','USER_INACTIVE','SUBSCRIPTION_EXPIRING'));
insert into comunicacao.workflows(tipo_evento,habilitado) values('SUBSCRIPTION_EXPIRING',true) on conflict do nothing;

-- Defense in depth against bypassing the HTTP API through authenticated Supabase calls.
do $$ declare t text; f record; definition text; begin
 foreach t in array array['questoes','alternativas','gabaritos','concursos','simulados','simulado_questoes','tentativas_simulado','respostas_simulado','anotacoes_pessoais_questoes','honra_progresso','honra_movimentacoes','honra_dias_estudo','honra_questoes_pontuadas','metas_estudo','analises_questoes','ia_consumo_analises','ia_perguntas_contextuais'] loop
  execute format('create policy premium_vigente on public.%I as restrictive for all to authenticated using ((select public.tem_acesso_premium())) with check ((select public.tem_acesso_premium()))',t);
 end loop;
 -- SECURITY DEFINER RPCs bypass RLS, so guard their own entry points too.
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
  where n.nspname in ('public','provas_privado','honra_privado') and l.lanname='plpgsql' and p.proname=any(array[
   'disponibilidade_assuntos_odonto','obter_explicacao_questao','iniciar_prova','iniciar_tentativa','responder_questao','finalizar_tentativa','obter_resultado_tentativa','salvar_simulado','criar_simulado_filtrado','gerar_simulado_odonto',
   'resumo_revisao_odonto','listar_questoes_revisao','estatisticas_assuntos','progresso_meta_semanal','salvar_meta_semanal','gerar_treino_odonto',
   'consultar_indicadores_honra','consultar_painel_desempenho','consultar_historico_honra','salvar_anotacao','contexto_analise_questao','consultar_analise_questao','reservar_analise_backend','consultar_historico_perguntas_contextuais_ia','reservar_pergunta_contextual_ia'
  ]) loop
  definition:=pg_get_functiondef(f.oid);
  definition:=regexp_replace(definition,'\mbegin\M',E'begin\n perform public.exigir_acesso_premium();','i');
  execute definition;
 end loop;
 -- SQL entry points need an executable guard too. Preserve signatures,
 -- ownership checks, security mode and volatility classification.
 for f in select p.*,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
  where n.nspname in ('public','provas_privado') and l.lanname='sql'
   and p.proname=any(array['estatisticas_assuntos','obter_resultado_tentativa','quantidade_questoes_odonto']) loop
  definition:=format('create or replace function %I.%I(%s) returns %s language plpgsql %s security %s set search_path='''' as %L',
   f.nspname,f.proname,pg_get_function_arguments(f.oid),pg_get_function_result(f.oid),
   case f.provolatile when 's' then 'stable' when 'i' then 'immutable' else 'volatile' end,
   case when f.prosecdef then 'definer' else 'invoker' end,
   'begin perform public.exigir_acesso_premium(); '||case when f.proretset then 'return query ' else 'return (' end||regexp_replace(btrim(f.prosrc),';\s*$','')||case when f.proretset then ';' else ');' end||' end');
  execute definition;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
