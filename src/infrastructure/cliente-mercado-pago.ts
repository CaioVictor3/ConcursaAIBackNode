import { createHmac, timingSafeEqual } from "node:crypto";
import type { ConfiguracaoMercadoPago } from "../config/configuracoes-mercado-pago.js";
import { ErroRegraNegocioHttp } from "../domain/erros-validacoes-respostas-api.js";
import {
  centavos,
  decimalMonetario,
  statusOrder,
  type PedidoPagamento,
} from "../domain/pagamentos-assinaturas.js";

export interface OrderMercadoPago {
  id: string;
  type: string;
  processing_mode: string;
  status: string;
  status_detail: string;
  external_reference: string;
  total_amount: string;
  total_paid_amount: string;
  currency: string;
  user_id: string;
  last_updated_date: string;
  created_date: string;
  checkout_url?: string;
  live_mode?: boolean;
  integration_data: { application_id: string };
  transactions?: {
    payments?: {
      id: string;
      status: string;
      status_detail: string;
      amount: string;
      paid_amount: string;
      payment_method?: { id?: string; type?: string; installments?: number };
      reference?: { id?: string };
    }[];
    refunds?: { id: string; amount: string; status: string }[];
    chargebacks?: { id: string; status: string; case_id?: string }[];
  };
}
export function validarUrlCheckout(valor: unknown): string {
  if (typeof valor !== "string") throw new Error("Checkout sem URL.");
  const url = new URL(valor);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.mercadopago.com.br" ||
    url.port ||
    url.username ||
    url.password ||
    !url.pathname.startsWith("/checkout/")
  )
    throw new Error("URL de checkout não autorizada.");
  return url.href;
}
export function validarAssinaturaMercadoPago(request: Request, secret: string, agora = Date.now()) {
  const url = new URL(request.url);
  const id = url.searchParams.get("data.id") ?? "";
  const requestId = request.headers.get("x-request-id") ?? "";
  const partes = (request.headers.get("x-signature") ?? "")
    .split(",")
    .map((p) => p.trim().split("="));
  const ts = partes.filter((p) => p[0] === "ts");
  const v1 = partes.filter((p) => p[0] === "v1");
  const timestamp = ts[0]?.[1] ?? "";
  const assinatura = v1[0]?.[1] ?? "";
  // The official manifest lowercases alphanumeric data.id. Require all pairs for this integration.
  const invalida = () => new ErroRegraNegocioHttp("Assinatura do webhook inválida.", 401);
  if (
    !secret ||
    !/^ORD(?:TST)?[A-Z0-9]{20,40}$/i.test(id) ||
    url.searchParams.getAll("data.id").length !== 1 ||
    !/^[\w-]{1,200}$/.test(requestId) ||
    ts.length !== 1 ||
    v1.length !== 1 ||
    !/^\d{10,13}$/.test(timestamp) ||
    !/^[a-f0-9]{64}$/i.test(assinatura)
  )
    throw invalida();
  const tempo = Number(timestamp) * (timestamp.length <= 10 ? 1000 : 1);
  if (Math.abs(agora - tempo) > 300_000) throw invalida();
  const calculada = createHmac("sha256", secret)
    .update(`id:${id.toLowerCase()};request-id:${requestId};ts:${timestamp};`)
    .digest();
  if (!timingSafeEqual(calculada, Buffer.from(assinatura, "hex"))) throw invalida();
  return {
    id: id.toUpperCase(),
    chave: createHmac("sha256", secret)
      .update(`${id.toLowerCase()}:${requestId}:${timestamp}:${assinatura}`)
      .digest("hex"),
  };
}

export class ClienteMercadoPago {
  constructor(
    readonly config: ConfiguracaoMercadoPago,
    private readonly http: typeof fetch = fetch,
  ) {}
  private async solicitar<T = OrderMercadoPago>(
    caminho: string,
    method = "GET",
    body?: unknown,
    chave?: string,
  ): Promise<T> {
    // Mutations are retried only with the same durable idempotency key and identical body.
    for (let tentativa = 0; ; tentativa++) {
      let response: Response;
      try {
        response = await this.http(`https://api.mercadopago.com${caminho}`, {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(this.config.timeoutMs),
          headers: {
            Authorization: `Bearer ${this.config.accessToken}`,
            "Content-Type": "application/json",
            ...(chave ? { "X-Idempotency-Key": chave } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        throw new ErroRegraNegocioHttp(
          "Não foi possível consultar o Mercado Pago. Tente novamente; o mesmo pedido será preservado.",
          503,
        );
      }
      if (response.ok) return (await response.json()) as T;
      const retry = Number(response.headers.get("retry-after") ?? "0");
      if (tentativa === 0 && (response.status === 429 || response.status >= 500) && retry <= 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(retry * 1000, 250 + Math.random() * 250)),
        );
        continue;
      }
      // Never return provider bodies: they can contain payer data or credentials.
      throw new ErroRegraNegocioHttp(
        `Mercado Pago temporariamente indisponível (HTTP ${response.status}).`,
        502,
      );
    }
  }
  montarCheckout(pedido: PedidoPagamento) {
    const retorno = new URL(this.config.retornoUrl);
    retorno.searchParams.set("pedido", pedido.id);
    return {
      type: "online",
      processing_mode: "manual",
      capture_mode: "automatic_async",
      total_amount: decimalMonetario(pedido.valor),
      external_reference: pedido.referencia_externa,
      expiration_time: "P1D",
      description: `ConcursaAI — ${pedido.plano_nome}`,
      items: [
        {
          title: `ConcursaAI ${pedido.plano_nome}`,
          quantity: 1,
          unit_price: decimalMonetario(pedido.valor),
        },
      ],
      config: {
        online: {
          success_url: retorno.href,
          pending_url: retorno.href,
          failure_url: retorno.href,
          auto_return: "all",
          retries: { allowed: false },
        },
        payment_method: {
          max_installments: pedido.duracao_meses === 1 ? 1 : this.config.maxParcelas,
          not_allowed_types: ["ticket"],
        },
      },
    };
  }
  async validarRecebedor() {
    const usuario = await this.solicitar<{ id: string | number; site_id: string; tags: string[] }>(
      "/users/me",
    );
    if (
      String(usuario.id) !== this.config.sellerId ||
      usuario.site_id !== "MLB" ||
      !Array.isArray(usuario.tags) ||
      usuario.tags.includes("test_user") !== (this.config.ambiente === "teste")
    ) {
      throw new ErroRegraNegocioHttp(
        "A conta do Mercado Pago não corresponde ao recebedor e ao ambiente configurados.",
        503,
      );
    }
  }
  async criarCheckout(pedido: PedidoPagamento, payload: unknown = this.montarCheckout(pedido)) {
    // Check the account before creating anything; APP_USR alone is not a test-mode guarantee.
    await this.validarRecebedor();
    return this.solicitar("/v1/orders", "POST", payload, pedido.chave_idempotencia);
  }
  obterOrder(id: string) {
    if (!/^ORD(?:TST)?[A-Z0-9]{20,40}$/i.test(id)) throw new Error("Order inválida.");
    return this.solicitar(`/v1/orders/${encodeURIComponent(id)}`);
  }
  cancelarOrder(id: string, chave: string) {
    return this.solicitar(`/v1/orders/${encodeURIComponent(id)}/cancel`, "POST", undefined, chave);
  }
  estornarOrder(id: string, chave: string) {
    return this.solicitar(`/v1/orders/${encodeURIComponent(id)}/refund`, "POST", undefined, chave);
  }
  validarOrder(order: OrderMercadoPago, pedido: PedidoPagamento) {
    const teste = order.id?.startsWith("ORDTST");
    if (
      (order.id !== pedido.id_order_mp && pedido.id_order_mp !== null) ||
      order.external_reference !== pedido.referencia_externa ||
      order.type !== "online" ||
      order.processing_mode !== "manual" ||
      order.currency !== pedido.moeda ||
      String(order.user_id) !== this.config.sellerId ||
      String(order.integration_data?.application_id) !== this.config.applicationId ||
      centavos(order.total_amount) !== centavos(pedido.valor) ||
      teste !== (this.config.ambiente === "teste") ||
      pedido.ambiente !== this.config.ambiente ||
      (order.live_mode !== undefined && order.live_mode !== !teste) ||
      !Number.isFinite(Date.parse(order.last_updated_date))
    )
      throw new Error("Divergência na identificação, valor, recebedor ou ambiente da order.");
    const status = statusOrder(order.status);
    const reembolsos = (order.transactions?.refunds ?? [])
      .filter((r) => r.status === "processed")
      .reduce((s, r) => s + centavos(r.amount), 0n);
    if (
      status === "aprovado" &&
      centavos(order.total_paid_amount) +
        (order.status_detail === "partially_refunded" ? reembolsos : 0n) <
        centavos(pedido.valor)
    )
      throw new Error("Order sem pagamento integral confirmado.");
    const pagamentos = order.transactions?.payments ?? [];
    if (
      status === "aprovado" &&
      !pagamentos.some(
        (p) =>
          p.status === "processed" &&
          p.status_detail === "accredited" &&
          centavos(p.paid_amount) >= centavos(pedido.valor),
      )
    ) {
      if (order.status_detail !== "partially_refunded")
        throw new Error("Transação sem confirmação de crédito.");
    }
    return status;
  }
}
