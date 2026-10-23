import type * as M from "../contracts/models.js";
import { Context } from "./context.js";
import { Emails, emailTypes } from "../infrastructure/emails.js";
import {
  identifier,
  pagination,
  ServiceError,
  success,
} from "../domain/errors.js";
export function communicationHandlers(ctx: Context, emails: Emails) {
  return {
    async obterMinhaPreferencia(_q: M.ObterPreferenciaComunicacaoRequestModel) {
      if (!ctx.repo.user.id)
        throw new ServiceError("Entre na sua conta para continuar.", 401);
      return success(
        { receberInatividade: await emails.preference(ctx.repo.user.id) },
        "Preferências consultadas.",
      );
    },
    async atualizarMinhaPreferencia(q: M.PreferenciaComunicacaoRequestModel) {
      if (!ctx.repo.user.id)
        throw new ServiceError("Entre na sua conta para continuar.", 401);
      await emails.setPreference(ctx.repo.user.id, q.receberInatividade);
      return success(
        { receberInatividade: q.receberInatividade },
        "Preferências atualizadas.",
      );
    },
    async listarHistorico(q: M.ListarEmailsTransacionaisRequestModel) {
      await ctx.admin();
      pagination(q.pagina, q.quantidade);
      if (q.de && q.ate && Date.parse(q.de) > Date.parse(q.ate))
        throw new ServiceError("O período informado é inválido.");
      return success(
        await emails.history(q),
        "Histórico de e-mails consultado.",
      );
    },
    async obterMetricas(_q: M.ObterMetricasEmailsRequestModel) {
      await ctx.admin();
      return success(
        await emails.metrics(),
        "Métricas de e-mails consultadas.",
      );
    },
    async reprocessarFalha(q: M.ReprocessarEmailRequestModel) {
      await ctx.admin();
      identifier(q.idEmailTransacional, "um e-mail");
      if (!(await emails.reprocess(q.idEmailTransacional)))
        throw new ServiceError(
          "O e-mail não permite reprocessamento seguro.",
          409,
        );
      return success(
        { reprocessamentoSolicitado: true },
        "Reprocessamento solicitado.",
      );
    },
    async listarFluxos(_q: M.ListarFluxosEmailRequestModel) {
      await ctx.admin();
      return success(
        { fluxos: await emails.workflows() },
        "Workflows consultados.",
      );
    },
    async atualizarFluxo(q: M.AtualizarFluxoEmailRequestModel) {
      await ctx.admin();
      if (
        !emailTypes.includes(q.tipoEvento as (typeof emailTypes)[number]) ||
        q.habilitado === null
      )
        throw new ServiceError(
          "Informe um tipo de e-mail e um estado válidos.",
        );
      return success(
        await emails.workflow(q.tipoEvento, q.habilitado),
        "Workflow atualizado.",
      );
    },
  };
}
