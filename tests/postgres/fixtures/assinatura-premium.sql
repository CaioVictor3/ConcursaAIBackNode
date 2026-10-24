-- Only loaded by disposable regression tests. These are explicit local fixtures,
-- never provider-confirmed transactions and never applied to an external project.
create or replace function pg_temp.conceder_premium_fixture(p_pessoa uuid) returns void language plpgsql as $$
declare v_plano public.planos_comerciais; v_pedido uuid; v_pagamento uuid;
begin
 select * into strict v_plano from public.planos_comerciais where codigo='anual';
 insert into public.pedidos_pagamento(id_pessoa,id_plano,plano_nome,duracao_meses,beneficios,valor,moeda,status,ambiente,chave_idempotencia,referencia_externa,id_order_mp,webhook_confirmado)
 values(p_pessoa,v_plano.id,'FIXTURE LOCAL Premium',12,v_plano.beneficios,v_plano.valor,'BRL','aprovado','teste',gen_random_uuid(),'FIXTURE:'||p_pessoa,'FIXTURE-ORDER:'||p_pessoa,true) returning id into v_pedido;
 insert into public.pagamentos(id_pedido,id_pessoa,id_plano,id_order_mp,id_pagamento_mp,valor,moeda,status,aprovado_em)
 values(v_pedido,p_pessoa,v_plano.id,'FIXTURE-ORDER:'||p_pessoa,'FIXTURE-PAYMENT:'||p_pessoa,v_plano.valor,'BRL','aprovado',now()) returning id into v_pagamento;
 insert into public.assinaturas(id_pessoa,id_pedido,id_pagamento,id_plano,plano_nome,valor,duracao_meses,beneficios,status,inicio_em,fim_em)
 values(p_pessoa,v_pedido,v_pagamento,v_plano.id,'FIXTURE LOCAL Premium',v_plano.valor,12,v_plano.beneficios,'ativa',now()-interval '1 day',now()+interval '12 months');
end $$;
