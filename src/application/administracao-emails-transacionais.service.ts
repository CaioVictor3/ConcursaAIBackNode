import type * as ContratosApi from "../contracts/modelos-requisicoes-respostas-api.js";
import {
  ErroRegraNegocioHttp,
  criarRespostaSucesso,
  validarIdentificador,
  validarPaginacao,
} from "../domain/erros-validacoes-respostas-api.js";
import {
  ServicoEnvioEmailsTransacionaisResend,
  tiposEventoEmailTransacional,
} from "../infrastructure/envio-emails-transacionais-resend.js";
import { ServicoAutorizacaoUsuarioAutenticado } from "./autorizacao-usuario-autenticado.js";

export function operacoesAdministracaoEmailsTransacionais(
  contextoAutorizacao: ServicoAutorizacaoUsuarioAutenticado,
  servicoEmails: Pick<
    ServicoEnvioEmailsTransacionaisResend,
    | "listarHistoricoEmails"
    | "obterMetricasEmails"
    | "reprocessarEmailComFalha"
    | "listarFluxosEmail"
    | "atualizarFluxoEmail"
  >,
) {
  return {
    async listarHistorico(
      solicitacaoListarEmailsTransacionais: ContratosApi.ListarEmailsTransacionaisRequestModel,
    ) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      validarPaginacao(
        solicitacaoListarEmailsTransacionais.pagina,
        solicitacaoListarEmailsTransacionais.quantidade,
      );

      if (
        solicitacaoListarEmailsTransacionais.de &&
        solicitacaoListarEmailsTransacionais.ate &&
        Date.parse(solicitacaoListarEmailsTransacionais.de) >
          Date.parse(solicitacaoListarEmailsTransacionais.ate)
      ) {
        throw new ErroRegraNegocioHttp("O período informado é inválido.");
      }

      return criarRespostaSucesso(
        await servicoEmails.listarHistoricoEmails(solicitacaoListarEmailsTransacionais),
        "Histórico de e-mails consultado.",
      );
    },

    async obterMetricas(
      solicitacaoObterMetricasNaoUtilizada: ContratosApi.ObterMetricasEmailsRequestModel,
    ) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      return criarRespostaSucesso(
        await servicoEmails.obterMetricasEmails(),
        "Métricas de e-mails consultadas.",
      );
    },

    async reprocessarFalha(solicitacaoReprocessarEmail: ContratosApi.ReprocessarEmailRequestModel) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      validarIdentificador(solicitacaoReprocessarEmail.idEmailTransacional, "um e-mail");

      if (
        !(await servicoEmails.reprocessarEmailComFalha(
          solicitacaoReprocessarEmail.idEmailTransacional,
        ))
      ) {
        throw new ErroRegraNegocioHttp("O e-mail não permite reprocessamento seguro.", 409);
      }

      return criarRespostaSucesso(
        { reprocessamentoSolicitado: true },
        "Reprocessamento solicitado.",
      );
    },

    async listarFluxos(
      solicitacaoListarFluxosNaoUtilizada: ContratosApi.ListarFluxosEmailRequestModel,
    ) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      return criarRespostaSucesso(
        { fluxos: await servicoEmails.listarFluxosEmail() },
        "Workflows consultados.",
      );
    },

    async atualizarFluxo(
      solicitacaoAtualizarFluxoEmail: ContratosApi.AtualizarFluxoEmailRequestModel,
    ) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      if (
        !tiposEventoEmailTransacional.includes(
          solicitacaoAtualizarFluxoEmail.tipoEvento as (typeof tiposEventoEmailTransacional)[number],
        ) ||
        solicitacaoAtualizarFluxoEmail.habilitado === null
      ) {
        throw new ErroRegraNegocioHttp("Informe um tipo de e-mail e um estado válidos.");
      }

      return criarRespostaSucesso(
        await servicoEmails.atualizarFluxoEmail(
          solicitacaoAtualizarFluxoEmail.tipoEvento,
          solicitacaoAtualizarFluxoEmail.habilitado,
        ),
        "Workflow atualizado.",
      );
    },
  };
}
