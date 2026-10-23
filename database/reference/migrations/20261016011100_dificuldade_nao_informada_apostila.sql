-- A apostila não informa dificuldade. Preservamos essa ausência em vez de classificá-la como média.
alter table public.questoes drop constraint questoes_dificuldade_check;
alter table public.questoes add constraint questoes_dificuldade_check
  check (dificuldade in ('facil', 'media', 'dificil', 'nao_informada'));
update public.questoes set dificuldade = 'nao_informada'
where fonte like 'Apostila Questões Concurso Público – PPGO/UFU (2023)%';
