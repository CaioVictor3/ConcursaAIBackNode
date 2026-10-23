import type * as ContratosApi from "../contracts/modelos-requisicoes-respostas-api.js";
import { projetarRespostaPeloContrato } from "../contracts/validacao-conversao-contratos-api.js";
import {
  criarRespostaSucesso,
  ErroRegraNegocioHttp,
  validarPaginacao,
} from "../domain/erros-validacoes-respostas-api.js";
import { ServicoAutorizacaoUsuarioAutenticado } from "./autorizacao-usuario-autenticado.js";
import { operacoesGeracaoCadastroSimulados } from "./geracao-cadastro-simulados.service.js";

export function operacoesRevisaoQuestoesMetasEstudo(
  contextoAutorizacao: ServicoAutorizacaoUsuarioAutenticado,
  operacoesSimulado: ReturnType<typeof operacoesGeracaoCadastroSimulados>,
) {
  const repositorioNegocio = contextoAutorizacao.repo;

  const summary = async (
    solicitacaoStudyHandlersNaoUtilizada: ContratosApi.ObterResumoRevisaoRequestModel,
  ) => {
    await contextoAutorizacao.exigirEstudanteComCadastroCompleto();

    const resumoRevisao = await repositorioNegocio.executarFuncaoPostgreSqlComContrato(
      "resumo_revisao_odonto",
      "ResumoRevisaoResponseModel",
    );

    if (!resumoRevisao) {
      throw new ErroRegraNegocioHttp("Não foi possível consultar sua revisão.", 503);
    }

    return criarRespostaSucesso(resumoRevisao, "Resumo de revisão consultado.");
  };

  const goal = async (
    solicitacaoStudyHandlersNaoUtilizada: ContratosApi.ObterMetaSemanalRequestModel,
  ) => {
    await contextoAutorizacao.exigirEstudanteComCadastroCompleto();

    const metaSemanal = await repositorioNegocio.executarFuncaoPostgreSqlComContrato(
      "progresso_meta_semanal",
      "MetaSemanalResponseModel",
    );

    if (!metaSemanal) {
      throw new ErroRegraNegocioHttp("Não foi possível consultar sua meta.", 503);
    }

    return criarRespostaSucesso(metaSemanal, "Meta semanal consultada.");
  };

  const training = async (quantity: number, mode: string) => {
    await contextoAutorizacao.exigirEstudanteComCadastroCompleto();

    if (quantity < 1) {
      throw new ErroRegraNegocioHttp("Informe pelo menos uma questão.");
    }

    const available =
      mode === "revisao"
        ? (await summary({})).data!.pendentes
        : (await operacoesSimulado.obterDisponibilidadeAssuntos({})).data!.totalQuestoes;

    if (quantity > available) {
      throw new ErroRegraNegocioHttp(
        `Há apenas ${available} questões disponíveis para este treino.`,
      );
    }

    return operacoesSimulado.generated(
      await repositorioNegocio.executarFuncaoPostgreSql<string>("gerar_treino_odonto", {
        p_quantidade: quantity,
        p_modo: mode,
      }),
      "Treino preparado.",
    );
  };

  return {
    obterResumoRevisao: summary,

    obterMetaSemanal: goal,

    async listarQuestoesRevisao(
      solicitacaoListarQuestoesRevisao: ContratosApi.ListarQuestoesRevisaoRequestModel,
    ) {
      await contextoAutorizacao.exigirEstudanteComCadastroCompleto();

      validarPaginacao(solicitacaoListarQuestoesRevisao.pagina, 5);

      const estatisticasAssuntos = await repositorioNegocio.executarFuncaoPostgreSqlComContrato(
        "listar_questoes_revisao",
        "ListarQuestoesRevisaoResponseModel",
        { p_pagina: solicitacaoListarQuestoesRevisao.pagina },
      );

      if (!estatisticasAssuntos) {
        throw new ErroRegraNegocioHttp("Não foi possível consultar as questões de revisão.", 503);
      }

      return criarRespostaSucesso(estatisticasAssuntos, "Questões de revisão consultadas.");
    },

    gerarTreinoRevisao: (
      solicitacaoGerarTreinoRevisao: ContratosApi.GerarTreinoRevisaoRequestModel,
    ) => training(solicitacaoGerarTreinoRevisao.quantidade, "revisao"),

    gerarTreinoRecomendado: (
      solicitacaoGerarTreinoRecomendado: ContratosApi.GerarTreinoRecomendadoRequestModel,
    ) => training(solicitacaoGerarTreinoRecomendado.quantidade, "recomendado"),

    async obterEstatisticasAssuntos(
      solicitacaoObterEstatisticasAssuntosNaoUtilizada: ContratosApi.ObterEstatisticasAssuntosRequestModel,
    ) {
      await contextoAutorizacao.exigirEstudanteComCadastroCompleto();

      const dadosBrutosBanco = await repositorioNegocio.executarFuncaoPostgreSql<unknown[]>(
        "estatisticas_assuntos",
        {},
        true,
      );

      return criarRespostaSucesso(
        {
          itens: dadosBrutosBanco.map((questaoAtual) =>
            projetarRespostaPeloContrato("EstatisticaAssuntoResponseModel", questaoAtual),
          ),
        },
        "Desempenho por assunto consultado.",
      );
    },

    async salvarMetaSemanal(
      solicitacaoSalvarMetaSemanal: ContratosApi.SalvarMetaSemanalRequestModel,
    ) {
      await contextoAutorizacao.exigirEstudanteComCadastroCompleto();

      if (
        solicitacaoSalvarMetaSemanal.quantidadeSemanal < 1 ||
        solicitacaoSalvarMetaSemanal.quantidadeSemanal > 2000
      ) {
        throw new ErroRegraNegocioHttp("Defina uma meta entre 1 e 2.000 questões por semana.");
      }

      await repositorioNegocio.executarFuncaoPostgreSql("salvar_meta_semanal", {
        p_quantidade: solicitacaoSalvarMetaSemanal.quantidadeSemanal,
      });

      return goal({});
    },
  };
}
