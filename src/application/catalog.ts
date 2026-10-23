import { randomUUID } from 'node:crypto';
import * as M from '../contracts/models.js';
import { project } from '../contracts/codec.js';
import { Context } from './context.js';
import { eq,ne,contains,ieq } from '../infrastructure/repository.js';
import { identifier,text,pagination,ServiceError,success } from '../domain/errors.js';
export function catalogHandlers(ctx:Context) {
 const r=ctx.repo;
 return {
async listarBancas(q:M.ListarBancasRequestModel) {
 await ctx.user();pagination(q.pagina,q.quantidadePorPagina);const filters=[];if(q.busca?.trim())filters.push(contains('nome',q.busca));
 
 const page=await r.query('Banca','BancaResponseModel',{filters,order:[['nome'],['idBanca']],offset:(q.pagina-1)*q.quantidadePorPagina,limit:q.quantidadePorPagina});
 return success({...page,pagina:q.pagina,quantidadePorPagina:q.quantidadePorPagina},'Bancas consultadas.');
 },
 async obterBanca(q:M.ObterBancaRequestModel) {await ctx.user();identifier(q.idBanca,'banca');return success(await r.one('Banca','BancaResponseModel',[eq('idBanca',q.idBanca)],'Banca não encontrada.'),'Banca consultada.');},
async criarBanca(q:M.CriarBancaRequestModel) {await ctx.admin();const id=randomUUID();
 
 const nome=text(q.nome,'Nome',2,200);
 if(await r.exists('Banca',[ieq('nome',nome)]))throw new ServiceError('Já existe uma banca com esse nome.',409);
 const data={nome,sigla:q.sigla?.trim()??''};await r.mutate('Banca','insert',id,{...data,idBanca:id,criado_em:new Date().toISOString()});
 return success(project('BancaResponseModel',{...{},...data,idBanca:id,criado_em:new Date().toISOString()}),'Banca criada.');},
async atualizarBanca(q:M.AtualizarBancaRequestModel) {await ctx.admin();const id=q.idBanca;
 identifier(id,'banca');const old=await r.one('Banca','BancaResponseModel',[eq('idBanca',id)],'Banca não encontrada.');
 const nome=text(q.nome,'Nome',2,200);
 if(await r.exists('Banca',[ieq('nome',nome),ne('idBanca',id)]))throw new ServiceError('Já existe uma banca com esse nome.',409);
 const data={nome,sigla:q.sigla?.trim()??''};await r.mutate('Banca','update',id,{...data});
 return success(project('BancaResponseModel',{...old,...data,idBanca:id}),'Banca atualizada.');},
async excluirBanca(q:M.ExcluirBancaRequestModel){await ctx.admin();const id=q.idBanca;identifier(id,'banca');const old=await r.one('Banca','BancaResponseModel',[eq('idBanca',id)],'Banca não encontrada.');if(await r.exists('Questao',[eq('idBanca',id)]))throw new ServiceError('Este cadastro possui vínculos e não pode ser excluído.',409);await r.mutate('Banca','delete',id);return success(old,'Banca excluída.');},
async listarDisciplinas(q:M.ListarDisciplinasRequestModel) {
 await ctx.user();pagination(q.pagina,q.quantidadePorPagina);const filters=[];if(q.busca?.trim())filters.push(contains('nome',q.busca));
 
 const page=await r.query('Disciplina','DisciplinaResponseModel',{filters,order:[['nome'],['idDisciplina']],offset:(q.pagina-1)*q.quantidadePorPagina,limit:q.quantidadePorPagina});
 return success({...page,pagina:q.pagina,quantidadePorPagina:q.quantidadePorPagina},'Disciplinas consultadas.');
 },
 async obterDisciplina(q:M.ObterDisciplinaRequestModel) {await ctx.user();identifier(q.idDisciplina,'disciplina');return success(await r.one('Disciplina','DisciplinaResponseModel',[eq('idDisciplina',q.idDisciplina)],'Disciplina não encontrada.'),'Disciplina consultada.');},
async criarDisciplina(q:M.CriarDisciplinaRequestModel) {await ctx.admin();const id=randomUUID();
 
 const nome=text(q.nome,'Nome',2,200);
 if(await r.exists('Disciplina',[ieq('nome',nome)]))throw new ServiceError('Já existe uma disciplina com esse nome.',409);
 const data={nome,descricao:q.descricao?.trim()??'',ativa:q.ativa,area:q.area?.trim()??null};await r.mutate('Disciplina','insert',id,{...data,idDisciplina:id,criado_em:new Date().toISOString()});
 return success(project('DisciplinaResponseModel',{...{},...data,idDisciplina:id,criado_em:new Date().toISOString()}),'Disciplina criada.');},
async atualizarDisciplina(q:M.AtualizarDisciplinaRequestModel) {await ctx.admin();const id=q.idDisciplina;
 identifier(id,'disciplina');const old=await r.one('Disciplina','DisciplinaResponseModel',[eq('idDisciplina',id)],'Disciplina não encontrada.');
 const nome=text(q.nome,'Nome',2,200);
 if(await r.exists('Disciplina',[ieq('nome',nome),ne('idDisciplina',id)]))throw new ServiceError('Já existe uma disciplina com esse nome.',409);
 const data={nome,descricao:q.descricao?.trim()??'',ativa:q.ativa,area:q.area?.trim()??null};await r.mutate('Disciplina','update',id,{...data});
 return success(project('DisciplinaResponseModel',{...old,...data,idDisciplina:id}),'Disciplina atualizada.');},
async desativarDisciplina(q:M.DesativarDisciplinaRequestModel){await ctx.admin();identifier(q.idDisciplina,'disciplina');const old=await r.one('Disciplina','DisciplinaResponseModel',[eq('idDisciplina',q.idDisciplina)],'Disciplina não encontrada.');await r.mutate('Disciplina','update',q.idDisciplina,{nome:old.nome,descricao:old.descricao,ativa:false,area:old.area});return success({...old,ativa:false},'Disciplina desativada.');},
async listarAssuntos(q:M.ListarAssuntosRequestModel) {
 await ctx.user();pagination(q.pagina,q.quantidadePorPagina);const filters=[];if(q.busca?.trim())filters.push(contains('nome',q.busca));
 if(q.idDisciplina!==null)filters.push(eq('idDisciplina',q.idDisciplina));
 const page=await r.query('Assunto','AssuntoResponseModel',{filters,order:[['nome'],['idAssunto']],offset:(q.pagina-1)*q.quantidadePorPagina,limit:q.quantidadePorPagina});
 return success({...page,pagina:q.pagina,quantidadePorPagina:q.quantidadePorPagina},'Assuntos consultados.');
 },
 async obterAssunto(q:M.ObterAssuntoRequestModel) {await ctx.user();identifier(q.idAssunto,'assunto');return success(await r.one('Assunto','AssuntoResponseModel',[eq('idAssunto',q.idAssunto)],'Assunto não encontrado.'),'Assunto consultado.');},
async criarAssunto(q:M.CriarAssuntoRequestModel) {await ctx.admin();const id=randomUUID();
 
 const nome=text(q.nome,'Nome',2,200);identifier(q.idDisciplina,'uma disciplina');if(!await r.exists('Disciplina',[eq('idDisciplina',q.idDisciplina)]))throw new ServiceError('Disciplina não encontrada.',404);
 const visited=new Set<string>();let ancestor=q.idAssuntoPai;
 while(ancestor!==null){if(visited.has(ancestor)||ancestor===id)throw new ServiceError('A hierarquia do assunto não pode conter ciclos.');visited.add(ancestor);const parent=await r.optional('Assunto','AssuntoResponseModel',[eq('idAssunto',ancestor),eq('idDisciplina',q.idDisciplina)]);if(!parent)throw new ServiceError('O assunto pai deve pertencer à mesma disciplina.');ancestor=parent.idAssuntoPai;}
 if(await r.exists('Assunto',[ieq('nome',nome),eq('idDisciplina',q.idDisciplina)]))throw new ServiceError('Já existe um assunto com esse nome.',409);
 const data={nome,idDisciplina:q.idDisciplina,idAssuntoPai:q.idAssuntoPai,descricao:q.descricao?.trim()??null};await r.mutate('Assunto','insert',id,{...data,idAssunto:id,criado_em:new Date().toISOString()});
 return success(project('AssuntoResponseModel',{...{},...data,idAssunto:id,criado_em:new Date().toISOString()}),'Assunto criado.');},
async atualizarAssunto(q:M.AtualizarAssuntoRequestModel) {await ctx.admin();const id=q.idAssunto;
 identifier(id,'assunto');const old=await r.one('Assunto','AssuntoResponseModel',[eq('idAssunto',id)],'Assunto não encontrado.');
 const nome=text(q.nome,'Nome',2,200);identifier(q.idDisciplina,'uma disciplina');if(!await r.exists('Disciplina',[eq('idDisciplina',q.idDisciplina)]))throw new ServiceError('Disciplina não encontrada.',404);
 const visited=new Set<string>();let ancestor=q.idAssuntoPai;
 while(ancestor!==null){if(visited.has(ancestor)||ancestor===id)throw new ServiceError('A hierarquia do assunto não pode conter ciclos.');visited.add(ancestor);const parent=await r.optional('Assunto','AssuntoResponseModel',[eq('idAssunto',ancestor),eq('idDisciplina',q.idDisciplina)]);if(!parent)throw new ServiceError('O assunto pai deve pertencer à mesma disciplina.');ancestor=parent.idAssuntoPai;}
 if(await r.exists('Assunto',[ieq('nome',nome),eq('idDisciplina',q.idDisciplina),ne('idAssunto',id)]))throw new ServiceError('Já existe um assunto com esse nome.',409);
 const data={nome,idDisciplina:q.idDisciplina,idAssuntoPai:q.idAssuntoPai,descricao:q.descricao?.trim()??null};await r.mutate('Assunto','update',id,{...data});
 return success(project('AssuntoResponseModel',{...old,...data,idAssunto:id}),'Assunto atualizado.');},
async excluirAssunto(q:M.ExcluirAssuntoRequestModel){await ctx.admin();const id=q.idAssunto;identifier(id,'assunto');const old=await r.one('Assunto','AssuntoResponseModel',[eq('idAssunto',id)],'Assunto não encontrado.');if(await r.exists('Questao',[eq('idAssunto',id)])||await r.exists('Assunto',[eq('idAssuntoPai',id)]))throw new ServiceError('Este cadastro possui vínculos e não pode ser excluído.',409);await r.mutate('Assunto','delete',id);return success(old,'Assunto excluído.');},
async listarConcursos(q:M.ListarConcursosRequestModel) {
 await ctx.user();pagination(q.pagina,q.quantidadePorPagina);const filters=[];if(q.busca?.trim())filters.push(contains('nome',q.busca));
 
 const page=await r.query('Concurso','ConcursoResponseModel',{filters,order:[['nome'],['idConcurso']],offset:(q.pagina-1)*q.quantidadePorPagina,limit:q.quantidadePorPagina});
 return success({...page,pagina:q.pagina,quantidadePorPagina:q.quantidadePorPagina},'Concursos consultados.');
 },
 async obterConcurso(q:M.ObterConcursoRequestModel) {await ctx.user();identifier(q.idConcurso,'concurso');return success(await r.one('Concurso','ConcursoResponseModel',[eq('idConcurso',q.idConcurso)],'Concurso não encontrado.'),'Concurso consultado.');},
async criarConcurso(q:M.CriarConcursoRequestModel) {await ctx.admin();const id=randomUUID();
 
 const nome=text(q.nome,'Nome',2,200);if(q.ano<1900||q.ano>2100)throw new ServiceError('Informe um ano entre 1900 e 2100.');if(!['ativo','arquivado'].includes(q.status?.trim()))throw new ServiceError('Status do concurso inválido.');
 if(await r.exists('Concurso',[ieq('nome',nome)]))throw new ServiceError('Já existe um concurso com esse nome.',409);
 const data={nome,orgao:q.orgao?.trim()??'',cargo:q.cargo?.trim()??'',estado:q.estado?.trim()??'',ano:q.ano,descricao:q.descricao?.trim()??null,status:q.status.trim()};await r.mutate('Concurso','insert',id,{...data,idConcurso:id,criado_em:new Date().toISOString()});
 return success(project('ConcursoResponseModel',{...{},...data,idConcurso:id,criado_em:new Date().toISOString()}),'Concurso criado.');},
async atualizarConcurso(q:M.AtualizarConcursoRequestModel) {await ctx.admin();const id=q.idConcurso;
 identifier(id,'concurso');const old=await r.one('Concurso','ConcursoResponseModel',[eq('idConcurso',id)],'Concurso não encontrado.');
 const nome=text(q.nome,'Nome',2,200);if(q.ano<1900||q.ano>2100)throw new ServiceError('Informe um ano entre 1900 e 2100.');if(!['ativo','arquivado'].includes(q.status?.trim()))throw new ServiceError('Status do concurso inválido.');
 if(await r.exists('Concurso',[ieq('nome',nome),ne('idConcurso',id)]))throw new ServiceError('Já existe um concurso com esse nome.',409);
 const data={nome,orgao:q.orgao?.trim()??'',cargo:q.cargo?.trim()??'',estado:q.estado?.trim()??'',ano:q.ano,descricao:q.descricao?.trim()??null,status:q.status.trim()};await r.mutate('Concurso','update',id,{...data});
 return success(project('ConcursoResponseModel',{...old,...data,idConcurso:id}),'Concurso atualizado.');},
async excluirConcurso(q:M.ExcluirConcursoRequestModel){await ctx.admin();const id=q.idConcurso;identifier(id,'concurso');const old=await r.one('Concurso','ConcursoResponseModel',[eq('idConcurso',id)],'Concurso não encontrado.');if(await r.exists('Questao',[eq('idConcurso',id)])||await r.exists('Simulado',[eq('idConcurso',id)]))throw new ServiceError('Este cadastro possui vínculos e não pode ser excluído.',409);await r.mutate('Concurso','delete',id);return success(old,'Concurso excluído.');},
};
}