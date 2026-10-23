begin;
create function comunicacao.registrar_evento_backend(p_webhook text,p_idmensagem text,p_evento text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if length(p_webhook) not between 1 and 500 or length(p_idmensagem) not between 1 and 500 or length(p_evento) not between 1 and 100 then raise exception 'Evento inválido'; end if;
 insert into comunicacao.eventos_resend(id_evento_webhook,id_mensagem_provedor,tipo_evento)
 values(p_webhook,p_idmensagem,p_evento) on conflict(id_evento_webhook) do nothing;
 update comunicacao.emails_transacionais e set
  status=case
   when exists(select 1 from comunicacao.eventos_resend r where r.id_mensagem_provedor=p_idmensagem and r.tipo_evento in ('email.bounced','email.complained','email.failed')) then 'bounce'
   when exists(select 1 from comunicacao.eventos_resend r where r.id_mensagem_provedor=p_idmensagem and r.tipo_evento='email.delivered') then 'entregue'
   else e.status end,
  entregue_em=case when exists(select 1 from comunicacao.eventos_resend r where r.id_mensagem_provedor=p_idmensagem and r.tipo_evento='email.delivered') then coalesce(e.entregue_em,now()) else e.entregue_em end
 where e.id_mensagem_provedor=p_idmensagem and e.status in ('aceito','entregue','bounce');
end $$;
create function public.registrar_evento_resend_backend(p_webhook text,p_idmensagem text,p_evento text)
returns void language sql security invoker set search_path='' as $$ select comunicacao.registrar_evento_backend(p_webhook,p_idmensagem,p_evento) $$;
revoke all on function comunicacao.registrar_evento_backend(text,text,text),public.registrar_evento_resend_backend(text,text,text) from public,anon,authenticated;
grant usage on schema comunicacao to service_role;
grant execute on function comunicacao.registrar_evento_backend(text,text,text),public.registrar_evento_resend_backend(text,text,text) to service_role;
create function identidade.registrar_acesso_supabase()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.last_sign_in_at is distinct from old.last_sign_in_at then
  update public.usuarios set ultimo_acesso_em=new.last_sign_in_at,atualizado_em=now() where "idUsuario"=new.id;
 end if;
 return new;
end $$;
revoke all on function identidade.registrar_acesso_supabase() from public,anon,authenticated;
create trigger registrar_acesso_concursa_supabase after update of last_sign_in_at on auth.users
 for each row execute function identidade.registrar_acesso_supabase();
notify pgrst,'reload schema';
commit;
