import type * as ContratosApi from "../contracts/modelos-requisicoes-respostas-api.js";
import {
  criarRespostaSucesso,
  ErroRegraNegocioHttp,
  validarIdentificador,
  validarPaginacao,
} from "../domain/erros-validacoes-respostas-api.js";
import {
  criarFiltroIgualdade,
  criarFiltroValorDentroLista,
} from "../infrastructure/repositorio-consultas-postgresql.js";
import { ServicoAutorizacaoUsuarioAutenticado } from "./autorizacao-usuario-autenticado.js";
import { preencherAlternativasQuestoes } from "./cadastro-questoes-alternativas-gabaritos.service.js";
import { operacoesGeracaoCadastroSimulados } from "./geracao-cadastro-simulados.service.js";

export function operacoesResolucaoCorrecaoTentativas(
  contextoAutorizacao: ServicoAutorizacaoUsuarioAutenticado,
  operacoesSimulado: ReturnType<typeof operacoesGeracaoCadastroSimulados>,
) {
  const repositorioNegocio = contextoAutorizacao.repo;

  const origins = async (items: ContratosApi.TentativaSimuladoResponseModel[]) => {
    if (!items.length) {
      return;
    }

    const simulations = await repositorioNegocio.listarRegistros(
      "Simulado",
      "SimuladoResponseModel",
      {
        filters: [
          criarFiltroValorDentroLista("idSimulado", [
            ...new Set(items.map((tentativaSimulado) => tentativaSimulado.idSimulado)),
          ]),
        ],
      },
    );

    for (const tentativaSimulado of items) {
      const simulado = simulations.find(
        (simuladoCandidato) => simuladoCandidato.idSimulado === tentativaSimulado.idSimulado,
      );

      if (simulado) {
        tentativaSimulado.nomeSimulado = simulado.nome;

        tentativaSimulado.tipoOrigem = simulado.tipo;

        tentativaSimulado.idProva = simulado.tipo === "prova" ? simulado.idConcurso : null;
      }
    }
  };

  const obterAttempt = async (
    solicitacaoObterTentativaSimulado: ContratosApi.ObterTentativaSimuladoRequestModel,
  ) => {
    const usuarioAutenticado = await contextoAutorizacao.exigirEstudanteComCadastroCompleto();

    validarIdentificador(solicitacaoObterTentativaSimulado.idTentativa, "uma tentativa");

    const tentativaSimulado = await repositorioNegocio.obterRegistroObrigatorio(
      "TentativaSimulado",
      "TentativaSimuladoResponseModel",
      [
        criarFiltroIgualdade("idTentativa", solicitacaoObterTentativaSimulado.idTentativa),
        criarFiltroIgualdade("idPessoa", usuarioAutenticado.idPessoa),
      ],
      "Tentativa não encontrada.",
    );

    tentativaSimulado.respostas = await repositorioNegocio.listarRegistros(
      "RespostaTentativaSimulado",
      "RespostaTentativaResponseModel",
      {
        filters: [
          criarFiltroIgualdade("idTentativa", solicitacaoObterTentativaSimulado.idTentativa),
        ],
      },
    );

    await origins([tentativaSimulado]);

    return criarRespostaSucesso(tentativaSimulado, "Tentativa consultada.");
  };

  const questions = async (
    solicitacaoObterQuestoesTentativa: ContratosApi.ObterQuestoesTentativaRequestModel,
  ) => {
    const tentativaSimulado = (await obterAttempt(solicitacaoObterQuestoesTentativa)).data!;

    const identificadoresRegistros = (
      await repositorioNegocio.listarRegistros(
        "QuestaoSimulado",
        "ComposicaoSimuladoResponseModel",
        {
          filters: [criarFiltroIgualdade("idSimulado", tentativaSimulado.idSimulado)],
          order: [["ordem"], ["idSimuladoQuestao"]],
        },
      )
    ).map((simulado) => simulado.idQuestao);

    const questoesTentativa = await repositorioNegocio.listarRegistros(
      "Questao",
      "QuestaoPublicaResponseModel",
      {
        filters: [criarFiltroValorDentroLista("idQuestao", identificadoresRegistros)],
      },
    );

    await preencherAlternativasQuestoes(contextoAutorizacao, questoesTentativa);

    return criarRespostaSucesso(
      {
        itens: identificadoresRegistros.map((identificadorTentativa) => {
          const questao = questoesTentativa.find(
            (questaoCandidata) => questaoCandidata.idQuestao === identificadorTentativa,
          );

          if (!questao) {
            throw new ErroRegraNegocioHttp("Questão não encontrada.", 404);
          }

          return questao;
        }),
      },
      "Questões da tentativa consultadas.",
    );
  };

  const obterResultadoTentativaCorrigido = async (
    solicitacaoObterResultadoTentativa: ContratosApi.ObterResultadoTentativaRequestModel,
  ) => {
    const tentativaSimulado = (await obterAttempt(solicitacaoObterResultadoTentativa)).data!;

    if (tentativaSimulado.status !== "finalizada") {
      throw new ErroRegraNegocioHttp(
        "O gabarito estará disponível após finalizar o simulado.",
        409,
      );
    }

    const correction = await repositorioNegocio.executarFuncaoPostgreSqlComContrato(
      "obter_resultado_tentativa",
      "CorrecaoBancoResponseModel",
      {
        p_idtentativa: solicitacaoObterResultadoTentativa.idTentativa,
      },
    );

    if (!correction) {
      throw new ErroRegraNegocioHttp("Correção indisponível.", 404);
    }

    const questoesTentativa = (await questions(solicitacaoObterResultadoTentativa)).data!.itens;

    const simulado = (
      await operacoesSimulado.obterSimulado({ idSimulado: tentativaSimulado.idSimulado })
    ).data!;

    return criarRespostaSucesso(
      {
        tentativa: tentativaSimulado,
        simulado: simulado,
        itens: correction.itens.map((registroAtual) => ({
          questao: questoesTentativa.find(
            (questao) => questao.idQuestao === registroAtual.idQuestao,
          )!,
          idAlternativaSelecionada: registroAtual.idAlternativaSelecionada,
          idAlternativaCorreta: registroAtual.idAlternativaCorreta,
          anulada: registroAtual.anulada,
          semGabarito: registroAtual.semGabarito,
          acertou: registroAtual.acertou,
          explicacao: registroAtual.explicacao,
        })),
      },
      "Resultado consultado.",
    );
  };

  return {
    obterTentativaSimulado: obterAttempt,

    obterQuestoesTentativa: questions,

    obterResultadoTentativa: obterResultadoTentativaCorrigido,

    async iniciarTentativaSimulado(
      solicitacaoIniciarTentativaSimulado: ContratosApi.IniciarTentativaSimuladoRequestModel,
    ) {
      await contextoAutorizacao.exigirEstudanteComCadastroCompleto();

      validarIdentificador(solicitacaoIniciarTentativaSimulado.idSimulado, "um simulado");

      const simulado = (await operacoesSimulado.obterSimulado(solicitacaoIniciarTentativaSimulado))
        .data!;

      if (simulado.status !== "publicado" || !simulado.idsQuestoes.length) {
        throw new ErroRegraNegocioHttp("Simulado indisponível para iniciar.");
      }

      return obterAttempt({
        idTentativa: await repositorioNegocio.executarFuncaoPostgreSql<string>(
          "iniciar_tentativa",
          {
            p_idsimulado: solicitacaoIniciarTentativaSimulado.idSimulado,
          },
        ),
      });
    },

    async responderQuestaoSimulado(
      solicitacaoResponderQuestaoSimulado: ContratosApi.ResponderQuestaoSimuladoRequestModel,
    ) {
      const tentativaSimulado = (await obterAttempt(solicitacaoResponderQuestaoSimulado)).data!;

      if (tentativaSimulado.status !== "em_andamento") {
        throw new ErroRegraNegocioHttp("Uma tentativa finalizada não pode receber respostas.", 409);
      }

      validarIdentificador(solicitacaoResponderQuestaoSimulado.idQuestao, "uma questão");

      if (
        !(await repositorioNegocio.existeRegistro("QuestaoSimulado", [
          criarFiltroIgualdade("idSimulado", tentativaSimulado.idSimulado),
          criarFiltroIgualdade("idQuestao", solicitacaoResponderQuestaoSimulado.idQuestao),
        ]))
      ) {
        throw new ErroRegraNegocioHttp("A questão não pertence a este simulado.");
      }

      if (
        solicitacaoResponderQuestaoSimulado.idAlternativaSelecionada !== null &&
        !(await repositorioNegocio.existeRegistro("AlternativaQuestao", [
          criarFiltroIgualdade("idQuestao", solicitacaoResponderQuestaoSimulado.idQuestao),
          criarFiltroIgualdade(
            "idAlternativa",
            solicitacaoResponderQuestaoSimulado.idAlternativaSelecionada,
          ),
        ]))
      ) {
        throw new ErroRegraNegocioHttp("A alternativa não pertence a esta questão.");
      }

      await repositorioNegocio.executarFuncaoPostgreSql("responder_questao", {
        p_idtentativa: solicitacaoResponderQuestaoSimulado.idTentativa,
        p_idquestao: solicitacaoResponderQuestaoSimulado.idQuestao,
        p_idalternativa: solicitacaoResponderQuestaoSimulado.idAlternativaSelecionada,
      });

      return obterAttempt(solicitacaoResponderQuestaoSimulado);
    },

    async finalizarTentativaSimulado(
      solicitacaoFinalizarTentativaSimulado: ContratosApi.FinalizarTentativaSimuladoRequestModel,
    ) {
      const tentativaSimulado = (await obterAttempt(solicitacaoFinalizarTentativaSimulado)).data!;

      if (tentativaSimulado.status !== "em_andamento") {
        throw new ErroRegraNegocioHttp("Esta tentativa já foi finalizada.", 409);
      }

      await repositorioNegocio.executarFuncaoPostgreSql("finalizar_tentativa", {
        p_idtentativa: solicitacaoFinalizarTentativaSimulado.idTentativa,
      });

      return obterResultadoTentativaCorrigido(solicitacaoFinalizarTentativaSimulado);
    },

    async listarMinhasTentativas(
      solicitacaoListarMinhasTentativas: ContratosApi.ListarMinhasTentativasRequestModel,
    ) {
      const usuarioAutenticado = await contextoAutorizacao.exigirEstudanteComCadastroCompleto();

      validarPaginacao(
        solicitacaoListarMinhasTentativas.pagina,
        solicitacaoListarMinhasTentativas.quantidadePorPagina,
      );

      const paginaRegistros = await repositorioNegocio.consultarPaginaRegistros(
        "TentativaSimulado",
        "TentativaSimuladoResponseModel",
        {
          filters: [criarFiltroIgualdade("idPessoa", usuarioAutenticado.idPessoa)],
          order: [["iniciada_em", true], ["idTentativa"]],
          offset:
            (solicitacaoListarMinhasTentativas.pagina - 1) *
            solicitacaoListarMinhasTentativas.quantidadePorPagina,
          limit: solicitacaoListarMinhasTentativas.quantidadePorPagina,
        },
      );

      const responses = await repositorioNegocio.listarRegistros(
        "RespostaTentativaSimulado",
        "RespostaTentativaVinculadaResponseModel",
        {
          filters: [
            criarFiltroValorDentroLista(
              "idTentativa",
              paginaRegistros.itens.map((tentativaSimulado) => tentativaSimulado.idTentativa),
            ),
          ],
        },
      );

      for (const tentativaSimulado of paginaRegistros.itens) {
        tentativaSimulado.respostas = responses
          .filter((questaoAtual) => questaoAtual.idTentativa === tentativaSimulado.idTentativa)
          .map(({ idQuestao, idAlternativaSelecionada, dataHoraResposta }) => ({
            idQuestao,
            idAlternativaSelecionada,
            dataHoraResposta,
          }));
      }

      await origins(paginaRegistros.itens);

      return criarRespostaSucesso(
        {
          ...paginaRegistros,
          pagina: solicitacaoListarMinhasTentativas.pagina,
          quantidadePorPagina: solicitacaoListarMinhasTentativas.quantidadePorPagina,
        },
        "Histórico consultado.",
      );
    },
  };
}
