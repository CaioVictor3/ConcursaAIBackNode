import "dotenv/config";
import { readFileSync } from "node:fs";

export function carregarConfiguracoesAmbiente(env: NodeJS.ProcessEnv = process.env) {
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

  const obterListaAmbiente = (name: string, fallback = "") =>
    obterTextoAmbiente(name, fallback)
      .split(",")
      .map((valorAtual) => valorAtual.trim())
      .filter(Boolean);

  const keyText = obterTextoAmbiente(
    "AUTH_SIGNING_KEY",
    obterTextoAmbiente("Autenticacao__ChaveAssinatura"),
  );

  const chaveConfiguracao = /^[A-Za-z0-9+/]+={0,2}$/.test(keyText)
    ? Buffer.from(keyText, "base64")
    : Buffer.alloc(0);

  const production = obterTextoAmbiente("NODE_ENV", "development") === "production";

  if (production && chaveConfiguracao.length < 64) {
    throw new Error("AUTH_SIGNING_KEY deve conter pelo menos 64 bytes em base64.");
  }

  const origins = obterListaAmbiente("CORS_ORIGINS");

  for (const origin of origins) {
    const url = new URL(origin);

    if (
      url.origin !== origin ||
      url.username ||
      (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.protocol !== "https:")
    ) {
      throw new Error("CORS_ORIGINS contém uma origem inválida.");
    }
  }

  return {
    production,
    host: obterTextoAmbiente("HOST", "127.0.0.1"),
    port: obterNumeroAmbiente("PORT", 3000, 1, 65535),
    origins,
    trustProxy: obterNumeroAmbiente("TRUST_PROXY_HOPS", 0, 0, 10),
    logLevel: obterTextoAmbiente("LOG_LEVEL", "info"),
    databaseUrl: obterTextoAmbiente(
      "DATABASE_URL",
      obterTextoAmbiente("ConnectionStrings__ConcursaAI"),
    ),
    databaseCa: obterTextoAmbiente("DATABASE_CA_FILE")
      ? readFileSync(obterTextoAmbiente("DATABASE_CA_FILE"), "utf8")
      : undefined,
    poolMax: obterNumeroAmbiente("DATABASE_POOL_MAX", 20, 1, 100),
    databaseTimeout: obterNumeroAmbiente("DATABASE_TIMEOUT_MS", 15000, 100, 120000),
    databaseCommandTimeout: obterNumeroAmbiente("DATABASE_COMMAND_TIMEOUT_MS", 60000, 100, 300000),
    auth: {
      key: chaveConfiguracao,
      issuer: obterTextoAmbiente("AUTH_ISSUER", "ConcursaAI"),
      audience: obterTextoAmbiente("AUTH_AUDIENCE", "ConcursaAI"),
      accessMinutes: obterNumeroAmbiente("AUTH_ACCESS_MINUTES", 15, 5, 30),
      sessionDays: obterNumeroAmbiente("AUTH_SESSION_DAYS", 7, 1, 30),
      clientUrl: obterTextoAmbiente("AUTH_CLIENT_URL"),
      googleClientId: obterTextoAmbiente("GOOGLE_CLIENT_ID"),
      googleClientSecret: obterTextoAmbiente("GOOGLE_CLIENT_SECRET"),
      googleAuthorizationUrl: obterTextoAmbiente(
        "GOOGLE_AUTHORIZATION_URL",
        "https://accounts.google.com/o/oauth2/v2/auth",
      ),
      googleTokenUrl: obterTextoAmbiente("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
      googleDiscoveryUrl: obterTextoAmbiente(
        "GOOGLE_DISCOVERY_URL",
        "https://accounts.google.com/.well-known/openid-configuration",
      ),
    },
    openai: {
      key: obterTextoAmbiente("OPENAI_API_KEY"),
      model: obterTextoAmbiente("OPENAI_MODEL", "gpt-4.1-mini"),
      responsesUrl: obterTextoAmbiente(
        "OPENAI_RESPONSES_URL",
        "https://api.openai.com/v1/responses",
      ),
    },
    viaCepUrl: obterTextoAmbiente("VIACEP_URL", "https://viacep.com.br/ws/"),
    email: {
      appName: obterTextoAmbiente("EMAIL_APP_NAME", "ConcursaAI"),
      key: obterTextoAmbiente("RESEND_API_KEY"),
      from: obterTextoAmbiente("RESEND_FROM"),
      fromName: obterTextoAmbiente("RESEND_FROM_NAME", "ConcursaAI"),
      webhookSecret: obterTextoAmbiente("RESEND_WEBHOOK_SECRET"),
      url: obterTextoAmbiente("RESEND_URL", "https://api.resend.com/"),
      worker: obterBooleanoAmbiente("EMAIL_WORKER_ENABLED", true),
      interval: obterNumeroAmbiente("EMAIL_INTERVAL_SECONDS", 15, 2, 300),
      batch: obterNumeroAmbiente("EMAIL_BATCH_SIZE", 25, 1, 100),
      attempts: obterNumeroAmbiente("EMAIL_MAX_ATTEMPTS", 5, 1, 20),
      reservation: obterNumeroAmbiente("EMAIL_RESERVATION_SECONDS", 120, 30, 900),
      retryBase: obterNumeroAmbiente("EMAIL_RETRY_BASE_SECONDS", 30, 1, 3600),
      retryMax: obterNumeroAmbiente("EMAIL_RETRY_MAX_SECONDS", 3600, 1, 86400),
      retention: obterNumeroAmbiente("EMAIL_RETENTION_DAYS", 90, 30, 3650),
      inactivityDays: obterListaAmbiente("EMAIL_INACTIVITY_DAYS", "7,15,30")
        .map(Number)
        .filter(
          (quantidadeDiasInatividade) =>
            Number.isInteger(quantidadeDiasInatividade) &&
            quantidadeDiasInatividade > 0 &&
            quantidadeDiasInatividade <= 365,
        ),
      workflows: {
        EMAIL_VERIFICATION: obterBooleanoAmbiente("EMAIL_VERIFICATION_ENABLED", true),
        WELCOME_EMAIL: obterBooleanoAmbiente("EMAIL_WELCOME_ENABLED", true),
        PASSWORD_RESET: obterBooleanoAmbiente("EMAIL_PASSWORD_RESET_ENABLED", true),
        USER_INACTIVE: obterBooleanoAmbiente("EMAIL_INACTIVE_ENABLED", false),
      },
    },
  };
}

export type ConfiguracoesAmbiente = ReturnType<typeof carregarConfiguracoesAmbiente>;
