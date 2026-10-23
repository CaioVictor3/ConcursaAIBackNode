from pathlib import Path
root=Path(__file__).resolve().parents[1]
parts=["import { randomUUID } from 'node:crypto';\nimport * as M from '../contracts/models.js';\nimport { project } from '../contracts/codec.js';\nimport { Context } from './context.js';\nimport { eq,ne,contains,ieq } from '../infrastructure/repository.js';\nimport { identifier,text,pagination,ServiceError,success } from '../domain/errors.js';\nexport function catalogHandlers(ctx:Context) {\n const r=ctx.repo;\n return {"]
for name,plural,label,article,created,updated,deleted in [('Banca','Bancas','banca','uma banca','criada','atualizada','excluída'),('Disciplina','Disciplinas','disciplina','uma disciplina','criada','atualizada','desativada'),('Assunto','Assuntos','assunto','um assunto','criado','atualizado','excluído'),('Concurso','Concursos','concurso','um concurso','criado','atualizado','excluído')]:
 low=name.lower();pk='id'+name;dto=name+'ResponseModel';noun=name if name in ['Assunto','Concurso'] else name;notfound=noun+(' não encontrado.' if name in ['Assunto','Concurso'] else ' não encontrada.')
 parts.append(f'''async listar{plural[0].upper()+plural[1:]}(q:M.Listar{plural}RequestModel) {{
 await ctx.user();pagination(q.pagina,q.quantidadePorPagina);const filters=[];if(q.busca?.trim())filters.push(contains('nome',q.busca));
 {"if(q.idDisciplina!==null)filters.push(eq('idDisciplina',q.idDisciplina));" if name=='Assunto' else ''}
 const page=await r.query('{name}','{dto}',{{filters,order:[['nome'],['{pk}']],offset:(q.pagina-1)*q.quantidadePorPagina,limit:q.quantidadePorPagina}});
 return success({{...page,pagina:q.pagina,quantidadePorPagina:q.quantidadePorPagina}},'{plural} consultad{('os' if name in ['Assunto','Concurso'] else 'as')}.');
 }},
 async obter{name}(q:M.Obter{name}RequestModel) {{await ctx.user();identifier(q.{pk},'{low}');return success(await r.one('{name}','{dto}',[eq('{pk}',q.{pk})],'{notfound}'),'{name} consultad{('o' if name in ['Assunto','Concurso'] else 'a')}.');}},''')
 for update in [False,True]:
  action='atualizar' if update else 'criar';req=('Atualizar' if update else 'Criar')+name+'RequestModel'
  extra=''
  if name=='Assunto':extra='''identifier(q.idDisciplina,'uma disciplina');if(!await r.exists('Disciplina',[eq('idDisciplina',q.idDisciplina)]))throw new ServiceError('Disciplina não encontrada.',404);
 const visited=new Set<string>();let ancestor=q.idAssuntoPai;
 while(ancestor!==null){if(visited.has(ancestor)||ancestor===id)throw new ServiceError('A hierarquia do assunto não pode conter ciclos.');visited.add(ancestor);const parent=await r.optional('Assunto','AssuntoResponseModel',[eq('idAssunto',ancestor),eq('idDisciplina',q.idDisciplina)]);if(!parent)throw new ServiceError('O assunto pai deve pertencer à mesma disciplina.');ancestor=parent.idAssuntoPai;}'''
  if name=='Concurso':extra="if(q.ano<1900||q.ano>2100)throw new ServiceError('Informe um ano entre 1900 e 2100.');if(!['ativo','arquivado'].includes(q.status?.trim()))throw new ServiceError('Status do concurso inválido.');"
  data={'Banca':"nome,sigla:q.sigla?.trim()??''",'Disciplina':"nome,descricao:q.descricao?.trim()??'',ativa:q.ativa,area:q.area?.trim()??null",'Assunto':"nome,idDisciplina:q.idDisciplina,idAssuntoPai:q.idAssuntoPai,descricao:q.descricao?.trim()??null",'Concurso':"nome,orgao:q.orgao?.trim()??'',cargo:q.cargo?.trim()??'',estado:q.estado?.trim()??'',ano:q.ano,descricao:q.descricao?.trim()??null,status:q.status.trim()"}[name]
  duplicate='uma disciplina' if name=='Disciplina' else 'uma banca' if name=='Banca' else 'um '+low
  parts.append(f'''async {action}{name}(q:M.{req}) {{await ctx.admin();const id={('q.'+pk) if update else 'randomUUID()'};
 {f"identifier(id,'{low}');const old=await r.one('{name}','{dto}',[eq('{pk}',id)],'{notfound}');" if update else ''}
 const nome=text(q.nome,'Nome',2,200);{extra}
 if(await r.exists('{name}',[ieq('nome',nome){",eq('idDisciplina',q.idDisciplina)" if name=='Assunto' else ''}{f",ne('{pk}',id)" if update else ''}]))throw new ServiceError('Já existe {duplicate} com esse nome.',409);
 const data={{{data}}};await r.mutate('{name}','{'update' if update else 'insert'}',id,{{...data{'' if update else f",{pk}:id,criado_em:new Date().toISOString()"}}});
 return success(project('{dto}',{{...{'old' if update else '{}'},...data,{pk}:id{'' if update else ',criado_em:new Date().toISOString()'}}}),'{name} {updated if update else created}.');}},''')
  # postgresql driver accepts iso timestamp via unknown params
 if name=='Disciplina':
  parts.append("async desativarDisciplina(q:M.DesativarDisciplinaRequestModel){await ctx.admin();identifier(q.idDisciplina,'disciplina');const old=await r.one('Disciplina','DisciplinaResponseModel',[eq('idDisciplina',q.idDisciplina)],'Disciplina não encontrada.');await r.mutate('Disciplina','update',q.idDisciplina,{nome:old.nome,descricao:old.descricao,ativa:false,area:old.area});return success({...old,ativa:false},'Disciplina desativada.');},")
 else:
  links={'Banca':"await r.exists('Questao',[eq('idBanca',id)])",'Assunto':"await r.exists('Questao',[eq('idAssunto',id)])||await r.exists('Assunto',[eq('idAssuntoPai',id)])",'Concurso':"await r.exists('Questao',[eq('idConcurso',id)])||await r.exists('Simulado',[eq('idConcurso',id)])"}[name]
  parts.append(f"async excluir{name}(q:M.Excluir{name}RequestModel){{await ctx.admin();const id=q.{pk};identifier(id,'{low}');const old=await r.one('{name}','{dto}',[eq('{pk}',id)],'{notfound}');if({links})throw new ServiceError('Este cadastro possui vínculos e não pode ser excluído.',409);await r.mutate('{name}','delete',id);return success(old,'{name} {deleted}.');}},")
parts.append('};\n}')
# camel case first part only (listarBancas already correct)
(root/'src/application/catalog.ts').write_text('\n'.join(parts))
