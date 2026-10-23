begin;
create function identidade.sincronizar_usuario_supabase_auth()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_pessoa jsonb; v_sub text; v_nome text;
begin
 if tg_op='INSERT' and not exists(select 1 from public.usuarios where "idUsuario"=new.id) then
  v_nome:=coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''),nullif(btrim(new.raw_user_meta_data->>'name'),''),split_part(new.email,'@',1),'Estudante');
  perform identidade.criar_conta(new.id,new.email,null,null,new.email_confirmed_at,jsonb_build_object('nome_completo',left(v_nome,200)),false);
  v_pessoa:=new.raw_user_meta_data->'pessoa';
  if jsonb_typeof(v_pessoa)='object' then
   v_sub:=current_setting('request.jwt.claim.sub',true);
   perform set_config('request.jwt.claim.sub',new.id::text,true);
   perform public.salvar_minha_pessoa(v_pessoa);
   perform set_config('request.jwt.claim.sub',coalesce(v_sub,''),true);
   insert into public.estudantes("idEstudante") values(new.id) on conflict do nothing;
  end if;
 end if;
 if new.email_confirmed_at is not null then
  update public.usuarios set estado_cadastro='ativo',atualizado_em=now()
   where "idUsuario"=new.id and estado_cadastro='verificacao_pendente';
  update identidade.contas set email_confirmado_em=new.email_confirmed_at,atualizado_em=now()
   where "idUsuario"=new.id;
 end if;
 return new;
end $$;
revoke all on function identidade.sincronizar_usuario_supabase_auth() from public,anon,authenticated;
create trigger sincronizar_usuario_concursa_supabase
 after insert or update of email_confirmed_at on auth.users
 for each row execute function identidade.sincronizar_usuario_supabase_auth();
notify pgrst,'reload schema';
commit;
