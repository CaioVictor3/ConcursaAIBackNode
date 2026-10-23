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
  type FiltroConsultaPostgreSql,
} from "../infrastructure/repositorio-consultas-postgresql.js";
import { ServicoAutorizacaoUsuarioAutenticado } from "./autorizacao-usuario-autenticado.js";

export function criarFiltrosConsultaProvas(solicitacaoExamFilters: {
  ano: number | null;
  orgao: string | null;
  organizadora: string | null;
  cargo: string | null;
}) {
  validarAno(solicitacaoExamFilters.ano);

  const filtrosConsulta: FiltroConsultaPostgreSql[] = [];

  if (solicitacaoExamFilters.ano !== null) {
    filtrosConsulta.push(criarFiltroIgualdade("ano", solicitacaoExamFilters.ano));
  }

  for (const chaveConfiguracao of ["orgao", "organizadora", "cargo"] as const) {
    if (solicitacaoExamFilters[chaveConfiguracao]?.trim()) {
      filtrosConsulta.push(
        criarFiltroContemTexto(
          chaveConfiguracao,
          validarTexto(solicitacaoExamFilters[chaveConfiguracao], chaveConfiguracao, 1, 200),
        ),
      );
    }
  }

  return filtrosConsulta;
}

export function operacoesConsultaCadastroProvas(
  contextoAutorizacao: ServicoAutorizacaoUsuarioAutenticado,
  getAttempt: (
    solicitacaoObterTentativaSimulado: ContratosApi.ObterTentativaSimuladoRequestModel,
  ) => Promise<ContratosApi.RespostaPadraoApi<ContratosApi.TentativaSimuladoResponseModel>>,
) {
  const repositorioNegocio = contextoAutorizacao.repo;

  const obterExam = async (solicitacaoObterProva: ContratosApi.ObterProvaRequestModel) => {
    await contextoAutorizacao.exigirUsuarioAtivo();

    validarIdentificador(solicitacaoObterProva.idProva, "uma prova");

    return criarRespostaSucesso(
      await repositorioNegocio.obterRegistroObrigatorio(
        "Prova",
        "ProvaResponseModel",
        [criarFiltroIgualdade("idProva", solicitacaoObterProva.idProva)],
        "Prova não encontrada.",
      ),
      "Prova consultada.",
    );
  };

  const salvarExam = async (
    solicitacaoCriarProva: ContratosApi.CriarProvaRequestModel,
    identificadorProva: string | null,
  ) => {
    await contextoAutorizacao.exigirAdministradorAtivo();

    validarAno(solicitacaoCriarProva.ano);

    const orgao = validarTexto(solicitacaoCriarProva.orgao, "Órgão", 1, 200);

    const cargo = solicitacaoCriarProva.cargo?.trim()
      ? validarTexto(solicitacaoCriarProva.cargo, "Cargo", 1, 200)
      : null;

    validarIdentificador(solicitacaoCriarProva.idOrganizadora, "uma organizadora");

    if (
      !(await repositorioNegocio.existeRegistro("Banca", [
        criarFiltroIgualdade("idBanca", solicitacaoCriarProva.idOrganizadora),
      ]))
    ) {
      throw new ErroRegraNegocioHttp("Organizadora não encontrada.", 404);
    }

    const saved = await repositorioNegocio.executarFuncaoPostgreSql<string>("salvar_prova", {
      p_idprova: identificadorProva,
      p_ano: solicitacaoCriarProva.ano,
      p_orgao: orgao,
      p_idorganizadora: solicitacaoCriarProva.idOrganizadora,
      p_cargo: cargo,
      p_composicao_confirmada: solicitacaoCriarProva.composicaoConfirmada,
    });

    return obterExam({ idProva: saved });
  };

  return {
    obterProva: obterExam,

    async listarProvas(solicitacaoListarProvas: ContratosApi.ListarProvasRequestModel) {
      await contextoAutorizacao.exigirUsuarioAtivo();

      validarPaginacao(solicitacaoListarProvas.pagina, solicitacaoListarProvas.quantidadePorPagina);

      const paginaRegistros = await repositorioNegocio.consultarPaginaRegistros(
        "Prova",
        "ProvaResponseModel",
        {
          filters: criarFiltrosConsultaProvas(solicitacaoListarProvas),
          order: [["ano", true], ["orgao"], ["idProva"]],
          offset:
            (solicitacaoListarProvas.pagina - 1) * solicitacaoListarProvas.quantidadePorPagina,
          limit: solicitacaoListarProvas.quantidadePorPagina,
        },
      );

      return criarRespostaSucesso(
        {
          ...paginaRegistros,
          pagina: solicitacaoListarProvas.pagina,
          quantidadePorPagina: solicitacaoListarProvas.quantidadePorPagina,
        },
        "Provas consultadas.",
      );
    },

    async listarTemas(solicitacaoListarTemasNaoUtilizada: ContratosApi.ListarTemasRequestModel) {
      await contextoAutorizacao.exigirUsuarioAtivo();

      return criarRespostaSucesso(
        {
          itens: await repositorioNegocio.listarRegistros("Tema", "TemaResponseModel", {
            order: [["nome"], ["idTema"]],
          }),
        },
        "Temas consultados.",
      );
    },

    criarProva: (solicitacaoCriarProva: ContratosApi.CriarProvaRequestModel) =>
      salvarExam(solicitacaoCriarProva, null),

    atualizarProva: (solicitacaoAtualizarProva: ContratosApi.AtualizarProvaRequestModel) => {
      validarIdentificador(solicitacaoAtualizarProva.idProva, "uma prova");

      return salvarExam(solicitacaoAtualizarProva, solicitacaoAtualizarProva.idProva);
    },

    async listarPendenciasProvas(
      solicitacaoListarPendenciasProvas: ContratosApi.ListarPendenciasProvasRequestModel,
    ) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      validarPaginacao(
        solicitacaoListarPendenciasProvas.pagina,
        solicitacaoListarPendenciasProvas.quantidadePorPagina,
      );

      const relatorioPendenciasProvas =
        await repositorioNegocio.executarFuncaoPostgreSqlComContrato(
          "listar_pendencias_provas",
          "ListarPendenciasProvasResponseModel",
          {
            p_pagina: solicitacaoListarPendenciasProvas.pagina,
            p_quantidade: solicitacaoListarPendenciasProvas.quantidadePorPagina,
          },
        );

      if (!relatorioPendenciasProvas) {
        throw new ErroRegraNegocioHttp("Relatório indisponível.", 503);
      }

      return criarRespostaSucesso(relatorioPendenciasProvas, "Pendências consultadas.");
    },

    async iniciarProva(solicitacaoIniciarProva: ContratosApi.IniciarProvaRequestModel) {
      await contextoAutorizacao.exigirEstudanteComCadastroCompleto();

      validarIdentificador(solicitacaoIniciarProva.idProva, "uma prova");

      return getAttempt({
        idTentativa: await repositorioNegocio.executarFuncaoPostgreSql<string>("iniciar_prova", {
          p_idprova: solicitacaoIniciarProva.idProva,
        }),
      });
    },
  };
}
