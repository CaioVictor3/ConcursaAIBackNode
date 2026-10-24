import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { pino } from "pino";
import { after, NextResponse, type NextRequest } from "next/server";
import { carregarMercadoPago } from "../config/configuracoes-mercado-pago.js";
import {
  consultarMinhaAssinatura,
  ServicoPagamentosAssinaturas,
} from "../application/pagamentos-assinaturas.service.js";
import {
  classificarErroAplicacao,
  criarRespostaErro,
  criarRespostaSucesso,
  ErroRegraNegocioHttp,
} from "../domain/erros-validacoes-respostas-api.js";
import { decimalMonetario } from "../domain/pagamentos-assinaturas.js";
import {
  ClienteMercadoPago,
  validarAssinaturaMercadoPago,
} from "../infrastructure/cliente-mercado-pago.js";
import { RepositorioPagamentosSupabase } from "../infrastructure/repositorio-pagamentos-supabase.js";
import { criarClienteSupabaseAdministrativo } from "../utils/supabase/admin.js";
import {
  criarClienteSupabaseRequisicao,
  type CookieSupabasePendente,
} from "../utils/supabase/server.js";

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const loggerFinanceiro = pino({ name: "financeiro", level: process.env.LOG_LEVEL ?? "info" });
export function identificadorFinanceiro(valor: unknown) {
  if (typeof valor !== "string" || !uuid.test(valor))
    throw new ErroRegraNegocioHttp("Identificador inválido.");
  return valor;
}
function texto(valor: unknown, limite: number, minimo = 1) {
  if (typeof valor !== "string" || valor.trim().length < minimo || valor.length > limite)
    throw new ErroRegraNegocioHttp("Confira os campos informados.");
  return valor.trim();
}
async function corpoJson(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > 16384)
    throw new ErroRegraNegocioHttp("Requisição muito grande.", 413);
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > 16384) throw new ErroRegraNegocioHttp("Requisição muito grande.", 413);
  try {
    const valor: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (!valor || typeof valor !== "object" || Array.isArray(valor)) throw new Error();
    return valor as Record<string, unknown>;
  } catch {
    throw new ErroRegraNegocioHttp("Envie um objeto JSON válido.");
  }
}
export function validarPlanoComercial(dados: Record<string, unknown>) {
  let valor: string;
  try {
    valor = decimalMonetario(dados.valor);
  } catch {
    throw new ErroRegraNegocioHttp(
      "Informe um valor monetário válido com até duas casas decimais.",
    );
  }
  const meses = dados.duracao_meses;
  const ordem = dados.ordem;
  if (
    valor === "0.00" ||
    typeof meses !== "number" ||
    !Number.isInteger(meses) ||
    meses < 1 ||
    meses > 120 ||
    typeof ordem !== "number" ||
    !Number.isInteger(ordem) ||
    ordem < 0 ||
    ordem > 1000 ||
    typeof dados.ativo !== "boolean" ||
    typeof dados.destaque !== "boolean" ||
    !Array.isArray(dados.beneficios) ||
    dados.beneficios.length > 30
  )
    throw new ErroRegraNegocioHttp("Confira o valor e as condições do plano.");
  return {
    id: dados.id == null ? null : identificadorFinanceiro(dados.id),
    codigo: texto(dados.codigo, 60),
    nome: texto(dados.nome, 100),
    descricao: typeof dados.descricao === "string" ? dados.descricao.slice(0, 2000) : "",
    valor,
    duracao_meses: meses,
    ordem,
    ativo: dados.ativo,
    destaque: dados.destaque,
    beneficios: dados.beneficios.map((b) => texto(b, 250)),
  };
}
function servico() {
  return new ServicoPagamentosAssinaturas(
    new RepositorioPagamentosSupabase(criarClienteSupabaseAdministrativo()),
    new ClienteMercadoPago(carregarMercadoPago()),
  );
}
function validarAgendador(req: Request) {
  const secreto = process.env.MP_WORKER_SECRET ?? "";
  const recebido = req.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "";
  if (
    secreto.length < 32 ||
    !timingSafeEqual(
      createHash("sha256").update(secreto).digest(),
      createHash("sha256").update(recebido).digest(),
    )
  )
    throw new ErroRegraNegocioHttp("Agendador não autorizado.", 401);
}

export async function atenderFinanceiro(req: NextRequest) {
  const requestId = randomUUID();
  const caminho = new URL(req.url).pathname.replace(/\/$/, "");
  const url = new URL(req.url);
  const origem = req.headers.get("origin");
  const origens = (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((s) => s.trim());
  const cookies: CookieSupabasePendente[] = [];
  const cabecalhosSessao: Record<string, string> = {};
  function responder(dados: unknown, status = 200) {
    const resposta = NextResponse.json(dados, { status });
    resposta.headers.set("Cache-Control", "no-store");
    resposta.headers.set("X-Request-Id", requestId);
    resposta.headers.set("X-Content-Type-Options", "nosniff");
    resposta.headers.set("Vary", "Origin");
    if (origem && origens.includes(origem)) {
      resposta.headers.set("Access-Control-Allow-Origin", origem);
      resposta.headers.set("Access-Control-Allow-Credentials", "true");
    }
    for (const c of cookies) resposta.cookies.set(c.nome, c.valor, c.opcoes);
    for (const [nome, valor] of Object.entries(cabecalhosSessao)) resposta.headers.set(nome, valor);
    return resposta;
  }
  try {
    if (req.method === "OPTIONS") {
      if (origem && !origens.includes(origem))
        throw new ErroRegraNegocioHttp("Origem não autorizada.", 403);
      const resposta = responder(criarRespostaSucesso({}, "OK"));
      resposta.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Concursa-Client, X-Idempotency-Key",
      );
      resposta.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
      return resposta;
    }
    if (caminho === "/api/financeiro/webhook" && req.method === "POST") {
      const config = carregarMercadoPago();
      const evento = validarAssinaturaMercadoPago(req, config.webhookSecret);
      await corpoJson(req); // bounded envelope; no financial field from the body is trusted.
      const pagamentos = servico();
      await pagamentos.repo.executar("receber_webhook", { chave: evento.chave, order: evento.id });
      after(async () => {
        try {
          await pagamentos.processarFila(2);
        } catch {
          /* persisted event remains recoverable */
        }
      });
      return responder(criarRespostaSucesso({ recebido: true }, "Evento recebido."));
    }
    if (caminho === "/api/financeiro/tarefas" && ["POST", "GET"].includes(req.method)) {
      validarAgendador(req);
      return responder(
        criarRespostaSucesso(
          await servico().executarManutencao(),
          "Manutenção financeira concluída.",
        ),
      );
    }
    if (
      !["GET", "HEAD"].includes(req.method) &&
      !req.headers.get("authorization")?.match(/^Bearer /i)
    ) {
      if (req.headers.get("x-concursa-client") !== "web" || !origem || !origens.includes(origem))
        throw new ErroRegraNegocioHttp("Origem da solicitação não autorizada.", 403);
    }
    const cliente = criarClienteSupabaseRequisicao(req, (valores, headers) => {
      cookies.push(...valores);
      Object.assign(cabecalhosSessao, headers);
    });
    if (caminho === "/api/financeiro/planos" && req.method === "GET") {
      const { data, error } = await cliente
        .from("planos_comerciais")
        .select("*")
        .eq("ativo", true)
        .order("ordem");
      if (error) throw error;
      return responder(
        criarRespostaSucesso(
          data.map((p) => ({ ...p, valor: String(p.valor) })),
          "Planos disponíveis.",
        ),
      );
    }
    const auth = await cliente.auth.getUser();
    if (auth.error || !auth.data.user)
      throw new ErroRegraNegocioHttp("Entre na sua conta para continuar.", 401);
    const pessoa = auth.data.user.id;
    const { data: usuario, error: erroUsuario } = await cliente
      .from("usuarios")
      .select("tipo,estado_cadastro,cadastro_completo")
      .eq("idUsuario", pessoa)
      .single();
    if (erroUsuario || usuario.estado_cadastro !== "ativo")
      throw new ErroRegraNegocioHttp("Conta indisponível.", 403);
    const admin = caminho.startsWith("/api/financeiro/admin/");
    if (admin && usuario.tipo !== "administrador")
      throw new ErroRegraNegocioHttp("Você não possui permissão para esta operação.", 403);
    if (!admin && usuario.tipo !== "estudante")
      throw new ErroRegraNegocioHttp("Esta operação é destinada a estudantes.", 403);
    if (req.method !== "GET") {
      await new RepositorioPagamentosSupabase(criarClienteSupabaseAdministrativo()).executar(
        "limitar_requisicao",
        { chave: `${admin ? "admin" : "estudante"}:${pessoa}`, limite: admin ? 30 : 10 },
      );
    }
    let dados: unknown;
    if (caminho === "/api/financeiro/acesso" && req.method === "GET") {
      const { data, error } = await cliente.rpc("tem_acesso_premium");
      if (error) throw error;
      dados = { premium: data === true };
    } else if (caminho === "/api/financeiro/minha-assinatura" && req.method === "GET") {
      dados = await consultarMinhaAssinatura(cliente);
    } else if (caminho === "/api/financeiro/checkout" && req.method === "POST") {
      const corpo = await corpoJson(req);
      if (Object.keys(corpo).some((k) => k !== "idPlano"))
        throw new ErroRegraNegocioHttp("Envie somente o identificador do plano.");
      dados = await servico().iniciarCheckout(
        pessoa,
        identificadorFinanceiro(corpo.idPlano),
        identificadorFinanceiro(req.headers.get("x-idempotency-key")),
      );
    } else if (caminho === "/api/financeiro/pedido" && req.method === "GET") {
      const { data, error } = await cliente
        .from("pedidos_pagamento")
        .select(
          "id,id_plano,plano_nome,valor,moeda,status,id_order_mp,checkout_url,criado_em,expira_em,duracao_meses,webhook_confirmado",
        )
        .eq("id", identificadorFinanceiro(url.searchParams.get("id")))
        .eq("id_pessoa", pessoa)
        .single();
      if (error || !data) throw new ErroRegraNegocioHttp("Pedido não encontrado.", 404);
      dados = { ...data, valor: String(data.valor) };
    } else if (caminho === "/api/financeiro/sincronizar" && req.method === "POST") {
      const corpo = await corpoJson(req);
      const pagamentos = servico();
      const pedido = await pagamentos.repo.obterPedido(identificadorFinanceiro(corpo.id));
      if (pedido.id_pessoa !== pessoa)
        throw new ErroRegraNegocioHttp("Pedido não encontrado.", 404);
      if (!pedido.id_order_mp) dados = await pagamentos.completarCheckout(pedido);
      else {
        await pagamentos.repo.executar("limitar_sincronizacao", { id: pedido.id });
        dados = await pagamentos.sincronizar(pedido);
      }
    } else if (caminho === "/api/financeiro/cancelamento" && req.method === "POST") {
      const corpo = await corpoJson(req);
      const repo = new RepositorioPagamentosSupabase(criarClienteSupabaseAdministrativo());
      dados = await repo.executar("solicitar_cancelamento", {
        pessoa,
        id: identificadorFinanceiro(corpo.id),
        justificativa: texto(corpo.justificativa, 2000, 10),
      });
    } else if (caminho === "/api/financeiro/admin/painel" && req.method === "GET") {
      const pagina = Number(url.searchParams.get("pagina") ?? "1");
      if (!Number.isInteger(pagina) || pagina < 1 || pagina > 100000)
        throw new ErroRegraNegocioHttp("Página inválida.");
      dados = await new RepositorioPagamentosSupabase(
        criarClienteSupabaseAdministrativo(),
      ).executar("painel", {
        administrador: pessoa,
        pagina,
        pessoa: url.searchParams.get("pessoa")
          ? identificadorFinanceiro(url.searchParams.get("pessoa"))
          : null,
        plano: url.searchParams.get("plano")
          ? identificadorFinanceiro(url.searchParams.get("plano"))
          : null,
        status: url.searchParams.get("status"),
        de: url.searchParams.get("de"),
        ate: url.searchParams.get("ate"),
        vencimento: url.searchParams.get("vencimento"),
      });
    } else if (caminho === "/api/financeiro/admin/planos" && ["POST", "PUT"].includes(req.method)) {
      dados = await new RepositorioPagamentosSupabase(
        criarClienteSupabaseAdministrativo(),
      ).executar("salvar_plano", {
        ...validarPlanoComercial(await corpoJson(req)),
        administrador: pessoa,
      });
    } else if (caminho === "/api/financeiro/admin/reprocessar" && req.method === "POST") {
      dados = await new RepositorioPagamentosSupabase(
        criarClienteSupabaseAdministrativo(),
      ).executar("reprocessar_eventos", { administrador: pessoa });
    } else if (caminho === "/api/financeiro/admin/sincronizar" && req.method === "POST") {
      const corpo = await corpoJson(req);
      const pagamentos = servico();
      const id = identificadorFinanceiro(corpo.id);
      await pagamentos.repo.executar("auditar", { administrador: pessoa, acao: "sincronizar", id });
      dados = await pagamentos.sincronizar(await pagamentos.repo.obterPedido(id));
    } else if (caminho === "/api/financeiro/admin/operacao" && req.method === "POST") {
      const corpo = await corpoJson(req);
      if (corpo.acao !== "cancelar" && corpo.acao !== "estornar")
        throw new ErroRegraNegocioHttp("Operação inválida.");
      dados = await servico().operacaoAdministrativa(
        identificadorFinanceiro(corpo.id),
        pessoa,
        corpo.acao,
        texto(corpo.justificativa, 2000, 10),
      );
    } else throw new ErroRegraNegocioHttp("Endpoint não encontrado.", 404);
    return responder(criarRespostaSucesso(dados, "Operação concluída."));
  } catch (erro) {
    const resultado = classificarErroAplicacao(erro);
    loggerFinanceiro.warn(
      {
        requestId,
        path: caminho,
        status: resultado.status,
        errorType: erro instanceof Error ? erro.name : "DatabaseError",
      },
      "Operação financeira recusada",
    );
    return responder(criarRespostaErro(resultado.status, resultado.message), resultado.status);
  }
}
