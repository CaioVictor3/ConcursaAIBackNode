import "./carregar-arquivo-ambiente.js";
import { ErroRegraNegocioHttp } from "../domain/erros-validacoes-respostas-api.js";

export interface ConfiguracaoMercadoPago {
  accessToken: string;
  webhookSecret: string;
  sellerId: string;
  applicationId: string;
  ambiente: "teste" | "producao";
  retornoUrl: string;
  maxParcelas: number;
  timeoutMs: number;
}
export function carregarMercadoPago(env: NodeJS.ProcessEnv = process.env): ConfiguracaoMercadoPago {
  const falha = () =>
    new ErroRegraNegocioHttp(
      "Pagamentos indisponíveis. A configuração do Mercado Pago precisa ser concluída.",
      503,
    );
  const ambiente = env.MERCADO_PAGO_ENVIRONMENT ?? "teste";
  if (!["teste", "producao"].includes(ambiente)) throw falha();
  if (ambiente === "producao" && env.MERCADO_PAGO_PRODUCTION_ENABLED !== "true") throw falha();
  const accessToken = env.MERCADO_PAGO_ACCESS_TOKEN ?? "";
  const webhookSecret = env.MERCADO_PAGO_WEBHOOK_SIGNING_SECRET ?? "";
  const sellerId = env.MERCADO_PAGO_SELLER_ACCOUNT_ID ?? "";
  const applicationId = env.MERCADO_PAGO_APPLICATION_ID ?? "";
  const retornoUrl = env.MERCADO_PAGO_CHECKOUT_RETURN_URL ?? "";
  const maxParcelas = Number(env.MERCADO_PAGO_MAX_INSTALLMENTS ?? "1");
  const timeoutMs = Number(env.MERCADO_PAGO_REQUEST_TIMEOUT_MILLISECONDS ?? "7000");
  if (
    !accessToken ||
    webhookSecret.length < 16 ||
    !/^\d+$/.test(sellerId) ||
    !/^\d+$/.test(applicationId)
  )
    throw falha();
  // Orders credentials use APP_USR in BOTH environments. The prefix cannot identify test mode.
  if (!accessToken.startsWith("APP_USR-")) throw falha();
  try {
    const url = new URL(retornoUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
      throw falha();
  } catch {
    throw falha();
  }
  if (
    !Number.isInteger(maxParcelas) ||
    maxParcelas < 1 ||
    maxParcelas > 12 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > 10000
  )
    throw falha();
  return {
    accessToken,
    webhookSecret,
    sellerId,
    applicationId,
    ambiente: ambiente as ConfiguracaoMercadoPago["ambiente"],
    retornoUrl,
    maxParcelas,
    timeoutMs,
  };
}
