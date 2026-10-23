import 'dotenv/config';
import { readFileSync } from 'node:fs';

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const str = (name: string, fallback = '') => env[name] ?? fallback;
  const num = (name: string, fallback: number, min = 1, max = 86400) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Configuração inválida: ${name}`);
    return value;
  };
  const bool = (name: string, fallback: boolean) => {
    if (env[name] === undefined) return fallback;
    if (!['true', 'false'].includes(env[name]!)) throw new Error(`Configuração inválida: ${name}`);
    return env[name] === 'true';
  };
  const list = (name: string, fallback = '') => str(name, fallback).split(',').map(v => v.trim()).filter(Boolean);
  const keyText = str('AUTH_SIGNING_KEY', str('Autenticacao__ChaveAssinatura'));
  const key = /^[A-Za-z0-9+/]+={0,2}$/.test(keyText) ? Buffer.from(keyText, 'base64') : Buffer.alloc(0);
  const production = str('NODE_ENV', 'development') === 'production';
  if (production && key.length < 64) throw new Error('AUTH_SIGNING_KEY deve conter pelo menos 64 bytes em base64.');
  const origins = list('CORS_ORIGINS');
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol !== 'https:')) throw new Error('CORS_ORIGINS contém uma origem inválida.');
  }
  return {
    production, host: str('HOST', '127.0.0.1'), port: num('PORT', 3000, 1, 65535), origins,
    trustProxy: num('TRUST_PROXY_HOPS', 0, 0, 10), logLevel: str('LOG_LEVEL', 'info'),
    databaseUrl: str('DATABASE_URL', str('ConnectionStrings__ConcursaAI')),
    databaseCa: str('DATABASE_CA_FILE') ? readFileSync(str('DATABASE_CA_FILE'), 'utf8') : undefined,
    poolMax: num('DATABASE_POOL_MAX', 20, 1, 100), databaseTimeout: num('DATABASE_TIMEOUT_MS', 15000, 100, 120000),
    databaseCommandTimeout: num('DATABASE_COMMAND_TIMEOUT_MS', 60000, 100, 300000),
    auth: { key, issuer: str('AUTH_ISSUER', 'ConcursaAI'), audience: str('AUTH_AUDIENCE', 'ConcursaAI'),
      accessMinutes: num('AUTH_ACCESS_MINUTES', 15, 5, 30), sessionDays: num('AUTH_SESSION_DAYS', 7, 1, 30),
      clientUrl: str('AUTH_CLIENT_URL'), googleClientId: str('GOOGLE_CLIENT_ID'), googleClientSecret: str('GOOGLE_CLIENT_SECRET'),
      googleAuthorizationUrl: str('GOOGLE_AUTHORIZATION_URL', 'https://accounts.google.com/o/oauth2/v2/auth'),
      googleTokenUrl: str('GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token'),
      googleDiscoveryUrl: str('GOOGLE_DISCOVERY_URL', 'https://accounts.google.com/.well-known/openid-configuration') },
    openai: { key: str('OPENAI_API_KEY'), model: str('OPENAI_MODEL', 'gpt-4.1-mini'), responsesUrl: str('OPENAI_RESPONSES_URL', 'https://api.openai.com/v1/responses') },
    viaCepUrl: str('VIACEP_URL', 'https://viacep.com.br/ws/'),
    email: { appName: str('EMAIL_APP_NAME', 'ConcursaAI'), key: str('RESEND_API_KEY'), from: str('RESEND_FROM'), fromName: str('RESEND_FROM_NAME', 'ConcursaAI'), webhookSecret: str('RESEND_WEBHOOK_SECRET'), url: str('RESEND_URL', 'https://api.resend.com/'),
      worker: bool('EMAIL_WORKER_ENABLED', true), interval: num('EMAIL_INTERVAL_SECONDS', 15, 2, 300), batch: num('EMAIL_BATCH_SIZE', 25, 1, 100), attempts: num('EMAIL_MAX_ATTEMPTS', 5, 1, 20), reservation: num('EMAIL_RESERVATION_SECONDS', 120, 30, 900), retryBase: num('EMAIL_RETRY_BASE_SECONDS', 30, 1, 3600), retryMax: num('EMAIL_RETRY_MAX_SECONDS', 3600, 1, 86400), retention: num('EMAIL_RETENTION_DAYS', 90, 30, 3650), inactivityDays: list('EMAIL_INACTIVITY_DAYS', '7,15,30').map(Number).filter(d => Number.isInteger(d) && d > 0 && d <= 365),
      workflows: { EMAIL_VERIFICATION: bool('EMAIL_VERIFICATION_ENABLED', true), WELCOME_EMAIL: bool('EMAIL_WELCOME_ENABLED', true), PASSWORD_RESET: bool('EMAIL_PASSWORD_RESET_ENABLED', true), USER_INACTIVE: bool('EMAIL_INACTIVE_ENABLED', false) } }
  };
}
export type Config = ReturnType<typeof loadConfig>;
