import type * as ContratosApi from "../contracts/modelos-requisicoes-respostas-api.js";
import {
  ErroRegraNegocioHttp,
  criarRespostaSucesso,
} from "../domain/erros-validacoes-respostas-api.js";
import { ServicoEnvioEmailsTransacionaisResend } from "../infrastructure/envio-emails-transacionais-resend.js";
import { ServicoAutorizacaoUsuarioAutenticado } from "./autorizacao-usuario-autenticado.js";

export function operacoesPreferenciasComunicacao(
  contextoAutorizacao: ServicoAutorizacaoUsuarioAutenticado,
  servicoEmails: Pick<
    ServicoEnvioEmailsTransacionaisResend,
    "obterPreferenciaEmail" | "atualizarPreferenciaEmail"
  >,
) {
  return {
    async obterMinhaPreferencia(
      solicitacaoObterMinhaPreferenciaNaoUtilizada: ContratosApi.ObterPreferenciaComunicacaoRequestModel,
    ) {
      if (!contextoAutorizacao.repo.user.id) {
        throw new ErroRegraNegocioHttp("Entre na sua conta para continuar.", 401);
      }

      return criarRespostaSucesso(
        {
          receberInatividade: await servicoEmails.obterPreferenciaEmail(
            contextoAutorizacao.repo.user.id,
          ),
        },
        "Preferências consultadas.",
      );
    },

    async atualizarMinhaPreferencia(
      solicitacaoPreferenciaComunicacao: ContratosApi.PreferenciaComunicacaoRequestModel,
    ) {
      if (!contextoAutorizacao.repo.user.id) {
        throw new ErroRegraNegocioHttp("Entre na sua conta para continuar.", 401);
      }

      await servicoEmails.atualizarPreferenciaEmail(
        contextoAutorizacao.repo.user.id,
        solicitacaoPreferenciaComunicacao.receberInatividade,
      );

      return criarRespostaSucesso(
        { receberInatividade: solicitacaoPreferenciaComunicacao.receberInatividade },
        "Preferências atualizadas.",
      );
    },
  };
}
