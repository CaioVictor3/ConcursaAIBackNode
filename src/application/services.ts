import { Context } from "./context.js";
import { catalogHandlers } from "./catalog.js";
import { examHandlers, questionHandlers } from "./exams.js";
import {
  simulationHandlers,
  attemptHandlers,
  studyHandlers,
} from "./simulations.js";
import { identityHandlers, supportHandlers } from "./identity-support.js";
import { communicationHandlers } from "./communication.js";
import { aiHandlers } from "./ai.js";
import { Auth } from "./auth.js";
import { Repository } from "../infrastructure/repository.js";
import { OpenAIProvider, consultCep } from "../infrastructure/providers.js";
import type { Database, UserContext } from "../infrastructure/database.js";
import { success } from "../domain/errors.js";
import type * as M from "../contracts/models.js";
export function createServices(
  db: Database,
  auth: Auth,
  ai: OpenAIProvider,
  user: UserContext,
  signal?: AbortSignal,
) {
  const ctx = new Context(new Repository(db, user)),
    sim = simulationHandlers(ctx),
    attempt = attemptHandlers(ctx, sim);
  return {
    ...catalogHandlers(ctx),
    ...examHandlers(ctx, attempt.obterTentativaSimulado),
    ...questionHandlers(ctx),
    ...sim,
    ...attempt,
    ...studyHandlers(ctx, sim),
    ...identityHandlers(ctx),
    ...supportHandlers(ctx),
    ...communicationHandlers(ctx, auth.emails),
    ...aiHandlers(ctx, attempt, ai, signal),
    ...auth.handlers(user, signal),
    consultarCep: async (q: M.ConsultarCepRequestModel) =>
      success(
        await consultCep(q.cep, db.config.viaCepUrl, ai.http, signal),
        "CEP consultado.",
      ),
    verificarSistema: async (_q: M.VerificarSistemaRequestModel) =>
      success(
        {
          aplicacao: "ConcursaAI",
          versaoDotNet: process.versions.node,
          bancoConfigurado: db.configured,
        },
        "API em execução. A presença de configuração não representa um teste de conectividade com o PostgreSQL.",
      ),
  };
}
export type Services = ReturnType<typeof createServices>;
