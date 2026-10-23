import type * as ContratosApi from "../contracts/modelos-requisicoes-respostas-api.js";
import {
  ErroRegraNegocioHttp,
  criarRespostaSucesso,
  validarAno,
  validarIdentificador,
  validarPaginacao,
  validarTexto,
} from "../domain/erros-validacoes-respostas-api.js";
import {
  criarFiltroContemTexto,
  criarFiltroIgualdade,
  criarFiltroValorDentroLista,
  type FiltroConsultaPostgreSql,
} from "../infrastructure/repositorio-consultas-postgresql.js";
import { ServicoAutorizacaoUsuarioAutenticado } from "./autorizacao-usuario-autenticado.js";
import { criarFiltrosConsultaProvas } from "./consulta-cadastro-provas.service.js";

export async function preencherAlternativasQuestoes(
  contextoAutorizacao: ServicoAutorizacaoUsuarioAutenticado,
  questions: ContratosApi.QuestaoPublicaResponseModel[],
) {
  const themes = (
    await contextoAutorizacao.repo.consultarPaginaRegistros("Tema", "TemaResponseModel", {
      limit: 100,
    })
  ).itens;

  const alternatives = await contextoAutorizacao.repo.listarRegistros(
    "AlternativaQuestao",
    "AlternativaVinculadaResponseModel",
    {
      filters: [
        criarFiltroValorDentroLista(
          "idQuestao",
          questions.map((questao) => questao.idQuestao),
        ),
      ],
      order: [["ordem"], ["idAlternativa"]],
    },
  );

  for (const questao of questions) {
    questao.nomeTema =
      themes.find((temaQuestao) => temaQuestao.idTema === questao.idTema)?.nome ?? null;

    questao.alternativas = alternatives
      .filter((alternativaQuestao) => alternativaQuestao.idQuestao === questao.idQuestao)
      .map(({ idAlternativa, letra, texto, ordem }) => ({
        idAlternativa,
        letra,
        texto,
        ordem,
      }));
  }
}

export function operacoesCadastroQuestoes(
  contextoAutorizacao: ServicoAutorizacaoUsuarioAutenticado,
) {
  const repositorioNegocio = contextoAutorizacao.repo;

  const obterQuestaoCompleta = async (
    solicitacaoObterQuestao: ContratosApi.ObterQuestaoRequestModel,
  ) => {
    await contextoAutorizacao.exigirAdministradorAtivo();

    validarIdentificador(solicitacaoObterQuestao.idQuestao, "uma questão");

    const question = await repositorioNegocio.obterRegistroObrigatorio(
      "Questao",
      "QuestaoPublicaResponseModel",
      [criarFiltroIgualdade("idQuestao", solicitacaoObterQuestao.idQuestao)],
      "Questão não encontrada.",
    );

    await preencherAlternativasQuestoes(contextoAutorizacao, [question]);

    const gabarito = await repositorioNegocio.obterRegistroOpcional(
      "GabaritoQuestao",
      "GabaritoQuestaoResponseModel",
      [criarFiltroIgualdade("idQuestao", solicitacaoObterQuestao.idQuestao)],
    );

    const explicacao =
      (await repositorioNegocio.executarFuncaoPostgreSql<string | null>(
        "obter_explicacao_questao",
        {
          p_idquestao: solicitacaoObterQuestao.idQuestao,
        },
      )) ?? "";

    return criarRespostaSucesso({ ...question, gabarito, explicacao }, "Questão consultada.");
  };

  const salvarQuestion = async (
    solicitacaoCriarQuestao: ContratosApi.CriarQuestaoRequestModel,
    identificadorQuestao: string | null,
  ) => {
    await contextoAutorizacao.exigirAdministradorAtivo();

    const enunciado = validarTexto(solicitacaoCriarQuestao.enunciado, "Enunciado", 1, 24000);

    validarIdentificador(solicitacaoCriarQuestao.idProva, "uma prova");

    validarIdentificador(solicitacaoCriarQuestao.idTema, "um tema");

    if (solicitacaoCriarQuestao.numero < 1) {
      throw new ErroRegraNegocioHttp("Informe o número original positivo da questão.");
    }

    if (
      !(await repositorioNegocio.existeRegistro("Prova", [
        criarFiltroIgualdade("idProva", solicitacaoCriarQuestao.idProva),
      ]))
    ) {
      throw new ErroRegraNegocioHttp("Prova não encontrada.", 404);
    }

    if (
      !(await repositorioNegocio.existeRegistro("Tema", [
        criarFiltroIgualdade("idTema", solicitacaoCriarQuestao.idTema),
      ]))
    ) {
      throw new ErroRegraNegocioHttp("Tema não encontrado.", 404);
    }

    if (
      !["facil", "media", "dificil", "nao_informada"].includes(solicitacaoCriarQuestao.dificuldade)
    ) {
      throw new ErroRegraNegocioHttp("Dificuldade inválida.");
    }

    if (!["rascunho", "publicada", "arquivada"].includes(solicitacaoCriarQuestao.status)) {
      throw new ErroRegraNegocioHttp("Status da questão inválido.");
    }

    if (
      !["provisorio", "definitivo", "anulada", "pendente"].includes(
        solicitacaoCriarQuestao.statusGabarito,
      )
    ) {
      throw new ErroRegraNegocioHttp("Status do gabarito inválido.");
    }

    if (
      !solicitacaoCriarQuestao.alternativas ||
      solicitacaoCriarQuestao.alternativas.length < 2 ||
      solicitacaoCriarQuestao.alternativas.length > 10
    ) {
      throw new ErroRegraNegocioHttp("Informe entre duas e dez alternativas.");
    }

    if (
      solicitacaoCriarQuestao.alternativas.some(
        (alternativaQuestao) =>
          !alternativaQuestao.idAlternativa ||
          alternativaQuestao.idAlternativa === "00000000-0000-0000-0000-000000000000" ||
          !alternativaQuestao.letra?.trim() ||
          alternativaQuestao.letra.trim().length !== 1 ||
          !alternativaQuestao.texto?.trim() ||
          alternativaQuestao.texto.length > 8000,
      )
    ) {
      throw new ErroRegraNegocioHttp("Preencha identificador, letra e texto de cada alternativa.");
    }

    if (
      ["idAlternativa", "letra", "texto"].some(
        (chaveAtual) =>
          new Set(
            solicitacaoCriarQuestao.alternativas.map((alternativaQuestao) =>
              alternativaQuestao[chaveAtual as keyof ContratosApi.AlternativaQuestaoRequestModel]
                .toString()
                .trim()
                .toUpperCase(),
            ),
          ).size !== solicitacaoCriarQuestao.alternativas.length,
      )
    ) {
      throw new ErroRegraNegocioHttp(
        "Alternativas não podem repetir identificadores, letras ou textos.",
      );
    }

    if (
      !["anulada", "pendente"].includes(solicitacaoCriarQuestao.statusGabarito) &&
      !solicitacaoCriarQuestao.alternativas.some(
        (alternativaQuestao) =>
          alternativaQuestao.idAlternativa === solicitacaoCriarQuestao.idAlternativaCorreta,
      )
    ) {
      throw new ErroRegraNegocioHttp("O gabarito deve apontar para uma alternativa da questão.");
    }

    if (identificadorQuestao) {
      validarIdentificador(identificadorQuestao, "uma questão");

      if (
        !(await repositorioNegocio.existeRegistro("Questao", [
          criarFiltroIgualdade("idQuestao", identificadorQuestao),
        ]))
      ) {
        throw new ErroRegraNegocioHttp("Questão não encontrada.", 404);
      }

      const composition = await repositorioNegocio.listarRegistros(
        "QuestaoSimulado",
        "ComposicaoSimuladoResponseModel",
        {
          filters: [criarFiltroIgualdade("idQuestao", identificadorQuestao)],
        },
      );

      const identificadoresRegistros = composition.map(
        (composicaoSimulado) => composicaoSimulado.idSimulado,
      );

      if (
        (await repositorioNegocio.existeRegistro("Simulado", [
          criarFiltroValorDentroLista("idSimulado", identificadoresRegistros),
          criarFiltroIgualdade("status", "publicado"),
        ])) ||
        (await repositorioNegocio.existeRegistro("TentativaSimulado", [
          criarFiltroValorDentroLista("idSimulado", identificadoresRegistros),
        ]))
      ) {
        throw new ErroRegraNegocioHttp(
          "Questões vinculadas a simulados publicados ou tentativas não podem ser editadas.",
          409,
        );
      }
    }

    const saved = await repositorioNegocio.executarFuncaoPostgreSql<string>("salvar_questao", {
      p_idquestao: identificadorQuestao,
      p_questao: {
        idProva: solicitacaoCriarQuestao.idProva,
        idTema: solicitacaoCriarQuestao.idTema,
        numero: solicitacaoCriarQuestao.numero,
        enunciado,
        dificuldade: solicitacaoCriarQuestao.dificuldade,
        fonte: solicitacaoCriarQuestao.fonte.trim(),
        imagem_url: solicitacaoCriarQuestao.imagemUrl,
        explicacao: solicitacaoCriarQuestao.explicacao.trim(),
        status: solicitacaoCriarQuestao.status,
      },
      p_alternativas: JSON.stringify(
        solicitacaoCriarQuestao.alternativas.map((alternativaQuestao, indiceAtual) => ({
          idAlternativa: alternativaQuestao.idAlternativa,
          letra: alternativaQuestao.letra.trim().toUpperCase(),
          texto: alternativaQuestao.texto.trim(),
          ordem: indiceAtual + 1,
        })),
      ),
      p_gabarito: {
        idAlternativaCorreta: solicitacaoCriarQuestao.idAlternativaCorreta,
        status: solicitacaoCriarQuestao.statusGabarito,
        explicacao: solicitacaoCriarQuestao.explicacao,
      },
    });

    const respostaQuestaoCriada = await obterQuestaoCompleta({ idQuestao: saved });

    return criarRespostaSucesso(
      respostaQuestaoCriada.data!,
      identificadorQuestao ? "Questão atualizada." : "Questão criada.",
    );
  };

  return {
    obterQuestao: obterQuestaoCompleta,

    criarQuestao: (solicitacaoCriarQuestao: ContratosApi.CriarQuestaoRequestModel) =>
      salvarQuestion(solicitacaoCriarQuestao, null),

    atualizarQuestao: (solicitacaoAtualizarQuestao: ContratosApi.AtualizarQuestaoRequestModel) =>
      salvarQuestion(solicitacaoAtualizarQuestao, solicitacaoAtualizarQuestao.idQuestao),

    async listarQuestoes(solicitacaoListarQuestoes: ContratosApi.ListarQuestoesRequestModel) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      validarPaginacao(
        solicitacaoListarQuestoes.pagina,
        solicitacaoListarQuestoes.quantidadePorPagina,
      );

      validarAno(solicitacaoListarQuestoes.ano);

      const filtrosConsulta: FiltroConsultaPostgreSql[] = [];

      if (solicitacaoListarQuestoes.busca?.trim()) {
        filtrosConsulta.push(criarFiltroContemTexto("enunciado", solicitacaoListarQuestoes.busca));
      }

      if (solicitacaoListarQuestoes.idTema !== null) {
        filtrosConsulta.push(criarFiltroIgualdade("idTema", solicitacaoListarQuestoes.idTema));
      }

      if (solicitacaoListarQuestoes.idProva !== null) {
        filtrosConsulta.push(criarFiltroIgualdade("idConcurso", solicitacaoListarQuestoes.idProva));
      }

      if (
        solicitacaoListarQuestoes.ano !== null ||
        solicitacaoListarQuestoes.orgao?.trim() ||
        solicitacaoListarQuestoes.organizadora?.trim() ||
        solicitacaoListarQuestoes.cargo?.trim()
      ) {
        const exams = await repositorioNegocio.listarRegistros("Prova", "ProvaResponseModel", {
          filters: criarFiltrosConsultaProvas(solicitacaoListarQuestoes),
        });

        filtrosConsulta.push(
          criarFiltroValorDentroLista(
            "idConcurso",
            exams.map((prova) => prova.idProva),
          ),
        );
      }

      if (solicitacaoListarQuestoes.dificuldade?.trim()) {
        filtrosConsulta.push(
          criarFiltroIgualdade("dificuldade", solicitacaoListarQuestoes.dificuldade),
        );
      }

      if (solicitacaoListarQuestoes.status?.trim()) {
        filtrosConsulta.push(criarFiltroIgualdade("status", solicitacaoListarQuestoes.status));
      }

      const paginaRegistros = await repositorioNegocio.consultarPaginaRegistros(
        "Questao",
        "QuestaoPublicaResponseModel",
        {
          filters: filtrosConsulta,
          order: [["criada_em", true], ["idQuestao"]],
          offset:
            (solicitacaoListarQuestoes.pagina - 1) * solicitacaoListarQuestoes.quantidadePorPagina,
          limit: solicitacaoListarQuestoes.quantidadePorPagina,
        },
      );

      await preencherAlternativasQuestoes(contextoAutorizacao, paginaRegistros.itens);

      return criarRespostaSucesso(
        {
          ...paginaRegistros,
          pagina: solicitacaoListarQuestoes.pagina,
          quantidadePorPagina: solicitacaoListarQuestoes.quantidadePorPagina,
        },
        "Questões consultadas.",
      );
    },

    async arquivarQuestao(solicitacaoArquivarQuestao: ContratosApi.ArquivarQuestaoRequestModel) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      validarIdentificador(solicitacaoArquivarQuestao.idQuestao, "uma questão");

      await repositorioNegocio.executarMutacaoRegistro(
        "Questao",
        "update",
        solicitacaoArquivarQuestao.idQuestao,
        {
          status: "arquivada",
        },
      );

      return obterQuestaoCompleta(solicitacaoArquivarQuestao);
    },
  };
}
