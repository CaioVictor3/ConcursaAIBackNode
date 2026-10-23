import type * as ContratosApi from "../contracts/modelos-requisicoes-respostas-api.js";
import {
  ErroRegraNegocioHttp,
  criarRespostaSucesso,
  validarIdentificador,
  validarPaginacao,
  validarTexto,
} from "../domain/erros-validacoes-respostas-api.js";
import {
  criarFiltroIgualdade,
  type FiltroConsultaPostgreSql,
} from "../infrastructure/repositorio-consultas-postgresql.js";
import { ServicoAutorizacaoUsuarioAutenticado } from "./autorizacao-usuario-autenticado.js";

export function operacoesChamadosSuporte(
  contextoAutorizacao: ServicoAutorizacaoUsuarioAutenticado,
) {
  const repositorioNegocio = contextoAutorizacao.repo;

  const obterSupport = async (solicitacaoObterChamado: ContratosApi.ObterChamadoRequestModel) => {
    const usuarioAutenticado = await contextoAutorizacao.exigirUsuarioAtivo();

    validarIdentificador(solicitacaoObterChamado.idChamado, "um chamado");

    const filtrosConsulta = [criarFiltroIgualdade("idChamado", solicitacaoObterChamado.idChamado)];

    if (usuarioAutenticado.tipo !== "administrador") {
      filtrosConsulta.push(criarFiltroIgualdade("idPessoa", usuarioAutenticado.idPessoa));
    }

    const chamadoSuporte = await repositorioNegocio.obterRegistroObrigatorio(
      "ChamadoSuporte",
      "ChamadoSuporteResponseModel",
      filtrosConsulta,
      "Chamado não encontrado.",
    );

    chamadoSuporte.mensagens = await repositorioNegocio.listarRegistros(
      "MensagemSuporte",
      "MensagemChamadoResponseModel",
      {
        filters: [criarFiltroIgualdade("idChamado", chamadoSuporte.idChamado)],
        order: [["criada_em"], ["idMensagem"]],
      },
    );

    return criarRespostaSucesso(chamadoSuporte, "Chamado consultado.");
  };

  return {
    obterChamado: obterSupport,

    async listarChamados(solicitacaoListarChamados: ContratosApi.ListarChamadosRequestModel) {
      const usuarioAutenticado = await contextoAutorizacao.exigirUsuarioAtivo();

      validarPaginacao(
        solicitacaoListarChamados.pagina,
        solicitacaoListarChamados.quantidadePorPagina,
      );

      if (
        solicitacaoListarChamados.status &&
        !["aberto", "aguardando_aluno", "aguardando_suporte", "finalizado"].includes(
          solicitacaoListarChamados.status,
        )
      ) {
        throw new ErroRegraNegocioHttp("Status do chamado inválido.");
      }

      const filtrosConsulta: FiltroConsultaPostgreSql[] = [];

      if (usuarioAutenticado.tipo !== "administrador") {
        filtrosConsulta.push(criarFiltroIgualdade("idPessoa", usuarioAutenticado.idPessoa));
      }

      if (solicitacaoListarChamados.status) {
        filtrosConsulta.push(criarFiltroIgualdade("status", solicitacaoListarChamados.status));
      }

      const paginaChamados = await repositorioNegocio.consultarPaginaRegistros(
        "ChamadoSuporte",
        "ChamadoSuporteResponseModel",
        {
          filters: filtrosConsulta,
          order: [["atualizado_em", true], ["idChamado"]],
          offset:
            (solicitacaoListarChamados.pagina - 1) * solicitacaoListarChamados.quantidadePorPagina,
          limit: solicitacaoListarChamados.quantidadePorPagina,
        },
      );

      return criarRespostaSucesso(
        {
          ...paginaChamados,
          pagina: solicitacaoListarChamados.pagina,
          quantidadePorPagina: solicitacaoListarChamados.quantidadePorPagina,
        },
        "Chamados consultados.",
      );
    },

    async abrirChamado(solicitacaoAbrirChamado: ContratosApi.AbrirChamadoRequestModel) {
      await contextoAutorizacao.exigirEstudanteComCadastroCompleto();

      const subject = validarTexto(solicitacaoAbrirChamado.assunto, "Assunto", 5, 120);

      const message = validarTexto(solicitacaoAbrirChamado.mensagem, "Descrição", 10, 4000);

      if (
        !["acesso", "simulados", "desempenho", "outro"].includes(solicitacaoAbrirChamado.categoria)
      ) {
        throw new ErroRegraNegocioHttp("Selecione uma categoria válida.");
      }

      return obterSupport({
        idChamado: await repositorioNegocio.executarFuncaoPostgreSql<string>(
          "abrir_chamado_suporte",
          {
            p_assunto: subject,
            p_categoria: solicitacaoAbrirChamado.categoria,
            p_mensagem: message,
          },
        ),
      });
    },

    async responderChamado(solicitacaoResponderChamado: ContratosApi.ResponderChamadoRequestModel) {
      const chamadoSuporte = (await obterSupport(solicitacaoResponderChamado)).data!;

      if (chamadoSuporte.status === "finalizado") {
        throw new ErroRegraNegocioHttp("Um chamado finalizado não pode receber mensagens.", 409);
      }

      const message = validarTexto(solicitacaoResponderChamado.mensagem, "Mensagem", 1, 4000);

      await repositorioNegocio.executarFuncaoPostgreSql("responder_chamado_suporte", {
        p_idchamado: solicitacaoResponderChamado.idChamado,
        p_mensagem: message,
      });

      return obterSupport(solicitacaoResponderChamado);
    },

    async finalizarChamado(solicitacaoFinalizarChamado: ContratosApi.FinalizarChamadoRequestModel) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      const chamadoSuporte = (await obterSupport(solicitacaoFinalizarChamado)).data!;

      if (chamadoSuporte.status === "finalizado") {
        throw new ErroRegraNegocioHttp(
          "Este chamado já foi finalizado e não pode ser movimentado.",
          409,
        );
      }

      const resolution = validarTexto(solicitacaoFinalizarChamado.resolucao, "Solução", 10, 4000);

      await repositorioNegocio.executarFuncaoPostgreSql("finalizar_chamado_suporte", {
        p_idchamado: solicitacaoFinalizarChamado.idChamado,
        p_resolucao: resolution,
      });

      return obterSupport(solicitacaoFinalizarChamado);
    },
  };
}
