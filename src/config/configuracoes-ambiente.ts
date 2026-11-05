import "./carregar-arquivo-ambiente.js";
import { readFileSync } from "node:fs";

export function carregarConfiguracoesAmbiente(
  env: NodeJS.ProcessEnv = process.env,
  opcoes: { supabase?: boolean } = {},
) {
  const obterTextoAmbiente = (name: string, fallback = "") => env[name] ?? fallback;

  const obterNumeroAmbiente = (
    name: string,
    fallback: number,
    tamanhoMinimo = 1,
    tamanhoMaximo = 86400,
  ) => {
    const valorAtual = env[name] === undefined ? fallback : Number(env[name]);

    if (!Number.isInteger(valorAtual) || valorAtual < tamanhoMinimo || valorAtual > tamanhoMaximo) {
      throw new Error(`Configuração inválida: ${name}`);
    }

    return valorAtual;
  };

  const obterBooleanoAmbiente = (name: string, fallback: boolean) => {
    if (env[name] === undefined) {
      return fallback;
    }

    if (!["true", "false"].includes(env[name]!)) {
      throw new Error(`Configuração inválida: ${name}`);
    }

    return env[name] === "true";
  };

  const obterPrecoTokensPorMilhao = (nome: string) => {
    const textoPreco = env[nome];

    if (textoPreco === undefined || textoPreco === "") {
      return null;
    }

    const precoPorMilhao = Number(textoPreco);

    if (!Number.isFinite(precoPorMilhao) || precoPorMilhao < 0 || precoPorMilhao > 1000) {
      throw new Error(`Configuração inválida: ${nome}`);
    }

    return precoPorMilhao;
  };

  const obterListaAmbiente = (name: string, fallback = "") =>
    obterTextoAmbiente(name, fallback)
      .split(",")
      .map((valorAtual) => valorAtual.trim())
      .filter(Boolean);

  const keyText = obterTextoAmbiente("AUTHENTICATION_LEGACY_TOKEN_SIGNING_KEY");

  const chaveConfiguracao = /^[A-Za-z0-9+/]+={0,2}$/.test(keyText)
    ? Buffer.from(keyText, "base64")
    : Buffer.alloc(0);

  const production = obterTextoAmbiente("NODE_ENV", "development") === "production";

  if (production && !opcoes.supabase && chaveConfiguracao.length < 64) {
    throw new Error(
      "AUTHENTICATION_LEGACY_TOKEN_SIGNING_KEY deve conter pelo menos 64 bytes em base64.",
    );
  }

  const frontendUrl = obterTextoAmbiente("FRONTEND_APPLICATION_URL").trim();
  const origins = obterListaAmbiente("BACKEND_CORS_ALLOWED_ORIGINS", frontendUrl);

  const origensConfiguradas = frontendUrl ? [...origins, frontendUrl] : origins;
  for (const origin of origensConfiguradas) {
    const url = new URL(origin);
    const httpLocal =
      url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

    if (url.origin !== origin || (url.protocol !== "https:" && !httpLocal)) {
      throw new Error("Configure uma origem HTTPS ou HTTP local para o frontend, sem caminho.");
    }
  }

  return {
    production,
    host: obterTextoAmbiente("HOST", "127.0.0.1"),
    port: obterNumeroAmbiente("PORT", 3000, 1, 65535),
    origins,
    trustProxy: obterNumeroAmbiente("BACKEND_TRUSTED_PROXY_HOP_COUNT", 0, 0, 10),
    logLevel: obterTextoAmbiente("BACKEND_LOG_LEVEL", "info"),
    databaseUrl: opcoes.supabase ? "" : obterTextoAmbiente("POSTGRESQL_CONNECTION_URL"),
    databaseCa:
      !opcoes.supabase && obterTextoAmbiente("POSTGRESQL_ROOT_CA_CERTIFICATE_FILE")
        ? readFileSync(obterTextoAmbiente("POSTGRESQL_ROOT_CA_CERTIFICATE_FILE"), "utf8")
        : undefined,
    poolMax: obterNumeroAmbiente("POSTGRESQL_CONNECTION_POOL_MAX_SIZE", 20, 1, 100),
    databaseTimeout: obterNumeroAmbiente(
      "POSTGRESQL_CONNECTION_TIMEOUT_MILLISECONDS",
      15000,
      100,
      120000,
    ),
    databaseCommandTimeout: obterNumeroAmbiente(
      "POSTGRESQL_COMMAND_TIMEOUT_MILLISECONDS",
      60000,
      100,
      300000,
    ),
    auth: {
      key: chaveConfiguracao,
      issuer: obterTextoAmbiente("AUTHENTICATION_TOKEN_ISSUER", "ConcursaAI"),
      audience: obterTextoAmbiente("AUTHENTICATION_TOKEN_AUDIENCE", "ConcursaAI"),
      accessMinutes: obterNumeroAmbiente("AUTHENTICATION_ACCESS_TOKEN_DURATION_MINUTES", 15, 5, 30),
      sessionDays: obterNumeroAmbiente("AUTHENTICATION_SESSION_DURATION_DAYS", 7, 1, 30),
      clientUrl: frontendUrl,
      googleClientId: obterTextoAmbiente("GOOGLE_OAUTH_CLIENT_ID"),
      googleClientSecret: obterTextoAmbiente("GOOGLE_OAUTH_CLIENT_SECRET"),
      googleAuthorizationUrl: obterTextoAmbiente(
        "GOOGLE_OAUTH_AUTHORIZATION_URL",
        "https://accounts.google.com/o/oauth2/v2/auth",
      ),
      googleTokenUrl: obterTextoAmbiente(
        "GOOGLE_OAUTH_TOKEN_URL",
        "https://oauth2.googleapis.com/token",
      ),
      googleDiscoveryUrl: obterTextoAmbiente(
        "GOOGLE_OAUTH_DISCOVERY_URL",
        "https://accounts.google.com/.well-known/openid-configuration",
      ),
    },
    openai: {
      key: obterTextoAmbiente("OPENAI_API_KEY"),
      model: obterTextoAmbiente("OPENAI_MODEL_NAME", "gpt-4.1-mini"),
      precoEntradaPorMilhaoUsd: obterPrecoTokensPorMilhao(
        "OPENAI_INPUT_PRICE_PER_MILLION_TOKENS_USD",
      ),
      precoSaidaPorMilhaoUsd: obterPrecoTokensPorMilhao(
        "OPENAI_OUTPUT_PRICE_PER_MILLION_TOKENS_USD",
      ),
      responsesUrl: obterTextoAmbiente(
        "OPENAI_RESPONSES_API_URL",
        "https://api.openai.com/v1/responses",
      ),
    },
    viaCepUrl: obterTextoAmbiente("VIACEP_API_BASE_URL", "https://viacep.com.br/ws/"),
    email: {
      appName: obterTextoAmbiente("TRANSACTIONAL_EMAIL_APPLICATION_NAME", "ConcursaAI"),
      key: obterTextoAmbiente("RESEND_API_KEY"),
      from: obterTextoAmbiente("RESEND_SENDER_EMAIL_ADDRESS"),
      fromName: obterTextoAmbiente("RESEND_SENDER_DISPLAY_NAME", "ConcursaAI"),
      webhookSecret: obterTextoAmbiente("RESEND_WEBHOOK_SIGNING_SECRET"),
      url: obterTextoAmbiente("RESEND_API_BASE_URL", "https://api.resend.com/"),
      worker: obterBooleanoAmbiente("TRANSACTIONAL_EMAIL_WORKER_ENABLED", true),
      interval: obterNumeroAmbiente("TRANSACTIONAL_EMAIL_WORKER_INTERVAL_SECONDS", 15, 2, 300),
      batch: obterNumeroAmbiente("TRANSACTIONAL_EMAIL_WORKER_BATCH_SIZE", 25, 1, 100),
      attempts: obterNumeroAmbiente("TRANSACTIONAL_EMAIL_MAX_DELIVERY_ATTEMPTS", 5, 1, 20),
      reservation: obterNumeroAmbiente(
        "TRANSACTIONAL_EMAIL_RESERVATION_DURATION_SECONDS",
        120,
        30,
        900,
      ),
      retryBase: obterNumeroAmbiente("TRANSACTIONAL_EMAIL_RETRY_BASE_DELAY_SECONDS", 30, 1, 3600),
      retryMax: obterNumeroAmbiente("TRANSACTIONAL_EMAIL_RETRY_MAX_DELAY_SECONDS", 3600, 1, 86400),
      retention: obterNumeroAmbiente("TRANSACTIONAL_EMAIL_HISTORY_RETENTION_DAYS", 90, 30, 3650),
      inactivityDays: obterListaAmbiente("TRANSACTIONAL_EMAIL_INACTIVITY_THRESHOLD_DAYS", "7,15,30")
        .map(Number)
        .filter(
          (quantidadeDiasInatividade) =>
            Number.isInteger(quantidadeDiasInatividade) &&
            quantidadeDiasInatividade > 0 &&
            quantidadeDiasInatividade <= 365,
        ),
      workflows: {
        EMAIL_VERIFICATION: obterBooleanoAmbiente("TRANSACTIONAL_EMAIL_VERIFICATION_ENABLED", true),
        WELCOME_EMAIL: obterBooleanoAmbiente("TRANSACTIONAL_EMAIL_WELCOME_ENABLED", true),
        PASSWORD_RESET: obterBooleanoAmbiente("TRANSACTIONAL_EMAIL_PASSWORD_RESET_ENABLED", true),
        USER_INACTIVE: obterBooleanoAmbiente("TRANSACTIONAL_EMAIL_INACTIVE_USER_ENABLED", false),
        SUBSCRIPTION_EXPIRING: obterBooleanoAmbiente(
          "TRANSACTIONAL_EMAIL_SUBSCRIPTION_EXPIRING_ENABLED",
          true,
        ),
      },
    },
  };
}

export type ConfiguracoesAmbiente = ReturnType<typeof carregarConfiguracoesAmbiente>;
