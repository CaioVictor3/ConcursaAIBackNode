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
  const ambiente = env.MP_AMBIENTE ?? "teste";
  if (!["teste", "producao"].includes(ambiente)) throw falha();
  if (ambiente === "producao" && env.MP_PRODUCAO_HABILITADA !== "true") throw falha();
  const accessToken = env.MP_ACCESS_TOKEN ?? "";
  const webhookSecret = env.MP_WEBHOOK_SECRET ?? "";
  const sellerId = env.MP_SELLER_ID ?? "";
  const applicationId = env.MP_APPLICATION_ID ?? "";
  const retornoUrl = env.MP_RETORNO_URL ?? "";
  const maxParcelas = Number(env.MP_MAX_PARCELAS ?? "1");
  const timeoutMs = Number(env.MP_TIMEOUT_MS ?? "7000");
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
