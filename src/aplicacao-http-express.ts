import cors from "cors";
import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { randomBytes, randomUUID } from "node:crypto";
import { pino, type Logger } from "pino";
import swaggerUi from "swagger-ui-express";
import { ServicoAutenticacaoContasSessoes } from "./application/autenticacao-contas-sessoes.service.js";
import { criarServicosAplicacaoApi, type Services } from "./application/composicao-servicos-api.js";
import {
  carregarConfiguracoesAmbiente,
  type ConfiguracoesAmbiente,
} from "./config/configuracoes-ambiente.js";
import routes from "./contracts/rotas-publicas-api.json" with { type: "json" };
import { vincularRequisicaoAoContrato } from "./contracts/validacao-conversao-contratos-api.js";
import {
  classificarErroAplicacao,
  criarRespostaErro,
  criarRespostaSucesso,
  ErroRegraNegocioHttp,
} from "./domain/erros-validacoes-respostas-api.js";
import {
  GerenciadorCookiesSessaoNavegador,
  type TokensSessaoNavegador,
} from "./http/cookies-sessao-navegador.js";
import { criarDespachoOperacoesApi } from "./http/despacho-operacoes-rotas-api.js";
import { gerarDocumentoOpenApi } from "./http/documentacao-openapi.js";
import { criarRotasPerguntasContextuaisAnaliseIA } from "./http/rotas-perguntas-contextuais-analise-ia.js";
import { criarRotasSistemaHonraAnotacoes } from "./http/rotas-sistema-honra-anotacoes.js";
import { ClienteAnaliseQuestoesOpenAI } from "./infrastructure/cliente-analise-questoes-openai.js";
import { ClienteAutenticacaoGoogle } from "./infrastructure/cliente-autenticacao-google.js";
import {
  ConexaoTransacoesPostgreSql,
  type IdentidadeUsuarioAutenticado,
} from "./infrastructure/conexao-transacoes-postgresql.js";
import { ServicoEnvioEmailsTransacionaisResend } from "./infrastructure/envio-emails-transacionais-resend.js";
import { RepositorioContasSessoesPostgreSql } from "./infrastructure/repositorio-contas-sessoes-postgresql.js";
import type { HttpFetch } from "./infrastructure/seguranca-requisicoes-https.js";

export interface OpcoesInicializacaoAplicacao {
  config?: ConfiguracoesAmbiente;
  database?: ConexaoTransacoesPostgreSql;
  logger?: Logger;
  fetch?: HttpFetch;
}

export function criarAplicacaoHttpExpress(options: OpcoesInicializacaoAplicacao = {}) {
  const config = options.config ?? carregarConfiguracoesAmbiente();

  const conexaoPostgreSql = options.database ?? new ConexaoTransacoesPostgreSql(config);

  const registradorEventos =
    options.logger ??
    pino({
      level: config.logLevel,
      redact: [
        "authorization",
        "cookie",
        "password",
        "senha",
        "token",
        "refreshToken",
        "accessToken",
      ],
    });

  const clienteHttp = options.fetch ?? fetch;

  const servicoEmailsTransacionais = new ServicoEnvioEmailsTransacionaisResend(
    conexaoPostgreSql,
    config,
    clienteHttp,
  );

  const servicoAutenticacao = new ServicoAutenticacaoContasSessoes(
    config,
    new RepositorioContasSessoesPostgreSql(conexaoPostgreSql),
    servicoEmailsTransacionais,
    new ClienteAutenticacaoGoogle(config, clienteHttp),
  );

  const clienteOpenAI = new ClienteAnaliseQuestoesOpenAI(config, clienteHttp);

  const gerenciadorCookiesNavegador = new GerenciadorCookiesSessaoNavegador(config);

  const aplicacaoExpress = express();

  aplicacaoExpress.disable("x-powered-by");

  aplicacaoExpress.set("trust proxy", config.trustProxy);

  aplicacaoExpress.use(helmet({ contentSecurityPolicy: false }));

  aplicacaoExpress.use((requisicaoHttp, respostaHttp, next) => {
    respostaHttp.setHeader("Cache-Control", "no-store");

    const identificadorRequisicao = randomUUID();

    respostaHttp.setHeader("X-Request-Id", identificadorRequisicao);

    const start = Date.now();

    respostaHttp.on("finish", () =>
      registradorEventos.info(
        {
          requestId: identificadorRequisicao,
          method: requisicaoHttp.method,
          path: requisicaoHttp.path,
          status: respostaHttp.statusCode,
          durationMs: Date.now() - start,
        },
        "HTTP",
      ),
    );

    next();
  });

  aplicacaoExpress.use(
    cors({
      origin(origin, cb) {
        cb(null, !!origin && config.origins.includes(origin));
      },

      credentials: true,
    }),
  );

  aplicacaoExpress.use((requisicaoHttp, respostaHttp, next) => {
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(requisicaoHttp.method);

    const session = gerenciadorCookiesNavegador.lerCookieCriptografado<TokensSessaoNavegador>(
      requisicaoHttp,
      "sessao",
    );

    if (mutation && (requisicaoHttp.path.toLowerCase().startsWith("/api/navegador") || session)) {
      if (
        requisicaoHttp.get("X-Concursa-Client") !== "web" ||
        !config.origins.includes(requisicaoHttp.get("Origin") ?? "")
      ) {
        respostaHttp
          .status(403)
          .json(criarRespostaErro(403, "Origem da solicitação não autorizada."));

        return;
      }
    }

    next();
  });

  const limiter = (limit: number) =>
    rateLimit({
      windowMs: 60000,
      limit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req, respostaHttp) => {
        respostaHttp
          .status(429)
          .json(criarRespostaErro(429, "Muitas tentativas. Aguarde um minuto e tente novamente."));
      },
    });

  const authLimit = limiter(10);

  const cepLimit = limiter(30);

  const webhookProblem = (respostaHttp: Response, status: number) =>
    respostaHttp
      .status(status)
      .type("application/problem+json")
      .json({
        type: "https://tools.ietf.org/html/rfc9110#section-15.5." + (status === 401 ? "2" : "1"),
        title: status === 401 ? "Unauthorized" : "Bad Request",
        status,
        traceId:
          "00-" + randomBytes(16).toString("hex") + "-" + randomBytes(8).toString("hex") + "-00",
      });

  aplicacaoExpress.post(
    "/api/ResendWebhook/registrar-evento-entrega",
    express.raw({ type: () => true, limit: 65536 }),
    async (requisicaoHttp, respostaHttp) => {
      const body = requisicaoHttp.body as Buffer;

      if (
        !Buffer.isBuffer(body) ||
        !servicoEmailsTransacionais.validarAssinaturaWebhook(
          requisicaoHttp.get("svix-id") ?? "",
          requisicaoHttp.get("svix-timestamp") ?? "",
          requisicaoHttp.get("svix-signature") ?? "",
          body,
        )
      ) {
        webhookProblem(respostaHttp, 401);

        return;
      }

      let event: { type?: unknown; data?: { email_id?: unknown } };

      try {
        event = JSON.parse(body.toString());

        if (typeof event.type !== "string" || typeof event.data?.email_id !== "string") {
          webhookProblem(respostaHttp, 400);

          return;
        }
      } catch {
        webhookProblem(respostaHttp, 400);

        return;
      }

      if (event.type?.trim() && event.data?.email_id?.trim()) {
        await servicoEmailsTransacionais.registrarEventoWebhook(
          requisicaoHttp.get("svix-id")!,
          event.data.email_id,
          event.type,
        );
      }

      respostaHttp.json(criarRespostaSucesso({ recebido: true }, "Evento recebido."));
    },
  );

  aplicacaoExpress.use(express.json({ limit: "10mb", strict: true }));

  aplicacaoExpress.get("/api/health", (_req, respostaHttp) =>
    respostaHttp.json(
      criarRespostaSucesso(
        {
          status: "healthy",
          aplicacao: "ConcursaAI",
          runtime: "node",
          bancoConfigurado: conexaoPostgreSql.estaConfigurada,
        },
        "API em execução.",
      ),
    ),
  );

  const spec = gerarDocumentoOpenApi();

  aplicacaoExpress.get(["/openapi/v1.json", "/api/openapi.json"], (_req, respostaHttp) =>
    respostaHttp.json(spec),
  );

  aplicacaoExpress.use("/api/docs", swaggerUi.serve, swaggerUi.setup(spec));

  for (const route of routes) {
    if (route.controller === "ResendWebhook") {
      continue;
    }
    // Authorization precedes rate limiting, as in the original pipeline.

    const run = async (requisicaoHttp: Request, respostaHttp: Response) => {
      const cancellation = new AbortController();

      requisicaoHttp.once("aborted", () => cancellation.abort());

      respostaHttp.once("close", () => {
        if (!respostaHttp.writableFinished) {
          cancellation.abort();
        }
      });

      let user: IdentidadeUsuarioAutenticado = { id: "", sessionId: "", token: "" };

      const header = requisicaoHttp.get("Authorization");

      const access =
        header?.match(/^Bearer\s+(.+)$/i)?.[1] ??
        (!header
          ? gerenciadorCookiesNavegador.lerCookieCriptografado<TokensSessaoNavegador>(
              requisicaoHttp,
              "sessao",
            )?.accessToken
          : undefined);

      if (access) {
        try {
          user = await servicoAutenticacao.autenticarTokenAcessoJwt(access);
        } catch (error) {
          if (!route.anonymous) {
            throw error;
          }
        }
      }

      if (!route.anonymous && !user.id) {
        respostaHttp.setHeader("WWW-Authenticate", "Bearer");

        throw new ErroRegraNegocioHttp("Entre na sua conta para continuar.", 401);
      }

      const execute = async () => {
        const services = criarServicosAplicacaoApi(
          conexaoPostgreSql,
          servicoAutenticacao,
          clienteOpenAI,
          user,
          cancellation.signal,
        );

        if (route.controller === "Navegador") {
          await browser(
            route.action,
            requisicaoHttp,
            respostaHttp,
            services,
            gerenciadorCookiesNavegador,
          );

          return;
        }

        const handlers = criarDespachoOperacoesApi(services, route.binding === "query");

        const handler = handlers[route.path as keyof typeof handlers];

        if (!handler) {
          throw new Error("Endpoint sem implementação.");
        }

        const input = route.binding === "query" ? requisicaoHttp.query : requisicaoHttp.body;

        if (input === undefined) {
          throw new ErroRegraNegocioHttp(
            "Confira os campos informados e envie uma requisição válida.",
          );
        }

        respostaHttp.json(await handler(input));
      };

      const limit =
        route.controller === "Autenticacao" || route.controller === "Navegador"
          ? authLimit
          : route.controller === "Cep"
            ? cepLimit
            : null;

      if (limit) {
        await new Promise<void>((resolve, reject) => {
          limit(requisicaoHttp, respostaHttp, (error) => {
            if (error) {
              reject(error);

              return;
            }

            execute().then(resolve, reject);
          });

          respostaHttp.once("finish", resolve);
        });
      } else {
        await execute();
      }
    };

    const method = route.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";

    aplicacaoExpress[method](route.path, run);
  }

  aplicacaoExpress.use(
    criarRotasSistemaHonraAnotacoes(
      conexaoPostgreSql,
      servicoAutenticacao,
      gerenciadorCookiesNavegador,
    ),
  );

  aplicacaoExpress.use(
    criarRotasPerguntasContextuaisAnaliseIA(
      conexaoPostgreSql,
      servicoAutenticacao,
      gerenciadorCookiesNavegador,
      clienteOpenAI,
    ),
  );

  aplicacaoExpress.use((_req, respostaHttp) =>
    respostaHttp.status(404).json(criarRespostaErro(404, "Endpoint não encontrado.")),
  );

  const errors: ErrorRequestHandler = (error, requisicaoHttp, respostaHttp, _next) => {
    if (respostaHttp.headersSent) {
      _next(error);

      return;
    }

    if (requisicaoHttp.aborted) {
      respostaHttp.status(499).end();

      return;
    }

    const { status, message } = classificarErroAplicacao(error);

    if (status === 401) {
      respostaHttp.setHeader("WWW-Authenticate", "Bearer");
    }

    registradorEventos.warn(
      {
        requestId: respostaHttp.getHeader("X-Request-Id"),
        status,
        errorType: error instanceof Error ? error.name : "Unknown",
      },
      "Requisição recusada",
    );

    respostaHttp.status(status).json(criarRespostaErro(status, message));
  };

  aplicacaoExpress.use(errors);

  return {
    app: aplicacaoExpress,
    db: conexaoPostgreSql,
    config,
    logger: registradorEventos,
    emails: servicoEmailsTransacionais,
    auth: servicoAutenticacao,
  };
}

export async function browser(
  action: string,
  requisicaoHttp: Request,
  respostaHttp: Response,
  services: Services,
  gerenciadorCookiesNavegador: GerenciadorCookiesSessaoNavegador,
) {
  const salvarBrowser = (textoNormalizado: Awaited<ReturnType<Services["entrarEstudante"]>>) => {
    if (!textoNormalizado.data) {
      throw new ErroRegraNegocioHttp("Sessão indisponível.", 503);
    }

    respostaHttp.json({
      ...gerenciadorCookiesNavegador.gravarCookiesSessao(respostaHttp, textoNormalizado.data),
      message: textoNormalizado.message,
    });
  };

  if (requisicaoHttp.method !== "GET" && requisicaoHttp.body === undefined) {
    throw new ErroRegraNegocioHttp("Confira os campos informados e envie uma requisição válida.");
  }

  switch (action) {
    case "obterConfiguracaoAcesso":
      respostaHttp.json(
        await services.obterConfiguracaoAcesso(
          vincularRequisicaoAoContrato(
            "ObterConfiguracaoAcessoRequestModel",
            requisicaoHttp.query,
            true,
          ),
        ),
      );
      return;
    case "obterVinculoGoogle":
      respostaHttp.json(
        await services.obterVinculoGoogle(
          vincularRequisicaoAoContrato(
            "ObterVinculoGoogleRequestModel",
            requisicaoHttp.query,
            true,
          ),
        ),
      );
      return;
    case "iniciarGoogle":
    case "iniciarVinculoGoogle": {
      vincularRequisicaoAoContrato(
        action === "iniciarGoogle"
          ? "IniciarGoogleRequestModel"
          : "IniciarVinculoGoogleRequestModel",
        requisicaoHttp.body,
      );

      const flow = await services[action]({
        origemFrontend: requisicaoHttp.get("Origin") ?? null,
      });

      if (!flow.data) {
        throw new ErroRegraNegocioHttp("Fluxo Google indisponível.", 503);
      }

      gerenciadorCookiesNavegador.gravarCookieCriptografado(respostaHttp, "google", flow.data);

      respostaHttp.json(criarRespostaSucesso({ url: flow.data.url }, flow.message));

      return;
    }
    case "concluirGoogle": {
      const solicitacaoBrowser = vincularRequisicaoAoContrato(
        "ConcluirGoogleRequestModel",
        requisicaoHttp.body,
      );

      const flow = gerenciadorCookiesNavegador.consumirEstadoGoogleCookie(
        requisicaoHttp,
        respostaHttp,
        solicitacaoBrowser.estado,
      );

      salvarBrowser(
        await services.trocarCodigoGoogle({
          codigo: solicitacaoBrowser.codigo,
          verificador: flow.verificador,
          nonce: flow.nonce,
          redirectUri: flow.redirectUri,
          idUsuarioVinculo: flow.idUsuarioVinculo,
        }),
      );

      return;
    }
    case "entrarEstudante":
      salvarBrowser(
        await services.entrarEstudante(
          vincularRequisicaoAoContrato("EntrarEstudanteRequestModel", requisicaoHttp.body),
        ),
      );
      return;
    case "entrarAdministrador":
      salvarBrowser(
        await services.entrarAdministrador(
          vincularRequisicaoAoContrato("EntrarAdministradorRequestModel", requisicaoHttp.body),
        ),
      );
      return;
    case "confirmarSessao":
      salvarBrowser(
        await services.renovarSessao(
          vincularRequisicaoAoContrato("RenovarSessaoRequestModel", requisicaoHttp.body),
        ),
      );
      return;
    case "renovarSessao": {
      vincularRequisicaoAoContrato("RenovarSessaoNavegadorRequestModel", requisicaoHttp.body);

      const textoNormalizado =
        gerenciadorCookiesNavegador.lerCookieCriptografado<TokensSessaoNavegador>(
          requisicaoHttp,
          "sessao",
        );

      if (!textoNormalizado) {
        throw new ErroRegraNegocioHttp("Entre na sua conta para continuar.", 401);
      }

      try {
        salvarBrowser(
          await services.renovarSessao({ refreshToken: textoNormalizado.refreshToken }),
        );
      } catch (erroCapturado) {
        if (
          erroCapturado instanceof ErroRegraNegocioHttp &&
          [401, 403].includes(erroCapturado.status)
        ) {
          gerenciadorCookiesNavegador.removerCookie(respostaHttp, "sessao");
        }

        throw erroCapturado;
      }

      return;
    }
    case "sairSessao": {
      const respostaSaidaSessao = await services.sairSessao(
        vincularRequisicaoAoContrato("SairSessaoRequestModel", requisicaoHttp.body),
      );

      gerenciadorCookiesNavegador.removerCookie(respostaHttp, "sessao");

      respostaHttp.json(respostaSaidaSessao);

      return;
    }
    default:
      throw new Error("Endpoint de navegador desconhecido.");
  }
}
