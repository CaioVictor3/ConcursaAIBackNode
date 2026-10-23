-- Somente em banco LOCAL descartável, após todas as migrations. Escritas revertidas.
begin;
\ir fixtures/identidade_nativa.sql
do $$ begin
  assert to_regclass('public.usuarios') is not null;
  assert to_regclass('public.perfis') is null;
  assert to_regclass('public.administradores') is null;
  assert exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'usuarios' and column_name = 'tipo' and column_default = '''estudante''::text');
  assert not exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'usuarios' and column_name = 'papel');
  assert not exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'suporte_privado') and p.prosrc ~ '\mpapel\M'), 'Função ainda usa a coluna antiga';
  assert exists(select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.usuarios'::regclass and c.contype = 'p' and cardinality(c.conkey) = 1 and a.attname = 'idUsuario');
  assert exists(select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.usuarios'::regclass and c.contype = 'u' and cardinality(c.conkey) = 1 and a.attname = 'idPessoa');
  assert not exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'suporte_privado') and p.prosrc ~ 'public\.perfis\M'), 'Função ainda usa a tabela antiga';
  assert not has_table_privilege('authenticated', 'public.usuarios', 'INSERT');
  assert not has_table_privilege('authenticated', 'public.usuarios', 'UPDATE');
  assert not has_table_privilege('authenticated', 'public.usuarios', 'DELETE');
  assert not has_table_privilege('anon', 'public.usuarios', 'SELECT');
end $$;

insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data)
select id, email, now(), jsonb_build_object('nome_completo', 'Teste Usuário', 'data_nascimento', '2000-01-01', 'cpf', cpf,
  'cep', '01001000', 'logradouro', 'Rua Teste', 'numero', '1', 'bairro', 'Centro', 'cidade', 'Teste', 'uf', 'SP', 'tipo', 'administrador', 'papel', 'administrador')
from (values
  ('30000000-0000-0000-0000-000000000001'::uuid, 'usuario-admin@exemplo.invalid', '52998224725'),
  ('30000000-0000-0000-0000-000000000002'::uuid, 'usuario-aluno@exemplo.invalid', '11144477735')
) as contas(id, email, cpf);
do $$ begin
  assert (select count(*) = 2 from public.usuarios where "idUsuario" in (
    '30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002') and "idUsuario" = "idPessoa" and tipo = 'estudante'), 'Cadastro não sincronizou identidade ou aceitou tipo da metadata';
end $$;
update public.usuarios set tipo = 'administrador' where "idUsuario" = '30000000-0000-0000-0000-000000000001';
-- O horário agora é mantido pelo backend, sem trigger do serviço Auth.
update public.usuarios set ultimo_acesso_em = timestamptz '2026-10-19 15:00:00+00' where "idUsuario" = '30000000-0000-0000-0000-000000000002';
do $$ declare v_negado boolean := false; begin
  assert (select ultimo_acesso_em = timestamptz '2026-10-19 15:00:00+00' and tipo = 'estudante'
    from public.usuarios where "idUsuario" = '30000000-0000-0000-0000-000000000002'), 'Login não sincroniza usuarios';
  begin update public.usuarios set "idUsuario" = null where "idUsuario" = '30000000-0000-0000-0000-000000000002';
  exception when not_null_violation then v_negado := true; end;
  assert v_negado, 'Chave primária nula';
  v_negado := false;
  begin update public.usuarios set "idUsuario" = '30000000-0000-0000-0000-000000000001' where "idPessoa" = '30000000-0000-0000-0000-000000000002';
  exception when unique_violation then v_negado := true; end;
  assert v_negado, 'Chave primária duplicada';
  v_negado := false;
  begin update public.usuarios set tipo = 'outro' where "idUsuario" = '30000000-0000-0000-0000-000000000002';
  exception when check_violation then v_negado := true; end;
  assert v_negado, 'Tipo de conta inválido aceito';
end $$;

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true);
set local role concursa_dados;
do $$ declare v_negado boolean := false; begin
  assert (select count(*) = 1 from public.usuarios), 'Aluno leu contas de terceiros';
  assert (select "idUsuario" = auth.uid() and tipo = 'estudante' from public.usuarios), 'Leitura não usa a identidade autenticada';
  assert not public.eh_administrador();
  begin update public.usuarios set tipo = 'administrador' where "idUsuario" = auth.uid();
  exception when insufficient_privilege then v_negado := true; end;
  assert v_negado, 'Aluno alterou o próprio tipo';
  assert (public.obter_minha_pessoa()->>'idPessoa')::uuid = auth.uid();
  assert public.quantidade_questoes_odonto() >= 0; -- Acervo vazio também é válido após a limpeza autorizada.
end $$;

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
do $$ begin
  assert public.eh_administrador(), 'Papel administrativo não reconhecido';
  assert (select count(*) >= 2 from public.usuarios), 'Admin não consulta usuários';
  assert (public.metricas_sistema()->>'administradores')::integer >= 1;
end $$;
reset role;
update public.usuarios set tipo = 'estudante' where "idUsuario" = '30000000-0000-0000-0000-000000000001';
set local role concursa_dados;
do $$ declare v_negado boolean := false; begin
  assert not public.eh_administrador(), 'Papel anterior manteve autorização administrativa';
  begin perform public.metricas_sistema(); exception when insufficient_privilege then v_negado := true; end;
  assert v_negado;
end $$;
rollback;
