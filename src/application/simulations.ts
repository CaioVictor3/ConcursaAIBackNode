import type * as M from '../contracts/models.js';
import { Context } from './context.js';
import { eq,within,type Filter } from '../infrastructure/repository.js';
import { identifier,text,pagination,year,ServiceError,success,EMPTY_UUID } from '../domain/errors.js';
import { fillAlternatives } from './exams.js';
import { project } from '../contracts/codec.js';
export function validateThemeQuotas(q:M.CriarSimuladoFiltradoRequestModel) {
  if(q.idTema===EMPTY_UUID)throw new ServiceError('Informe um tema válido.');
  if(!q.cotasTemas||q.cotasTemas.length>25)throw new ServiceError('Informe uma distribuição com até 25 temas.');
  if(q.idTema!==null&&q.cotasTemas.length)throw new ServiceError('Escolha um único tema ou distribua as questões por tema.');
  if(q.cotasTemas.some(c=>!c||c.idTema===EMPTY_UUID||c.quantidade<0||c.quantidade>500))throw new ServiceError('Informe temas válidos e quantidades entre 0 e 500.');
  if(new Set(q.cotasTemas.map(c=>c.idTema)).size!==q.cotasTemas.length)throw new ServiceError('Há temas repetidos na distribuição.');
  if(q.cotasTemas.reduce((n,c)=>n+c.quantidade,0)>q.quantidade)throw new ServiceError('A soma das quantidades por tema excede o total de questões.');
}
export function validateSubjectQuotas(q:M.GerarSimuladoPersonalizadoRequestModel,stock:M.DisponibilidadeAssuntoResponseModel[]) {
  if(q.quantidade<1||q.quantidade>stock.reduce((n,c)=>n+c.quantidade,0))throw new ServiceError('A quantidade solicitada excede o acervo disponível.');
  if(new Set(q.cotasAssuntos.map(c=>c.idAssunto)).size!==q.cotasAssuntos.length)throw new ServiceError('Há assuntos repetidos na distribuição.');
  for(const c of q.cotasAssuntos){const s=stock.find(s=>s.idAssunto===c.idAssunto);if(!s)throw new ServiceError('Assunto indisponível para este treino.');if(c.quantidade<0||c.quantidade>s.quantidade)throw new ServiceError('Uma cota excede a quantidade disponível no assunto.');}
  const sum=q.cotasAssuntos.reduce((n,c)=>n+c.quantidade,0),remaining=stock.filter(s=>!q.cotasAssuntos.some(c=>c.idAssunto===s.idAssunto)).reduce((n,c)=>n+c.quantidade,0);
  if(sum>q.quantidade||q.quantidade-sum>remaining)throw new ServiceError('A distribuição não permite completar o total solicitado.');
}
export function simulationHandlers(ctx:Context) {
  const r=ctx.repo;
  const composition=async(s:M.SimuladoResponseModel)=>{s.idsQuestoes=(await r.all('QuestaoSimulado','ComposicaoSimuladoResponseModel',{filters:[eq('idSimulado',s.idSimulado)],order:[['ordem'],['idSimuladoQuestao']]})).map(x=>x.idQuestao);return s;};
  const get=async(q:M.ObterSimuladoRequestModel)=>{const u=await ctx.user();identifier(q.idSimulado,'um simulado');const filters=[eq('idSimulado',q.idSimulado)];if(u.tipo!=='administrador')filters.push(eq('status','publicado'));const s=await r.one('Simulado','SimuladoResponseModel',filters,'Simulado não encontrado.',[eq('publico',true),eq('idPessoaCriadora',u.idPessoa)]);return success(await composition(s),'Simulado consultado.');};
  const save=async(q:M.CriarSimuladoRequestModel,id:string|null)=>{
    await ctx.admin();const nome=text(q.nome,'Nome',3,200);
    if(!q.idsQuestoes?.length||q.idsQuestoes.includes(EMPTY_UUID)||new Set(q.idsQuestoes).size!==q.idsQuestoes.length)throw new ServiceError('Informe questões sem repetições.');
    if(!['rascunho','publicado','arquivado'].includes(q.status)||!['padrao','personalizado'].includes(q.tipo))throw new ServiceError('Tipo ou status de simulado inválido.');
    if(q.duracaoMinutos!==null&&q.duracaoMinutos<=0)throw new ServiceError('A duração deve ser positiva.');
    if((await r.query('Questao','QuestaoPublicaResponseModel',{filters:[within('idQuestao',q.idsQuestoes),eq('status','publicada')],limit:1})).total!==q.idsQuestoes.length)throw new ServiceError('Todas as questões devem estar publicadas.');
    if(q.idConcurso!==null&&!await r.exists('Concurso',[eq('idConcurso',q.idConcurso)]))throw new ServiceError('Concurso não encontrado.',404);
    if(id){identifier(id,'um simulado');if(!await r.exists('Simulado',[eq('idSimulado',id)]))throw new ServiceError('Simulado não encontrado.',404);if(await r.exists('TentativaSimulado',[eq('idSimulado',id)]))throw new ServiceError('Simulados com tentativas não podem ser editados.',409);}
    const saved=await r.rpc<string>('salvar_simulado',{p_idsimulado:id,p_idsquestoes:q.idsQuestoes,p_simulado:{nome,descricao:q.descricao?.trim()??'',idConcurso:q.idConcurso,duracao_minutos:q.duracaoMinutos,tipo:q.tipo,publico:q.publico,status:q.status}});return get({idSimulado:saved});
  };
  const availability=async(_q:M.ObterDisponibilidadeAssuntosRequestModel)=>{await ctx.student();const raw=await r.rpc<unknown[]>('disponibilidade_assuntos_odonto',{},true);const itens=raw.map(x=>project('DisponibilidadeAssuntoResponseModel',x));return success({itens,totalQuestoes:itens.reduce((n,c)=>n+c.quantidade,0)},'Disponibilidade consultada.');};
  const generated=async(id:string,message:string)=>{const u=await ctx.student();const t=await r.one('TentativaSimulado','TentativaSimuladoResponseModel',[eq('idTentativa',id),eq('idPessoa',u.idPessoa)],'Tentativa não encontrada.');return success({idTentativa:id,idSimulado:t.idSimulado},message);};
  return {
    obterSimulado:get,criarSimulado:(q:M.CriarSimuladoRequestModel)=>save(q,null),atualizarSimulado:(q:M.AtualizarSimuladoRequestModel)=>save(q,q.idSimulado),obterDisponibilidadeAssuntos:availability,
    async listarSimulados(q:M.ListarSimuladosRequestModel){const u=await ctx.user();pagination(q.pagina,q.quantidadePorPagina);const filters:Filter[]=[];if(u.tipo!=='administrador')filters.push(eq('status','publicado'));if(q.somentePublicos)filters.push(eq('publico',true),eq('status','publicado'));const page=await r.query('Simulado','SimuladoResponseModel',{filters,or:[eq('publico',true),eq('idPessoaCriadora',u.idPessoa)],order:[['criado_em',true],['idSimulado']],offset:(q.pagina-1)*q.quantidadePorPagina,limit:q.quantidadePorPagina});const rows=await r.all('QuestaoSimulado','ComposicaoSimuladoResponseModel',{filters:[within('idSimulado',page.itens.map(s=>s.idSimulado))],order:[['ordem'],['idSimuladoQuestao']]});for(const s of page.itens)s.idsQuestoes=rows.filter(x=>x.idSimulado===s.idSimulado).map(x=>x.idQuestao);return success({...page,pagina:q.pagina,quantidadePorPagina:q.quantidadePorPagina},'Simulados consultados.');},
    async criarSimuladoFiltrado(q:M.CriarSimuladoFiltradoRequestModel){await ctx.student();const nome=text(q.nome,'Nome',3,200);if(q.quantidade<1||q.quantidade>500)throw new ServiceError('Informe entre 1 e 500 questões.');validateThemeQuotas(q);year(q.ano);for(const t of [q.orgao,q.organizadora,q.cargo])if(t&&t.trim().length>200)throw new ServiceError('Filtros devem ter até 200 caracteres.');const id=await r.rpc<string>('criar_simulado_filtrado',{p_nome:nome,p_quantidade:q.quantidade,p_idtema:q.idTema,p_ano:q.ano,p_orgao:q.orgao?.trim()??null,p_organizadora:q.organizadora?.trim()??null,p_cargo:q.cargo?.trim()??null,p_cotas_temas:JSON.stringify(q.cotasTemas)});return generated(id,'Simulado criado.');},
    async gerarSimuladoPersonalizado(q:M.GerarSimuladoPersonalizadoRequestModel){await ctx.student();if(q.quantidade<1)throw new ServiceError('Informe pelo menos uma questão.');if(!q.cotasAssuntos)throw new ServiceError('Informe a distribuição por assuntos ou uma lista vazia.');const stock=(await availability({})).data!.itens;validateSubjectQuotas(q,stock);return generated(await r.rpc<string>('gerar_simulado_odonto',{p_quantidade:q.quantidade,p_assuntos:JSON.stringify(q.cotasAssuntos)}),'Simulado gerado.');},
    generated
  };
}
export function attemptHandlers(ctx:Context,sim:ReturnType<typeof simulationHandlers>) {
  const r=ctx.repo;
  const origins=async(items:M.TentativaSimuladoResponseModel[])=>{
    if(!items.length)return;
    const simulations=await r.all('Simulado','SimuladoResponseModel',{filters:[within('idSimulado',[...new Set(items.map(x=>x.idSimulado))])]});
    for(const t of items){const s=simulations.find(x=>x.idSimulado===t.idSimulado);if(s){t.nomeSimulado=s.nome;t.tipoOrigem=s.tipo;t.idProva=s.tipo==='prova'?s.idConcurso:null;}}
  };
  const get=async(q:M.ObterTentativaSimuladoRequestModel)=>{const u=await ctx.student();identifier(q.idTentativa,'uma tentativa');const t=await r.one('TentativaSimulado','TentativaSimuladoResponseModel',[eq('idTentativa',q.idTentativa),eq('idPessoa',u.idPessoa)],'Tentativa não encontrada.');t.respostas=await r.all('RespostaTentativaSimulado','RespostaTentativaResponseModel',{filters:[eq('idTentativa',q.idTentativa)]});await origins([t]);return success(t,'Tentativa consultada.');};
  const questions=async(q:M.ObterQuestoesTentativaRequestModel)=>{const t=(await get(q)).data!;const ids=(await r.all('QuestaoSimulado','ComposicaoSimuladoResponseModel',{filters:[eq('idSimulado',t.idSimulado)],order:[['ordem'],['idSimuladoQuestao']]})).map(x=>x.idQuestao);const qs=await r.all('Questao','QuestaoPublicaResponseModel',{filters:[within('idQuestao',ids)]});await fillAlternatives(ctx,qs);return success({itens:ids.map(id=>{const q=qs.find(x=>x.idQuestao===id);if(!q)throw new ServiceError('Questão não encontrada.',404);return q;})},'Questões da tentativa consultadas.');};
  const result=async(q:M.ObterResultadoTentativaRequestModel)=>{const t=(await get(q)).data!;if(t.status!=='finalizada')throw new ServiceError('O gabarito estará disponível após finalizar o simulado.',409);const correction=await r.rpcModel('obter_resultado_tentativa','CorrecaoBancoResponseModel',{p_idtentativa:q.idTentativa});if(!correction)throw new ServiceError('Correção indisponível.',404);const qs=(await questions(q)).data!.itens,s=(await sim.obterSimulado({idSimulado:t.idSimulado})).data!;return success({tentativa:t,simulado:s,itens:correction.itens.map(c=>({questao:qs.find(x=>x.idQuestao===c.idQuestao)!,idAlternativaSelecionada:c.idAlternativaSelecionada,idAlternativaCorreta:c.idAlternativaCorreta,anulada:c.anulada,semGabarito:c.semGabarito,acertou:c.acertou,explicacao:c.explicacao}))},'Resultado consultado.');};
  return {
    obterTentativaSimulado:get,obterQuestoesTentativa:questions,obterResultadoTentativa:result,
    async iniciarTentativaSimulado(q:M.IniciarTentativaSimuladoRequestModel){await ctx.student();identifier(q.idSimulado,'um simulado');const s=(await sim.obterSimulado(q)).data!;if(s.status!=='publicado'||!s.idsQuestoes.length)throw new ServiceError('Simulado indisponível para iniciar.');return get({idTentativa:await r.rpc<string>('iniciar_tentativa',{p_idsimulado:q.idSimulado})});},
    async responderQuestaoSimulado(q:M.ResponderQuestaoSimuladoRequestModel){const t=(await get(q)).data!;if(t.status!=='em_andamento')throw new ServiceError('Uma tentativa finalizada não pode receber respostas.',409);identifier(q.idQuestao,'uma questão');if(!await r.exists('QuestaoSimulado',[eq('idSimulado',t.idSimulado),eq('idQuestao',q.idQuestao)]))throw new ServiceError('A questão não pertence a este simulado.');if(q.idAlternativaSelecionada!==null&&!await r.exists('AlternativaQuestao',[eq('idQuestao',q.idQuestao),eq('idAlternativa',q.idAlternativaSelecionada)]))throw new ServiceError('A alternativa não pertence a esta questão.');await r.rpc('responder_questao',{p_idtentativa:q.idTentativa,p_idquestao:q.idQuestao,p_idalternativa:q.idAlternativaSelecionada});return get(q);},
    async finalizarTentativaSimulado(q:M.FinalizarTentativaSimuladoRequestModel){const t=(await get(q)).data!;if(t.status!=='em_andamento')throw new ServiceError('Esta tentativa já foi finalizada.',409);await r.rpc('finalizar_tentativa',{p_idtentativa:q.idTentativa});return result(q);},
    async listarMinhasTentativas(q:M.ListarMinhasTentativasRequestModel){const u=await ctx.student();pagination(q.pagina,q.quantidadePorPagina);const page=await r.query('TentativaSimulado','TentativaSimuladoResponseModel',{filters:[eq('idPessoa',u.idPessoa)],order:[['iniciada_em',true],['idTentativa']],offset:(q.pagina-1)*q.quantidadePorPagina,limit:q.quantidadePorPagina});const responses=await r.all('RespostaTentativaSimulado','RespostaTentativaVinculadaResponseModel',{filters:[within('idTentativa',page.itens.map(x=>x.idTentativa))]});for(const t of page.itens)t.respostas=responses.filter(x=>x.idTentativa===t.idTentativa).map(({idQuestao,idAlternativaSelecionada,dataHoraResposta})=>({idQuestao,idAlternativaSelecionada,dataHoraResposta}));await origins(page.itens);return success({...page,pagina:q.pagina,quantidadePorPagina:q.quantidadePorPagina},'Histórico consultado.');}
  };
}
export function studyHandlers(ctx:Context,sim:ReturnType<typeof simulationHandlers>) {
  const r=ctx.repo;
  const summary=async(_q:M.ObterResumoRevisaoRequestModel)=>{await ctx.student();const result=await r.rpcModel('resumo_revisao_odonto','ResumoRevisaoResponseModel');if(!result)throw new ServiceError('Não foi possível consultar sua revisão.',503);return success(result,'Resumo de revisão consultado.');};
  const goal=async(_q:M.ObterMetaSemanalRequestModel)=>{await ctx.student();const result=await r.rpcModel('progresso_meta_semanal','MetaSemanalResponseModel');if(!result)throw new ServiceError('Não foi possível consultar sua meta.',503);return success(result,'Meta semanal consultada.');};
  const training=async(quantity:number,mode:string)=>{await ctx.student();if(quantity<1)throw new ServiceError('Informe pelo menos uma questão.');const available=mode==='revisao'?(await summary({})).data!.pendentes:(await sim.obterDisponibilidadeAssuntos({})).data!.totalQuestoes;if(quantity>available)throw new ServiceError(`Há apenas ${available} questões disponíveis para este treino.`);return sim.generated(await r.rpc<string>('gerar_treino_odonto',{p_quantidade:quantity,p_modo:mode}),'Treino preparado.');};
  return {obterResumoRevisao:summary,obterMetaSemanal:goal,
    async listarQuestoesRevisao(q:M.ListarQuestoesRevisaoRequestModel){await ctx.student();pagination(q.pagina,5);const result=await r.rpcModel('listar_questoes_revisao','ListarQuestoesRevisaoResponseModel',{p_pagina:q.pagina});if(!result)throw new ServiceError('Não foi possível consultar as questões de revisão.',503);return success(result,'Questões de revisão consultadas.');},
    gerarTreinoRevisao:(q:M.GerarTreinoRevisaoRequestModel)=>training(q.quantidade,'revisao'),gerarTreinoRecomendado:(q:M.GerarTreinoRecomendadoRequestModel)=>training(q.quantidade,'recomendado'),
    async obterEstatisticasAssuntos(_q:M.ObterEstatisticasAssuntosRequestModel){await ctx.student();const raw=await r.rpc<unknown[]>('estatisticas_assuntos',{},true);return success({itens:raw.map(x=>project('EstatisticaAssuntoResponseModel',x))},'Desempenho por assunto consultado.');},
    async salvarMetaSemanal(q:M.SalvarMetaSemanalRequestModel){await ctx.student();if(q.quantidadeSemanal<1||q.quantidadeSemanal>2000)throw new ServiceError('Defina uma meta entre 1 e 2.000 questões por semana.');await r.rpc('salvar_meta_semanal',{p_quantidade:q.quantidadeSemanal});return goal({});}
  };
}
