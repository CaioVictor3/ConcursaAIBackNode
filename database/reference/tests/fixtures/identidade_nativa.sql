-- Adaptador somente de fixtures: INSERTs históricos continuam legíveis nos testes.
-- Não faz parte das migrations nem reinstala integração com o Supabase Auth.
create function pg_temp.criar_identidade_fixture() returns trigger language plpgsql as $$
declare v_google boolean;v_pessoa jsonb;
begin
  v_google:=coalesce(new.raw_app_meta_data->>'provider','email')='google';
  v_pessoa:=coalesce(new.raw_user_meta_data,'{}'::jsonb);
  if v_google then v_pessoa:=jsonb_build_object('nome_completo',coalesce(v_pessoa->>'full_name',v_pessoa->>'name','Pessoa Google'));end if;
  perform identidade.criar_conta(new.id,new.email,null,null,new.email_confirmed_at,v_pessoa,not v_google);
  return new;
end $$;
create trigger criar_identidade_fixture after insert on auth.users for each row execute function pg_temp.criar_identidade_fixture();
