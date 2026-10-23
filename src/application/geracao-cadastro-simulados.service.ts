import type * as ContratosApi from "../contracts/modelos-requisicoes-respostas-api.js";
import { projetarRespostaPeloContrato } from "../contracts/validacao-conversao-contratos-api.js";
import {
  criarRespostaSucesso,
  EMPTY_UUID,
  ErroRegraNegocioHttp,
  validarAno,
  validarIdentificador,
  validarPaginacao,
  validarTexto,
} from "../domain/erros-validacoes-respostas-api.js";
import {
  criarFiltroIgualdade,
  criarFiltroValorDentroLista,
  type FiltroConsultaPostgreSql,
} from "../infrastructure/repositorio-consultas-postgresql.js";
import { ServicoAutorizacaoUsuarioAutenticado } from "./autorizacao-usuario-autenticado.js";
import {
  validarCotasAssuntosSimulado,
  validarCotasTemasSimulado,
} from "./validacao-cotas-simulados.service.js";

export function operacoesGeracaoCadastroSimulados(
  contextoAutorizacao: ServicoAutorizacaoUsuarioAutenticado,
) {
  const repositorioNegocio = contextoAutorizacao.repo;

  const composition = async (simulado: ContratosApi.SimuladoResponseModel) => {
    simulado.idsQuestoes = (
      await repositorioNegocio.listarRegistros(
        "QuestaoSimulado",
        "ComposicaoSimuladoResponseModel",
        {
          filters: [criarFiltroIgualdade("idSimulado", simulado.idSimulado)],
          order: [["ordem"], ["idSimuladoQuestao"]],
        },
      )
    ).map((composicaoQuestao) => composicaoQuestao.idQuestao);

    return simulado;
  };

  const obterSimulation = async (
    solicitacaoObterSimulado: ContratosApi.ObterSimuladoRequestModel,
  ) => {
    const usuarioAutenticado = await contextoAutorizacao.exigirUsuarioAtivo();

    validarIdentificador(solicitacaoObterSimulado.idSimulado, "um simulado");

    const filtrosConsulta = [
      criarFiltroIgualdade("idSimulado", solicitacaoObterSimulado.idSimulado),
    ];

    if (usuarioAutenticado.tipo !== "administrador") {
      filtrosConsulta.push(criarFiltroIgualdade("status", "publicado"));
    }

    const simulado = await repositorioNegocio.obterRegistroObrigatorio(
      "Simulado",
      "SimuladoResponseModel",
      filtrosConsulta,
      "Simulado não encontrado.",
      [
        criarFiltroIgualdade("publico", true),
        criarFiltroIgualdade("idPessoaCriadora", usuarioAutenticado.idPessoa),
      ],
    );

    return criarRespostaSucesso(await composition(simulado), "Simulado consultado.");
  };

  const salvarSimulation = async (
    solicitacaoCriarSimulado: ContratosApi.CriarSimuladoRequestModel,
    identificadorSimulado: string | null,
  ) => {
    await contextoAutorizacao.exigirAdministradorAtivo();

    const nome = validarTexto(solicitacaoCriarSimulado.nome, "Nome", 3, 200);

    if (
      !solicitacaoCriarSimulado.idsQuestoes?.length ||
      solicitacaoCriarSimulado.idsQuestoes.includes(EMPTY_UUID) ||
      new Set(solicitacaoCriarSimulado.idsQuestoes).size !==
        solicitacaoCriarSimulado.idsQuestoes.length
    ) {
      throw new ErroRegraNegocioHttp("Informe questões sem repetições.");
    }

    if (
      !["rascunho", "publicado", "arquivado"].includes(solicitacaoCriarSimulado.status) ||
      !["padrao", "personalizado"].includes(solicitacaoCriarSimulado.tipo)
    ) {
      throw new ErroRegraNegocioHttp("Tipo ou status de simulado inválido.");
    }

    if (
      solicitacaoCriarSimulado.duracaoMinutos !== null &&
      solicitacaoCriarSimulado.duracaoMinutos <= 0
    ) {
      throw new ErroRegraNegocioHttp("A duração deve ser positiva.");
    }

    if (
      (
        await repositorioNegocio.consultarPaginaRegistros(
          "Questao",
          "QuestaoPublicaResponseModel",
          {
            filters: [
              criarFiltroValorDentroLista("idQuestao", solicitacaoCriarSimulado.idsQuestoes),
              criarFiltroIgualdade("status", "publicada"),
            ],
            limit: 1,
          },
        )
      ).total !== solicitacaoCriarSimulado.idsQuestoes.length
    ) {
      throw new ErroRegraNegocioHttp("Todas as questões devem estar publicadas.");
    }

    if (
      solicitacaoCriarSimulado.idConcurso !== null &&
      !(await repositorioNegocio.existeRegistro("Concurso", [
        criarFiltroIgualdade("idConcurso", solicitacaoCriarSimulado.idConcurso),
      ]))
    ) {
      throw new ErroRegraNegocioHttp("Concurso não encontrado.", 404);
    }

    if (identificadorSimulado) {
      validarIdentificador(identificadorSimulado, "um simulado");

      if (
        !(await repositorioNegocio.existeRegistro("Simulado", [
          criarFiltroIgualdade("idSimulado", identificadorSimulado),
        ]))
      ) {
        throw new ErroRegraNegocioHttp("Simulado não encontrado.", 404);
      }

      if (
        await repositorioNegocio.existeRegistro("TentativaSimulado", [
          criarFiltroIgualdade("idSimulado", identificadorSimulado),
        ])
      ) {
        throw new ErroRegraNegocioHttp("Simulados com tentativas não podem ser editados.", 409);
      }
    }

    const saved = await repositorioNegocio.executarFuncaoPostgreSql<string>("salvar_simulado", {
      p_idsimulado: identificadorSimulado,
      p_idsquestoes: solicitacaoCriarSimulado.idsQuestoes,
      p_simulado: {
        nome,
        descricao: solicitacaoCriarSimulado.descricao?.trim() ?? "",
        idConcurso: solicitacaoCriarSimulado.idConcurso,
        duracao_minutos: solicitacaoCriarSimulado.duracaoMinutos,
        tipo: solicitacaoCriarSimulado.tipo,
        publico: solicitacaoCriarSimulado.publico,
        status: solicitacaoCriarSimulado.status,
      },
    });

    return obterSimulation({ idSimulado: saved });
  };

  const availability = async (
    solicitacaoSimulationHandlersNaoUtilizada: ContratosApi.ObterDisponibilidadeAssuntosRequestModel,
  ) => {
    await contextoAutorizacao.exigirEstudanteComCadastroCompleto();

    const dadosBrutosBanco = await repositorioNegocio.executarFuncaoPostgreSql<unknown[]>(
      "disponibilidade_assuntos_odonto",
      {},
      true,
    );

    const itens = dadosBrutosBanco.map((registroAtual) =>
      projetarRespostaPeloContrato("DisponibilidadeAssuntoResponseModel", registroAtual),
    );

    return criarRespostaSucesso(
      {
        itens,
        totalQuestoes: itens.reduce(
          (quantidadeAcumulada, disponibilidadeAssunto) =>
            quantidadeAcumulada + disponibilidadeAssunto.quantidade,
          0,
        ),
      },
      "Disponibilidade consultada.",
    );
  };

  const generated = async (identificadorSimulado: string, message: string) => {
    const usuarioAutenticado = await contextoAutorizacao.exigirEstudanteComCadastroCompleto();

    const tentativaSimulado = await repositorioNegocio.obterRegistroObrigatorio(
      "TentativaSimulado",
      "TentativaSimuladoResponseModel",
      [
        criarFiltroIgualdade("idTentativa", identificadorSimulado),
        criarFiltroIgualdade("idPessoa", usuarioAutenticado.idPessoa),
      ],
      "Tentativa não encontrada.",
    );

    return criarRespostaSucesso(
      { idTentativa: identificadorSimulado, idSimulado: tentativaSimulado.idSimulado },
      message,
    );
  };

  return {
    obterSimulado: obterSimulation,

    criarSimulado: (solicitacaoCriarSimulado: ContratosApi.CriarSimuladoRequestModel) =>
      salvarSimulation(solicitacaoCriarSimulado, null),

    atualizarSimulado: (solicitacaoAtualizarSimulado: ContratosApi.AtualizarSimuladoRequestModel) =>
      salvarSimulation(solicitacaoAtualizarSimulado, solicitacaoAtualizarSimulado.idSimulado),

    obterDisponibilidadeAssuntos: availability,

    async listarSimulados(solicitacaoListarSimulados: ContratosApi.ListarSimuladosRequestModel) {
      const usuarioAutenticado = await contextoAutorizacao.exigirUsuarioAtivo();

      validarPaginacao(
        solicitacaoListarSimulados.pagina,
        solicitacaoListarSimulados.quantidadePorPagina,
      );

      const filtrosConsulta: FiltroConsultaPostgreSql[] = [];

      if (usuarioAutenticado.tipo !== "administrador") {
        filtrosConsulta.push(criarFiltroIgualdade("status", "publicado"));
      }

      if (solicitacaoListarSimulados.somentePublicos) {
        filtrosConsulta.push(
          criarFiltroIgualdade("publico", true),
          criarFiltroIgualdade("status", "publicado"),
        );
      }

      const paginaRegistros = await repositorioNegocio.consultarPaginaRegistros(
        "Simulado",
        "SimuladoResponseModel",
        {
          filters: filtrosConsulta,
          or: [
            criarFiltroIgualdade("publico", true),
            criarFiltroIgualdade("idPessoaCriadora", usuarioAutenticado.idPessoa),
          ],
          order: [["criado_em", true], ["idSimulado"]],
          offset:
            (solicitacaoListarSimulados.pagina - 1) *
            solicitacaoListarSimulados.quantidadePorPagina,
          limit: solicitacaoListarSimulados.quantidadePorPagina,
        },
      );

      const composicoesQuestoesSimulados = await repositorioNegocio.listarRegistros(
        "QuestaoSimulado",
        "ComposicaoSimuladoResponseModel",
        {
          filters: [
            criarFiltroValorDentroLista(
              "idSimulado",
              paginaRegistros.itens.map((simulado) => simulado.idSimulado),
            ),
          ],
          order: [["ordem"], ["idSimuladoQuestao"]],
        },
      );

      for (const simulado of paginaRegistros.itens) {
        simulado.idsQuestoes = composicoesQuestoesSimulados
          .filter((questaoDoSimulado) => questaoDoSimulado.idSimulado === simulado.idSimulado)
          .map((questaoDoSimulado) => questaoDoSimulado.idQuestao);
      }

      return criarRespostaSucesso(
        {
          ...paginaRegistros,
          pagina: solicitacaoListarSimulados.pagina,
          quantidadePorPagina: solicitacaoListarSimulados.quantidadePorPagina,
        },
        "Simulados consultados.",
      );
    },

    async criarSimuladoFiltrado(
      solicitacaoCriarSimuladoFiltrado: ContratosApi.CriarSimuladoFiltradoRequestModel,
    ) {
      await contextoAutorizacao.exigirEstudanteComCadastroCompleto();

      const nome = validarTexto(solicitacaoCriarSimuladoFiltrado.nome, "Nome", 3, 200);

      if (
        solicitacaoCriarSimuladoFiltrado.quantidade < 1 ||
        solicitacaoCriarSimuladoFiltrado.quantidade > 500
      ) {
        throw new ErroRegraNegocioHttp("Informe entre 1 e 500 questões.");
      }

      validarCotasTemasSimulado(solicitacaoCriarSimuladoFiltrado);

      validarAno(solicitacaoCriarSimuladoFiltrado.ano);

      for (const valorFiltroProva of [
        solicitacaoCriarSimuladoFiltrado.orgao,
        solicitacaoCriarSimuladoFiltrado.organizadora,
        solicitacaoCriarSimuladoFiltrado.cargo,
      ]) {
        if (valorFiltroProva && valorFiltroProva.trim().length > 200) {
          throw new ErroRegraNegocioHttp("Filtros devem ter até 200 caracteres.");
        }
      }

      const identificadorTema = await repositorioNegocio.executarFuncaoPostgreSql<string>(
        "criar_simulado_filtrado",
        {
          p_nome: nome,
          p_quantidade: solicitacaoCriarSimuladoFiltrado.quantidade,
          p_idtema: solicitacaoCriarSimuladoFiltrado.idTema,
          p_ano: solicitacaoCriarSimuladoFiltrado.ano,
          p_orgao: solicitacaoCriarSimuladoFiltrado.orgao?.trim() ?? null,
          p_organizadora: solicitacaoCriarSimuladoFiltrado.organizadora?.trim() ?? null,
          p_cargo: solicitacaoCriarSimuladoFiltrado.cargo?.trim() ?? null,
          p_cotas_temas: JSON.stringify(solicitacaoCriarSimuladoFiltrado.cotasTemas),
        },
      );

      return generated(identificadorTema, "Simulado criado.");
    },

    async gerarSimuladoPersonalizado(
      solicitacaoGerarSimuladoPersonalizado: ContratosApi.GerarSimuladoPersonalizadoRequestModel,
    ) {
      await contextoAutorizacao.exigirEstudanteComCadastroCompleto();

      if (solicitacaoGerarSimuladoPersonalizado.quantidade < 1) {
        throw new ErroRegraNegocioHttp("Informe pelo menos uma questão.");
      }

      if (!solicitacaoGerarSimuladoPersonalizado.cotasAssuntos) {
        throw new ErroRegraNegocioHttp("Informe a distribuição por assuntos ou uma lista vazia.");
      }

      const disponibilidadeAssuntos = (await availability({})).data!.itens;

      validarCotasAssuntosSimulado(solicitacaoGerarSimuladoPersonalizado, disponibilidadeAssuntos);

      return generated(
        await repositorioNegocio.executarFuncaoPostgreSql<string>("gerar_simulado_odonto", {
          p_quantidade: solicitacaoGerarSimuladoPersonalizado.quantidade,
          p_assuntos: JSON.stringify(solicitacaoGerarSimuladoPersonalizado.cotasAssuntos),
        }),
        "Simulado gerado.",
      );
    },

    generated,
  };
}
