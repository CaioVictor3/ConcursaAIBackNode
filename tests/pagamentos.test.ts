import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  centavos,
  decimalMonetario,
  statusOrder,
  type PedidoPagamento,
} from "../src/domain/pagamentos-assinaturas.js";
import {
  carregarMercadoPago,
  type ConfiguracaoMercadoPago,
} from "../src/config/configuracoes-mercado-pago.js";
import {
  ClienteMercadoPago,
  validarAssinaturaMercadoPago,
  validarUrlCheckout,
  type OrderMercadoPago,
} from "../src/infrastructure/cliente-mercado-pago.js";

export const configTeste: ConfiguracaoMercadoPago = {
  ambiente: "teste",
  accessToken: "APP_USR-unitario-sem-credencial",
  webhookSecret: "segredo-unitario-nao-real-123456",
  sellerId: "1234",
  applicationId: "5678",
  retornoUrl: "https://app.example.test/pagamento/retorno",
  maxParcelas: 12,
  timeoutMs: 1000,
};
export const pedidoTeste: PedidoPagamento = {
  id: "00000000-0000-4000-8000-000000000001",
  id_pessoa: "00000000-0000-4000-8000-000000000002",
  id_plano: "00000000-0000-4000-8000-000000000003",
  plano_nome: "Anual",
  duracao_meses: 12,
  beneficios: [],
  valor: "166.80",
  moeda: "BRL",
  status: "pendente",
  chave_idempotencia: "00000000-0000-4000-8000-000000000004",
  referencia_externa: "externa-teste",
  id_order_mp: "ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9",
  checkout_url: null,
  criado_em: new Date().toISOString(),
  expira_em: new Date().toISOString(),
  ambiente: "teste",
};
export function orderTeste(): OrderMercadoPago {
  return {
    id: pedidoTeste.id_order_mp!,
    type: "online",
    processing_mode: "manual",
    status: "processed",
    status_detail: "accredited",
    external_reference: pedidoTeste.referencia_externa,
    total_amount: "166.80",
    total_paid_amount: "166.80",
    currency: "BRL",
    user_id: "1234",
    integration_data: { application_id: "5678" },
    created_date: new Date().toISOString(),
    last_updated_date: new Date().toISOString(),
    transactions: {
      payments: [
        {
          id: "PAY01KS5AJ6HTK2HRQ3XJ3C2JCKP9",
          status: "processed",
          status_detail: "accredited",
          amount: "166.80",
          paid_amount: "166.80",
          payment_method: { id: "pix", type: "bank_transfer", installments: 1 },
        },
      ],
    },
  };
}

test("dinheiro exato, valores inválidos e estados de Orders sem confundir Payments", () => {
  assert.equal(centavos("19.90"), 1990n);
  assert.equal(decimalMonetario("101.4"), "101.40");
  assert.equal(centavos("9999999999.99"), 999999999999n);
  for (const valor of [19.9, "NaN", "1e2", "-1", "0.001", "166,80"])
    assert.throws(() => centavos(valor));
  assert.equal(statusOrder("processed"), "aprovado");
  assert.equal(statusOrder("canceled"), "cancelado");
  assert.equal(statusOrder("charged_back"), "contestado");
  assert.throws(() => statusOrder("approved"));
});
test("assinatura: manifesto oficial, timestamp, id em minúsculas e alteração de headers", () => {
  const ts = String(Date.now());
  const id = pedidoTeste.id_order_mp!;
  const request = "request-123";
  const assinatura = createHmac("sha256", configTeste.webhookSecret)
    .update(`id:${id.toLowerCase()};request-id:${request};ts:${ts};`)
    .digest("hex");
  const req = new Request(
    `https://api.example.test/api/financeiro/webhook?data.id=${id}&type=order`,
    { headers: { "x-request-id": request, "x-signature": `ts=${ts},v1=${assinatura}` } },
  );
  assert.equal(validarAssinaturaMercadoPago(req, configTeste.webhookSecret).id, id);
  assert.throws(() => validarAssinaturaMercadoPago(req, "outro-segredo"));
  assert.throws(() =>
    validarAssinaturaMercadoPago(req, configTeste.webhookSecret, Date.now() + 400000),
  );
  const alterada = new Request(req.url, {
    headers: { "x-request-id": "alterado", "x-signature": req.headers.get("x-signature")! },
  });
  assert.throws(() => validarAssinaturaMercadoPago(alterada, configTeste.webhookSecret));
  assert.throws(() =>
    validarAssinaturaMercadoPago(
      new Request(req.url + "&data.id=" + id, { headers: req.headers }),
      configTeste.webhookSecret,
    ),
  );
});
test("valida valor, moeda, recebedor, aplicação, ambiente e pagamento realmente creditado", () => {
  const c = new ClienteMercadoPago(configTeste);
  c.validarOrder(orderTeste(), pedidoTeste);
  for (const alteracao of [
    { total_amount: "19.90" },
    { currency: "USD" },
    { user_id: "999" },
    { integration_data: { application_id: "999" } },
    { external_reference: "outro" },
    { live_mode: true },
    { id: "ORD01KS5AJ6HTK2HRQ3XJ3C2JCKP9" },
    { total_paid_amount: "0.00" },
    { transactions: { payments: [] } },
  ])
    assert.throws(() => c.validarOrder({ ...orderTeste(), ...alteracao }, pedidoTeste));
});
test("checkout envia snapshot, Orders manual, parcelas e mesma chave/body na retentativa", async () => {
  const chamadas: { url: string; init: RequestInit }[] = [];
  const c = new ClienteMercadoPago(configTeste, async (url, init) => {
    if (String(url).endsWith("/users/me"))
      return Response.json({ id: "1234", site_id: "MLB", tags: ["test_user"] });
    chamadas.push({ url: String(url), init: init! });
    return chamadas.length === 1
      ? new Response("{}", { status: 503 })
      : Response.json(orderTeste());
  });
  await c.criarCheckout(pedidoTeste);
  assert.equal(chamadas.length, 2);
  assert.equal(chamadas[0]!.url, "https://api.mercadopago.com/v1/orders");
  assert.equal(chamadas[0]!.init.body, chamadas[1]!.init.body);
  const payload = JSON.parse(String(chamadas[0]!.init.body));
  assert.equal(payload.total_amount, "166.80");
  assert.equal(payload.processing_mode, "manual");
  assert.equal(payload.config.payment_method.max_installments, 12);
  assert.equal(payload.config.online.retries.allowed, false);
  assert.equal(
    (chamadas[0]!.init.headers as Record<string, string>)["X-Idempotency-Key"],
    pedidoTeste.chave_idempotencia,
  );
  assert.equal(
    c.montarCheckout({ ...pedidoTeste, duracao_meses: 1 }).config.payment_method.max_installments,
    1,
  );
  assert.ok(!("payer" in payload));
  assert.ok(!("preapproval" in payload));
});
test("timeouts e HTTP 4xx não criam uma nova cobrança nem vazam resposta do provedor", async () => {
  let calls = 0;
  const c = new ClienteMercadoPago(configTeste, async () => {
    calls++;
    return new Response("SEGREDO/PAYER", { status: 400 });
  });
  await assert.rejects(
    () => c.criarCheckout(pedidoTeste),
    (e) => e instanceof Error && !e.message.includes("SEGREDO"),
  );
  assert.equal(calls, 1);
  const timeout = new ClienteMercadoPago(configTeste, async () => {
    throw new Error("access_token=SEGREDO");
  });
  await assert.rejects(
    () => timeout.obterOrder(pedidoTeste.id_order_mp!),
    (e) => e instanceof Error && !e.message.includes("SEGREDO"),
  );
});
test("URLs e configuração falham de forma fechada e produção exige habilitação explícita", () => {
  assert.equal(
    validarUrlCheckout(
      "https://www.mercadopago.com.br/checkout/v1/redirect?order_id=teste",
    ).startsWith("https:"),
    true,
  );
  for (const url of [
    "http://www.mercadopago.com.br/checkout/",
    "https://www.mercadopago.com.br.evil.test/checkout/",
    "https://evil.test/checkout/",
    "javascript:alert(1)",
  ])
    assert.throws(() => validarUrlCheckout(url));
  assert.throws(() => carregarMercadoPago({}));
  assert.throws(() =>
    carregarMercadoPago({ MP_AMBIENTE: "producao", MP_ACCESS_TOKEN: "APP_USR-nao-real" }),
  );
});

test("credenciais Orders de teste usam APP_USR; conta real é recusada antes de criar checkout", async () => {
  const config = carregarMercadoPago({
    MP_ACCESS_TOKEN: "APP_USR-unidade-sem-credencial-real",
    MP_WEBHOOK_SECRET: configTeste.webhookSecret,
    MP_SELLER_ID: "1234",
    MP_APPLICATION_ID: "5678",
    MP_RETORNO_URL: configTeste.retornoUrl,
  });
  assert.equal(config.ambiente, "teste");
  let mutacoes = 0;
  const c = new ClienteMercadoPago(configTeste, async (url, init) => {
    if (init?.method === "POST") mutacoes++;
    return Response.json({ id: "1234", site_id: "MLB", tags: [] });
  });
  await assert.rejects(() => c.criarCheckout(pedidoTeste));
  assert.equal(mutacoes, 0);
});
