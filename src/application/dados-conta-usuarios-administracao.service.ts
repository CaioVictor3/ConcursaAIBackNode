import type * as ContratosApi from "../contracts/modelos-requisicoes-respostas-api.js";
import {
  ErroRegraNegocioHttp,
  criarRespostaSucesso,
  validarIdentificador,
  validarPaginacao,
} from "../domain/erros-validacoes-respostas-api.js";
import { validarDadosPessoais } from "../domain/validacao-dados-pessoais.js";
import {
  criarFiltroContemTexto,
  criarFiltroIgualdade,
  type FiltroConsultaPostgreSql,
} from "../infrastructure/repositorio-consultas-postgresql.js";
import { ServicoAutorizacaoUsuarioAutenticado } from "./autorizacao-usuario-autenticado.js";

export function operacoesDadosContaUsuarios(
  contextoAutorizacao: ServicoAutorizacaoUsuarioAutenticado,
) {
  const repositorioNegocio = contextoAutorizacao.repo;

  const account = async (
    solicitacaoIdentityHandlersNaoUtilizada: ContratosApi.ObterMinhaContaRequestModel,
  ) => {
    const usuarioAutenticado = await contextoAutorizacao.exigirUsuarioAtivo();

    return criarRespostaSucesso(
      {
        usuario: await repositorioNegocio.obterRegistroObrigatorio(
          "Usuario",
          "UsuarioResponseModel",
          [criarFiltroIgualdade("idUsuario", usuarioAutenticado.idUsuario)],
          "Conta não encontrada.",
        ),
        pessoa: await repositorioNegocio.executarFuncaoPostgreSqlComContrato(
          "obter_minha_pessoa",
          "PessoaResponseModel",
        ),
      },
      "Dados da conta consultados.",
    );
  };

  return {
    obterMinhaConta: account,

    async atualizarMinhaConta(
      solicitacaoAtualizarMinhaConta: ContratosApi.AtualizarMinhaContaRequestModel,
    ) {
      await contextoAutorizacao.exigirUsuarioAtivo();

      const dadosPessoaisValidados = validarDadosPessoais(solicitacaoAtualizarMinhaConta);

      await repositorioNegocio.executarFuncaoPostgreSql("salvar_minha_pessoa", {
        p_pessoa: {
          ...dadosPessoaisValidados,
          complemento: dadosPessoaisValidados.complemento ?? "",
        },
      });

      return account({});
    },

    async obterMeuUsuario(
      solicitacaoObterMeuUsuarioNaoUtilizada: ContratosApi.ObterMeuUsuarioRequestModel,
    ) {
      if (!repositorioNegocio.user.id) {
        throw new ErroRegraNegocioHttp("Entre na sua conta para continuar.", 401);
      }

      return criarRespostaSucesso(
        await repositorioNegocio.obterRegistroObrigatorio(
          "Usuario",
          "UsuarioResponseModel",
          [criarFiltroIgualdade("idUsuario", repositorioNegocio.user.id)],
          "Conta não encontrada.",
        ),
        "Perfil consultado.",
      );
    },

    async obterUsuario(solicitacaoObterUsuario: ContratosApi.ObterUsuarioRequestModel) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      validarIdentificador(solicitacaoObterUsuario.idUsuario, "um usuário");

      return criarRespostaSucesso(
        await repositorioNegocio.obterRegistroObrigatorio(
          "Usuario",
          "UsuarioResponseModel",
          [criarFiltroIgualdade("idUsuario", solicitacaoObterUsuario.idUsuario)],
          "Usuário não encontrado.",
        ),
        "Usuário consultado.",
      );
    },

    async listarUsuarios(solicitacaoListarUsuarios: ContratosApi.ListarUsuariosRequestModel) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      validarPaginacao(
        solicitacaoListarUsuarios.pagina,
        solicitacaoListarUsuarios.quantidadePorPagina,
      );

      if (
        solicitacaoListarUsuarios.tipo &&
        !["administrador", "estudante"].includes(solicitacaoListarUsuarios.tipo)
      ) {
        throw new ErroRegraNegocioHttp("Tipo de usuário inválido.");
      }

      const filtrosConsulta: FiltroConsultaPostgreSql[] = [];

      if (solicitacaoListarUsuarios.tipo) {
        filtrosConsulta.push(criarFiltroIgualdade("tipo", solicitacaoListarUsuarios.tipo));
      }

      if (solicitacaoListarUsuarios.busca?.trim()) {
        filtrosConsulta.push(
          criarFiltroContemTexto("nome_completo", solicitacaoListarUsuarios.busca),
        );
      }

      const paginaUsuarios = await repositorioNegocio.consultarPaginaRegistros(
        "Usuario",
        "UsuarioResponseModel",
        {
          filters: filtrosConsulta,
          order: [["nome_completo"], ["idUsuario"]],
          offset:
            (solicitacaoListarUsuarios.pagina - 1) * solicitacaoListarUsuarios.quantidadePorPagina,
          limit: solicitacaoListarUsuarios.quantidadePorPagina,
        },
      );

      return criarRespostaSucesso(
        {
          ...paginaUsuarios,
          pagina: solicitacaoListarUsuarios.pagina,
          quantidadePorPagina: solicitacaoListarUsuarios.quantidadePorPagina,
        },
        "Usuários consultados.",
      );
    },

    async obterMetricasSistema(
      solicitacaoObterMetricasSistemaNaoUtilizada: ContratosApi.ObterMetricasSistemaRequestModel,
    ) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      const metricasSistema = await repositorioNegocio.executarFuncaoPostgreSqlComContrato(
        "metricas_sistema",
        "MetricasSistemaResponseModel",
      );

      if (!metricasSistema) {
        throw new ErroRegraNegocioHttp("Não foi possível consultar as métricas.", 503);
      }

      return criarRespostaSucesso(metricasSistema, "Métricas do sistema consultadas.");
    },
  };
}
