import type * as ContratosApi from "../contracts/modelos-requisicoes-respostas-api.js";
import { projetarRespostaPeloContrato } from "../contracts/validacao-conversao-contratos-api.js";
import {
  ErroRegraNegocioHttp,
  criarRespostaSucesso,
  validarIdentificador,
} from "../domain/erros-validacoes-respostas-api.js";
import { ClienteAnaliseQuestoesOpenAI } from "../infrastructure/cliente-analise-questoes-openai.js";
import { criarFiltroIgualdade } from "../infrastructure/repositorio-consultas-postgresql.js";
import { ServicoAutorizacaoUsuarioAutenticado } from "./autorizacao-usuario-autenticado.js";
import type { operacoesResolucaoCorrecaoTentativas } from "./resolucao-correcao-tentativas.service.js";

export function operacoesAnaliseQuestoesInteligenciaArtificial(
  contextoAutorizacao: ServicoAutorizacaoUsuarioAutenticado,
  operacoesTentativa: ReturnType<typeof operacoesResolucaoCorrecaoTentativas>,
  provider: ClienteAnaliseQuestoesOpenAI,
  sinalCancelamento?: AbortSignal,
) {
  const repositorioNegocio = contextoAutorizacao.repo;

  const validate = async (
    solicitacaoConsultarAnaliseQuestao: ContratosApi.ConsultarAnaliseQuestaoRequestModel,
  ) => {
    await contextoAutorizacao.exigirEstudanteComCadastroCompleto();

    validarIdentificador(solicitacaoConsultarAnaliseQuestao.idQuestao, "uma questão");

    const tentativaSimulado = (
      await operacoesTentativa.obterTentativaSimulado(solicitacaoConsultarAnaliseQuestao)
    ).data!;

    if (tentativaSimulado.status !== "finalizada") {
      throw new ErroRegraNegocioHttp("Finalize o simulado antes de solicitar uma análise.", 409);
    }

    const correction = await repositorioNegocio.executarFuncaoPostgreSqlComContrato(
      "obter_resultado_tentativa",
      "CorrecaoBancoResponseModel",
      {
        p_idtentativa: solicitacaoConsultarAnaliseQuestao.idTentativa,
      },
    );

    const question = correction?.itens.find(
      (questaoAtual) => questaoAtual.idQuestao === solicitacaoConsultarAnaliseQuestao.idQuestao,
    );

    if (!question) {
      throw new ErroRegraNegocioHttp("A questão não pertence à sua tentativa.", 404);
    }

    if (
      question.acertou ||
      question.anulada ||
      !question.idAlternativaSelecionada ||
      !question.idAlternativaCorreta
    ) {
      throw new ErroRegraNegocioHttp(
        "A análise está disponível para respostas incorretas com gabarito válido.",
      );
    }
  };

  const content = async (
    identificadorRegistro: string,
    analiseQuestao: ContratosApi.AnaliseQuestaoResponseModel,
  ) => {
    const questao = analiseQuestao.conteudo;

    if (
      analiseQuestao.demonstracao ||
      !questao?.resumo?.trim() ||
      !questao.respostaMarcada?.trim() ||
      !questao.respostaCorreta?.trim() ||
      !questao.pontosRevisao ||
      questao.pontosRevisao.length < 1 ||
      questao.pontosRevisao.length > 5 ||
      questao.pontosRevisao.some(
        (pontoRevisao) => !pontoRevisao?.trim() || pontoRevisao.length > 1500,
      ) ||
      !analiseQuestao.modelo?.trim() ||
      !analiseQuestao.geradaEm ||
      analiseQuestao.geradaEm.startsWith("0001-") ||
      !questao.alternativas
    ) {
      throw new ErroRegraNegocioHttp("A análise recebida está incompleta.", 502);
    }

    const identificadoresRegistros = (
      await repositorioNegocio.listarRegistros(
        "AlternativaQuestao",
        "AlternativaVinculadaResponseModel",
        {
          filters: [criarFiltroIgualdade("idQuestao", identificadorRegistro)],
        },
      )
    ).map((alternativaQuestao) => alternativaQuestao.idAlternativa);

    if (
      questao.alternativas.length !== identificadoresRegistros.length ||
      new Set(questao.alternativas.map((alternativaQuestao) => alternativaQuestao.idAlternativa))
        .size !== identificadoresRegistros.length ||
      questao.alternativas.some(
        (alternativaQuestao) =>
          !identificadoresRegistros.includes(alternativaQuestao.idAlternativa) ||
          !alternativaQuestao.justificativa?.trim() ||
          alternativaQuestao.justificativa.length > 6000,
      )
    ) {
      throw new ErroRegraNegocioHttp(
        "A análise deve justificar todas as alternativas da questão.",
        502,
      );
    }
  };

  const consult = async (
    solicitacaoConsultarAnaliseQuestao: ContratosApi.ConsultarAnaliseQuestaoRequestModel,
  ) => {
    await validate(solicitacaoConsultarAnaliseQuestao);

    const analiseQuestao = await repositorioNegocio.executarFuncaoPostgreSqlComContrato(
      "consultar_analise_questao",
      "AnaliseQuestaoResponseModel",
      {
        p_idtentativa: solicitacaoConsultarAnaliseQuestao.idTentativa,
        p_idquestao: solicitacaoConsultarAnaliseQuestao.idQuestao,
      },
    );

    if (analiseQuestao) {
      await content(solicitacaoConsultarAnaliseQuestao.idQuestao, analiseQuestao);
    }

    return criarRespostaSucesso(
      { disponivel: !!analiseQuestao, analise: analiseQuestao },
      "Consulta de análise concluída.",
    );
  };

  return {
    consultarAnaliseQuestao: consult,

    async solicitarAnaliseQuestao(
      solicitacaoSolicitarAnaliseQuestao: ContratosApi.SolicitarAnaliseQuestaoRequestModel,
    ) {
      const cached = (await consult(solicitacaoSolicitarAnaliseQuestao)).data!.analise;

      if (cached) {
        return criarRespostaSucesso(cached, "Análise salva consultada, sem nova geração.");
      }

      provider.exigirConfiguracaoOpenAI();

      const reservation = await repositorioNegocio.executarFuncaoPostgreSql<{
        analise?: unknown;
        idSolicitacao: string;
        contexto: Record<string, unknown>;
      }>("reservar_analise_backend", {
        p_idtentativa: solicitacaoSolicitarAnaliseQuestao.idTentativa,
        p_idquestao: solicitacaoSolicitarAnaliseQuestao.idQuestao,
      });

      if (reservation.analise) {
        const analiseQuestao = projetarRespostaPeloContrato(
          "AnaliseQuestaoResponseModel",
          reservation.analise,
        );

        await content(solicitacaoSolicitarAnaliseQuestao.idQuestao, analiseQuestao);

        return criarRespostaSucesso(analiseQuestao, "Análise salva consultada.");
      }

      const registrarResultadoGeracaoAnalise = (geracaoFalhou: boolean, conteudoAnalise: unknown) =>
        repositorioNegocio.executarFuncaoPostgreSql<boolean>("salvar_analise_backend", {
          p_idquestao: solicitacaoSolicitarAnaliseQuestao.idQuestao,
          p_idsolicitacao: reservation.idSolicitacao,
          p_conteudo: conteudoAnalise,
          p_modelo: provider.config.openai.model,
          p_falhou: geracaoFalhou,
        });

      try {
        const conteudoGeradoOpenAI = await provider.gerarAnaliseQuestaoOpenAI(
          reservation.contexto,
          sinalCancelamento,
        );

        const analiseQuestao = projetarRespostaPeloContrato("AnaliseQuestaoResponseModel", {
          conteudo: conteudoGeradoOpenAI,
          modelo: provider.config.openai.model,
          geradaEm: new Date().toISOString(),
          demonstracao: false,
        });

        await content(solicitacaoSolicitarAnaliseQuestao.idQuestao, analiseQuestao);

        if (!(await registrarResultadoGeracaoAnalise(false, conteudoGeradoOpenAI))) {
          throw new ErroRegraNegocioHttp(
            "Não foi possível salvar a análise. Consulte novamente.",
            409,
          );
        }

        return criarRespostaSucesso(analiseQuestao, "Análise concluída e salva.");
      } catch (erroCapturado) {
        await registrarResultadoGeracaoAnalise(true, null).catch(() => undefined);

        if (
          erroCapturado instanceof SyntaxError ||
          erroCapturado instanceof TypeError ||
          (erroCapturado instanceof ErroRegraNegocioHttp && erroCapturado.status === 400)
        ) {
          throw new ErroRegraNegocioHttp(
            "A IA retornou uma análise incompatível com a questão.",
            502,
          );
        }

        throw erroCapturado;
      }
    },
  };
}
