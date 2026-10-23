-- Limpeza expressamente autorizada pelo responsável em 21/10/2026.
-- Remove TODO o acervo e os simulados/tentativas/respostas para nova importação.
-- Não usar CASCADE: a lista de dependências deve continuar explícita e revisável.
begin;
set local lock_timeout = '10s';
create temporary table identidades_preservadas on commit drop as
  select 'auth'::text origem,id::text id,to_jsonb(u) dados from auth.users u
  union all select 'usuario',"idUsuario"::text,to_jsonb(u) from public.usuarios u
  union all select 'pessoa',"idPessoa"::text,to_jsonb(p) from public.pessoas p
  union all select 'estudante',"idEstudante"::text,to_jsonb(e) from public.estudantes e
  union all select 'tema',"idTema"::text,to_jsonb(t) from public.temas t;
truncate table public.respostas_simulado, public.tentativas_simulado,
  public.simulado_questoes, public.simulados, public.analises_questoes,
  public.gabaritos, public.alternativas, public.questoes, public.concursos;
-- Acervo vazio: agora é seguro concluir a obrigatoriedade dos vínculos e metadados.
select provas_privado.concluir_migracao();
create temporary table identidades_depois on commit drop as
  select 'auth'::text origem,id::text id,to_jsonb(u) dados from auth.users u
  union all select 'usuario',"idUsuario"::text,to_jsonb(u) from public.usuarios u
  union all select 'pessoa',"idPessoa"::text,to_jsonb(p) from public.pessoas p
  union all select 'estudante',"idEstudante"::text,to_jsonb(e) from public.estudantes e
  union all select 'tema',"idTema"::text,to_jsonb(t) from public.temas t;
do $$ begin
  if exists((select * from identidades_preservadas except select * from identidades_depois)
    union all (select * from identidades_depois except select * from identidades_preservadas)) then
    raise exception 'A limpeza alterou contas ou temas; transação cancelada';
  end if;
end $$;
notify pgrst,'reload schema';
commit;
