import type * as M from '../contracts/models.js';
import { project } from '../contracts/codec.js';
import { Context } from './context.js';
import { eq,contains,within,type Filter } from '../infrastructure/repository.js';
import { identifier,text,pagination,year,ServiceError,success } from '../domain/errors.js';
export function examFilters(q:{ano:number|null;orgao:string|null;organizadora:string|null;cargo:string|null}) {
  year(q.ano);const filters:Filter[]=[];
  if(q.ano!==null)filters.push(eq('ano',q.ano));
  for(const key of ['orgao','organizadora','cargo'] as const)if(q[key]?.trim())filters.push(contains(key,text(q[key],key,1,200)));
  return filters;
}
export function examHandlers(ctx:Context, getAttempt:(q:M.ObterTentativaSimuladoRequestModel)=>Promise<M.ApiResponse<M.TentativaSimuladoResponseModel>>) {
  const r=ctx.repo;
  const get=async(q:M.ObterProvaRequestModel)=>{await ctx.user();identifier(q.idProva,'uma prova');return success(await r.one('Prova','ProvaResponseModel',[eq('idProva',q.idProva)],'Prova não encontrada.'),'Prova consultada.');};
  const save=async(q:M.CriarProvaRequestModel,id:string|null)=>{
    await ctx.admin();year(q.ano);const orgao=text(q.orgao,'Órgão',1,200),cargo=q.cargo?.trim()?text(q.cargo,'Cargo',1,200):null;
    identifier(q.idOrganizadora,'uma organizadora');if(!await r.exists('Banca',[eq('idBanca',q.idOrganizadora)]))throw new ServiceError('Organizadora não encontrada.',404);
    const saved=await r.rpc<string>('salvar_prova',{p_idprova:id,p_ano:q.ano,p_orgao:orgao,p_idorganizadora:q.idOrganizadora,p_cargo:cargo,p_composicao_confirmada:q.composicaoConfirmada});return get({idProva:saved});
  };
  return {
    obterProva:get,
    async listarProvas(q:M.ListarProvasRequestModel){await ctx.user();pagination(q.pagina,q.quantidadePorPagina);const page=await r.query('Prova','ProvaResponseModel',{filters:examFilters(q),order:[['ano',true],['orgao'],['idProva']],offset:(q.pagina-1)*q.quantidadePorPagina,limit:q.quantidadePorPagina});return success({...page,pagina:q.pagina,quantidadePorPagina:q.quantidadePorPagina},'Provas consultadas.');},
    async listarTemas(_q:M.ListarTemasRequestModel){await ctx.user();return success({itens:await r.all('Tema','TemaResponseModel',{order:[['nome'],['idTema']]})},'Temas consultados.');},
    criarProva:(q:M.CriarProvaRequestModel)=>save(q,null),
    atualizarProva:(q:M.AtualizarProvaRequestModel)=>{identifier(q.idProva,'uma prova');return save(q,q.idProva);},
    async listarPendenciasProvas(q:M.ListarPendenciasProvasRequestModel){await ctx.admin();pagination(q.pagina,q.quantidadePorPagina);const result=await r.rpcModel('listar_pendencias_provas','ListarPendenciasProvasResponseModel',{p_pagina:q.pagina,p_quantidade:q.quantidadePorPagina});if(!result)throw new ServiceError('Relatório indisponível.',503);return success(result,'Pendências consultadas.');},
    async iniciarProva(q:M.IniciarProvaRequestModel){await ctx.student();identifier(q.idProva,'uma prova');return getAttempt({idTentativa:await r.rpc<string>('iniciar_prova',{p_idprova:q.idProva})});}
  };
}
export async function fillAlternatives(ctx:Context,questions:M.QuestaoPublicaResponseModel[]) {
  const themes=(await ctx.repo.query('Tema','TemaResponseModel',{limit:100})).itens;
  const alternatives=await ctx.repo.all('AlternativaQuestao','AlternativaVinculadaResponseModel',{filters:[within('idQuestao',questions.map(x=>x.idQuestao))],order:[['ordem'],['idAlternativa']]});
  for(const q of questions){q.nomeTema=themes.find(x=>x.idTema===q.idTema)?.nome??null;q.alternativas=alternatives.filter(a=>a.idQuestao===q.idQuestao).map(({idAlternativa,letra,texto,ordem})=>({idAlternativa,letra,texto,ordem}));}
}
export function questionHandlers(ctx:Context) {
  const r=ctx.repo;
  const get=async(q:M.ObterQuestaoRequestModel)=>{
    await ctx.admin();identifier(q.idQuestao,'uma questão');const question=await r.one('Questao','QuestaoPublicaResponseModel',[eq('idQuestao',q.idQuestao)],'Questão não encontrada.');await fillAlternatives(ctx,[question]);
    const gabarito=await r.optional('GabaritoQuestao','GabaritoQuestaoResponseModel',[eq('idQuestao',q.idQuestao)]),explicacao=await r.rpc<string|null>('obter_explicacao_questao',{p_idquestao:q.idQuestao})??'';
    return success({...question,gabarito,explicacao},'Questão consultada.');
  };
  const save=async(q:M.CriarQuestaoRequestModel,id:string|null)=>{
    await ctx.admin();const enunciado=text(q.enunciado,'Enunciado',1,24000);identifier(q.idProva,'uma prova');identifier(q.idTema,'um tema');
    if(q.numero<1)throw new ServiceError('Informe o número original positivo da questão.');
    if(!await r.exists('Prova',[eq('idProva',q.idProva)]))throw new ServiceError('Prova não encontrada.',404);
    if(!await r.exists('Tema',[eq('idTema',q.idTema)]))throw new ServiceError('Tema não encontrado.',404);
    if(!['facil','media','dificil','nao_informada'].includes(q.dificuldade))throw new ServiceError('Dificuldade inválida.');
    if(!['rascunho','publicada','arquivada'].includes(q.status))throw new ServiceError('Status da questão inválido.');
    if(!['provisorio','definitivo','anulada','pendente'].includes(q.statusGabarito))throw new ServiceError('Status do gabarito inválido.');
    if(!q.alternativas||q.alternativas.length<2||q.alternativas.length>10)throw new ServiceError('Informe entre duas e dez alternativas.');
    if(q.alternativas.some(a=>!a.idAlternativa||a.idAlternativa==='00000000-0000-0000-0000-000000000000'||!a.letra?.trim()||a.letra.trim().length!==1||!a.texto?.trim()||a.texto.length>8000))throw new ServiceError('Preencha identificador, letra e texto de cada alternativa.');
    if(['idAlternativa','letra','texto'].some(k=>new Set(q.alternativas.map(a=>a[k as keyof M.AlternativaQuestaoRequestModel].toString().trim().toUpperCase())).size!==q.alternativas.length))throw new ServiceError('Alternativas não podem repetir identificadores, letras ou textos.');
    if(!['anulada','pendente'].includes(q.statusGabarito)&&!q.alternativas.some(a=>a.idAlternativa===q.idAlternativaCorreta))throw new ServiceError('O gabarito deve apontar para uma alternativa da questão.');
    if(id){identifier(id,'uma questão');if(!await r.exists('Questao',[eq('idQuestao',id)]))throw new ServiceError('Questão não encontrada.',404);const composition=await r.all('QuestaoSimulado','ComposicaoSimuladoResponseModel',{filters:[eq('idQuestao',id)]});const ids=composition.map(x=>x.idSimulado);if(await r.exists('Simulado',[within('idSimulado',ids),eq('status','publicado')])||await r.exists('TentativaSimulado',[within('idSimulado',ids)]))throw new ServiceError('Questões vinculadas a simulados publicados ou tentativas não podem ser editadas.',409);}
    const saved=await r.rpc<string>('salvar_questao',{p_idquestao:id,p_questao:{idProva:q.idProva,idTema:q.idTema,numero:q.numero,enunciado,dificuldade:q.dificuldade,fonte:q.fonte.trim(),imagem_url:q.imagemUrl,explicacao:q.explicacao.trim(),status:q.status},p_alternativas:JSON.stringify(q.alternativas.map((a,i)=>({idAlternativa:a.idAlternativa,letra:a.letra.trim().toUpperCase(),texto:a.texto.trim(),ordem:i+1}))),p_gabarito:{idAlternativaCorreta:q.idAlternativaCorreta,status:q.statusGabarito,explicacao:q.explicacao}});
    const result=await get({idQuestao:saved});return success(result.data!,id?'Questão atualizada.':'Questão criada.');
  };
  return {
    obterQuestao:get,criarQuestao:(q:M.CriarQuestaoRequestModel)=>save(q,null),atualizarQuestao:(q:M.AtualizarQuestaoRequestModel)=>save(q,q.idQuestao),
    async listarQuestoes(q:M.ListarQuestoesRequestModel){await ctx.admin();pagination(q.pagina,q.quantidadePorPagina);year(q.ano);const filters:Filter[]=[];
      if(q.busca?.trim())filters.push(contains('enunciado',q.busca));if(q.idTema!==null)filters.push(eq('idTema',q.idTema));if(q.idProva!==null)filters.push(eq('idConcurso',q.idProva));
      if(q.ano!==null||q.orgao?.trim()||q.organizadora?.trim()||q.cargo?.trim()){const exams=await r.all('Prova','ProvaResponseModel',{filters:examFilters(q)});filters.push(within('idConcurso',exams.map(x=>x.idProva)));}
      if(q.dificuldade?.trim())filters.push(eq('dificuldade',q.dificuldade));if(q.status?.trim())filters.push(eq('status',q.status));
      const page=await r.query('Questao','QuestaoPublicaResponseModel',{filters,order:[['criada_em',true],['idQuestao']],offset:(q.pagina-1)*q.quantidadePorPagina,limit:q.quantidadePorPagina});await fillAlternatives(ctx,page.itens);return success({...page,pagina:q.pagina,quantidadePorPagina:q.quantidadePorPagina},'Questões consultadas.');},
    async arquivarQuestao(q:M.ArquivarQuestaoRequestModel){await ctx.admin();identifier(q.idQuestao,'uma questão');await r.mutate('Questao','update',q.idQuestao,{status:'arquivada'});return get(q);}
  };
}
