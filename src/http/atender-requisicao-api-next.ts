import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { pino } from "pino";
import { ServicoAutenticacaoContasSessoes } from "../application/autenticacao-contas-sessoes.service.js";
import { criarServicosAplicacaoApi } from "../application/composicao-servicos-api.js";
import { carregarConfiguracoesAmbiente } from "../config/configuracoes-ambiente.js";
import routes from "../contracts/rotas-publicas-api.json" with { type: "json" };
import {
  classificarErroAplicacao,
  criarRespostaErro,
  criarRespostaSucesso,
  ErroRegraNegocioHttp,
} from "../domain/erros-validacoes-respostas-api.js";
import { criarDespachoOperacoesApi } from "./despacho-operacoes-rotas-api.js";
import {
  atenderRotaAdicionalNext,
  correspondeRotaAdicional,
} from "./atender-rotas-adicionais-next.js";
import {
  atenderAutenticacaoSupabaseNext,
  correspondeRotaAutenticacaoSupabase,
} from "./autenticacao-supabase-next.js";
import { gerarDocumentoOpenApi } from "./documentacao-openapi.js";
import { ClienteAnaliseQuestoesOpenAI } from "../infrastructure/cliente-analise-questoes-openai.js";
import { ClienteAutenticacaoGoogle } from "../infrastructure/cliente-autenticacao-google.js";
import {
  ConexaoTransacoesPostgreSql,
  type IdentidadeUsuarioAutenticado,
} from "../infrastructure/conexao-transacoes-postgresql.js";
import { ServicoEnvioEmailsTransacionaisResend } from "../infrastructure/envio-emails-transacionais-resend.js";
import { RepositorioContasSessoesPostgreSql } from "../infrastructure/repositorio-contas-sessoes-postgresql.js";
import { criarClienteSupabaseRequisicao } from "../utils/supabase/server.js";
import { RepositorioConsultasNegocioSupabase } from "../infrastructure/repositorio-consultas-supabase.js";
import { ServicoComunicacaoSupabase } from "../infrastructure/comunicacao-supabase.js";
import { criarClienteSupabaseAdministrativo } from "../utils/supabase/admin.js";

const config = carregarConfiguracoesAmbiente(process.env, { supabase: true });
const logger = pino({
  level: config.logLevel,
  redact: ["authorization", "cookie", "password", "senha", "token"],
});
const db = new ConexaoTransacoesPostgreSql(config);
const emails = new ServicoEnvioEmailsTransacionaisResend(db, config, fetch);
const auth = new ServicoAutenticacaoContasSessoes(
  config,
  new RepositorioContasSessoesPostgreSql(db),
  emails,
  new ClienteAutenticacaoGoogle(config, fetch),
);
const openai = new ClienteAnaliseQuestoesOpenAI(config, fetch);
const documentoOpenApi = gerarDocumentoOpenApi();
const limites = new Map<string, { quantidade: number; ate: number }>();

type MetodoHttp = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
type ContextoNext = { params: Promise<{ path: string[] }> };
type CookiePendente = {
  nome: string;
  valor: string;
  opcoes: Record<string, unknown>;
};

function identificarEnderecoCliente(requisicao: Request) {
  if (!config.trustProxy) return "direto";
  return (
    requisicao.headers
      .get("x-forwarded-for")
      ?.split(",")
      .map((item) => item.trim())
      .at(-config.trustProxy) ?? "proxy"
  );
}

function limitarRequisicoes(chave: string, limite: number) {
  const agora = Date.now();
  const registro = limites.get(chave);

  if (!registro || registro.ate <= agora) {
    limites.set(chave, { quantidade: 1, ate: agora + 60_000 });
    return;
  }

  registro.quantidade++;

  if (registro.quantidade > limite) {
    throw new ErroRegraNegocioHttp("Muitas tentativas. Aguarde um minuto e tente novamente.", 429);
  }

  if (limites.size > 10_000) {
    for (const [identificador, valor] of limites) {
      if (valor.ate <= agora) limites.delete(identificador);
    }
  }
}

async function lerCorpoJson(requisicao: Request, limite = 10 * 1024 * 1024): Promise<unknown> {
  const tamanhoDeclarado = Number(requisicao.headers.get("content-length") ?? "0");
  if (tamanhoDeclarado > limite) {
    throw new ErroRegraNegocioHttp("A requisição excede o tamanho permitido.", 413);
  }

  const bytes = await requisicao.arrayBuffer();
  if (bytes.byteLength > limite) {
    throw new ErroRegraNegocioHttp("A requisição excede o tamanho permitido.", 413);
  }
  if (!bytes.byteLength) return undefined;

  if (!requisicao.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ErroRegraNegocioHttp("Envie um objeto JSON válido.", 415);
  }

  try {
    const dados: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (dados === null || typeof dados !== "object") throw new Error("JSON inválido");
    return dados;
  } catch {
    throw new ErroRegraNegocioHttp("Envie um objeto JSON válido.");
  }
}

function consultarParametros(url: URL) {
  const consulta: Record<string, string | string[]> = {};
  for (const [chave, valor] of url.searchParams) {
    const atual = consulta[chave];
    consulta[chave] =
      atual === undefined ? valor : Array.isArray(atual) ? [...atual, valor] : [atual, valor];
  }
  return consulta;
}

function responder(
  conteudo: unknown,
  status: number,
  requisicao: Request,
  identificador: string,
  cookiesPendentes: CookiePendente[],
) {
  const origem = requisicao.headers.get("origin");
  const resposta = NextResponse.json(conteudo, { status });
  resposta.headers.set("Cache-Control", "no-store");
  resposta.headers.set("X-Request-Id", identificador);
  resposta.headers.set("X-Content-Type-Options", "nosniff");
  resposta.headers.set("Vary", "Origin");
  if (origem && config.origins.includes(origem)) {
    resposta.headers.set("Access-Control-Allow-Origin", origem);
    resposta.headers.set("Access-Control-Allow-Credentials", "true");
  }

  for (const cookie of cookiesPendentes) {
    resposta.cookies.set(cookie.nome, cookie.valor, cookie.opcoes);
  }

  return resposta;
}

async function processarWebhook(requisicao: Request) {
  const bytes = Buffer.from(await requisicao.arrayBuffer());
  if (
    bytes.length > 65536 ||
    !emails.validarAssinaturaWebhook(
      requisicao.headers.get("svix-id") ?? "",
      requisicao.headers.get("svix-timestamp") ?? "",
      requisicao.headers.get("svix-signature") ?? "",
      bytes,
    )
  ) {
    throw new ErroRegraNegocioHttp("Assinatura do webhook inválida.", 401);
  }
  let evento: { type?: unknown; data?: { email_id?: unknown } };
  try {
    evento = JSON.parse(bytes.toString());
  } catch {
    throw new ErroRegraNegocioHttp("Evento inválido.");
  }
  if (typeof evento.type !== "string" || typeof evento.data?.email_id !== "string") {
    throw new ErroRegraNegocioHttp("Evento inválido.");
  }
  if (evento.type.trim() && evento.data.email_id.trim()) {
    const { error } = await criarClienteSupabaseAdministrativo().rpc(
      "registrar_evento_resend_backend",
      {
        p_webhook: requisicao.headers.get("svix-id")!,
        p_idmensagem: evento.data.email_id,
        p_evento: evento.type,
      },
    );
    if (error) throw error;
  }
  return criarRespostaSucesso({ recebido: true }, "Evento recebido.");
}

export async function atenderRequisicaoApiNext(requisicao: Request, _contexto: ContextoNext) {
  const identificador = randomUUID();
  const url = new URL(requisicao.url);
  const caminho = url.pathname;
  const metodo = requisicao.method.toUpperCase() as MetodoHttp;
  const cookiesPendentes: CookiePendente[] = [];
  const inicio = Date.now();
  let status = 200;

  try {
    const origem = requisicao.headers.get("origin");
    if (metodo === "OPTIONS") {
      if (origem && !config.origins.includes(origem)) {
        throw new ErroRegraNegocioHttp("Origem da solicitação não autorizada.", 403);
      }
      const resposta = new NextResponse(null, { status: 204 });
      resposta.headers.set("Cache-Control", "no-store");
      resposta.headers.set("X-Request-Id", identificador);
      resposta.headers.set("Vary", "Origin");
      if (origem && config.origins.includes(origem)) {
        resposta.headers.set("Access-Control-Allow-Origin", origem);
        resposta.headers.set("Access-Control-Allow-Credentials", "true");
      }
      resposta.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Concursa-Client",
      );
      resposta.headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      );
      return resposta;
    }

    if (caminho === "/api/health/ready" && metodo === "GET") {
      const { error } = await criarClienteSupabaseAdministrativo()
        .from("usuarios")
        .select("idUsuario", { head: true })
        .limit(1);
      if (error) throw error;
      return responder(
        criarRespostaSucesso(
          { status: "ready", banco: "supabase-data-api" },
          "Conexão com o Supabase verificada.",
        ),
        200,
        requisicao,
        identificador,
        cookiesPendentes,
      );
    }
    if (caminho === "/api/health" && metodo === "GET") {
      return responder(
        criarRespostaSucesso(
          {
            status: "healthy",
            aplicacao: "ConcursaAI",
            runtime: "next",
            bancoConfigurado: !!(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL),
          },
          "API em execução.",
        ),
        200,
        requisicao,
        identificador,
        cookiesPendentes,
      );
    }
    if (caminho === "/api/openapi.json" && metodo === "GET") {
      return responder(documentoOpenApi, 200, requisicao, identificador, cookiesPendentes);
    }

    const mutacao = !["GET", "HEAD"].includes(metodo);
    const tokenBearer = requisicao.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    const possuiCookieSupabase = /(?:^|;\s*)sb-[^=]+-auth-token(?:\.\d+)?=/.test(
      requisicao.headers.get("cookie") ?? "",
    );
    if (
      mutacao &&
      !tokenBearer &&
      (caminho.toLowerCase().startsWith("/api/navegador") || possuiCookieSupabase)
    ) {
      if (
        requisicao.headers.get("X-Concursa-Client") !== "web" ||
        !origem ||
        !config.origins.includes(origem)
      ) {
        throw new ErroRegraNegocioHttp("Origem da solicitação não autorizada.", 403);
      }
    }

    if (caminho === "/api/ResendWebhook/registrar-evento-entrega" && metodo === "POST") {
      return responder(
        await processarWebhook(requisicao),
        200,
        requisicao,
        identificador,
        cookiesPendentes,
      );
    }

    if (correspondeRotaAutenticacaoSupabase(metodo, caminho)) {
      const cabecalhosSessao: Record<string, string> = {};
      const supabase = criarClienteSupabaseRequisicao(
        requisicao as NextRequest,
        (valores, cabecalhos) => {
          cookiesPendentes.push(...valores);
          Object.assign(cabecalhosSessao, cabecalhos);
        },
      );
      if (/^\/api\/(Navegador|Autenticacao)\//.test(caminho) && metodo !== "GET") {
        const enderecoCliente = identificarEnderecoCliente(requisicao);
        limitarRequisicoes("auth:" + enderecoCliente, 10);
      }
      const dados = await atenderAutenticacaoSupabaseNext(
        metodo,
        caminho,
        supabase,
        () => lerCorpoJson(requisicao),
        origem && config.origins.includes(origem) ? origem : config.auth.clientUrl || undefined,
      );
      const resposta = responder(dados, 200, requisicao, identificador, cookiesPendentes);
      Object.entries(cabecalhosSessao).forEach(([nome, valor]) =>
        resposta.headers.set(nome, valor),
      );
      return resposta;
    }

    const rota = routes.find((item) => item.path === caminho && item.method === metodo);
    const rotaAdicional = correspondeRotaAdicional(caminho);
    if (!rota && !rotaAdicional) {
      throw new ErroRegraNegocioHttp("Endpoint não encontrado.", 404);
    }

    const supabase = criarClienteSupabaseRequisicao(requisicao as NextRequest, (valores) => {
      cookiesPendentes.push(...valores);
    });
    let usuario: IdentidadeUsuarioAutenticado = { id: "", sessionId: "", token: "" };
    const autenticado = await supabase.auth.getUser();
    if (!autenticado.error && autenticado.data.user) {
      usuario = { id: autenticado.data.user.id, sessionId: "", token: "supabase-auth" };
    }
    if (!rota?.anonymous && !usuario.id) {
      throw new ErroRegraNegocioHttp("Entre na sua conta para continuar.", 401);
    }
    const repositorioSupabase = new RepositorioConsultasNegocioSupabase(supabase, usuario);

    const enderecoCliente = identificarEnderecoCliente(requisicao);
    if (rota?.controller === "Autenticacao" || rota?.controller === "Navegador") {
      limitarRequisicoes("auth:" + enderecoCliente, 10);
    } else if (rota?.controller === "Cep") {
      limitarRequisicoes("cep:" + enderecoCliente, 30);
    } else if (rotaAdicional) {
      limitarRequisicoes("adicional:" + enderecoCliente, caminho.startsWith("/api/ia/") ? 30 : 90);
    }

    const consulta = consultarParametros(url);
    if (rotaAdicional && !rota) {
      const adicional = await atenderRotaAdicionalNext(
        requisicao,
        caminho,
        usuario,
        db,
        openai,
        () => lerCorpoJson(requisicao),
        repositorioSupabase,
      );
      if (!adicional.encontrada) {
        throw new ErroRegraNegocioHttp("Endpoint não encontrado.", 404);
      }
      return responder(adicional.resposta, 200, requisicao, identificador, cookiesPendentes);
    }

    if (!rota) {
      throw new ErroRegraNegocioHttp("Endpoint não encontrado.", 404);
    }
    const corpo = rota.binding === "query" ? undefined : await lerCorpoJson(requisicao);
    const respostaDados = await (async () => {
      const servicos = criarServicosAplicacaoApi(
        db,
        auth,
        openai,
        usuario,
        requisicao.signal,
        repositorioSupabase,
        new ServicoComunicacaoSupabase(supabase),
      );
      const despacho = criarDespachoOperacoesApi(servicos, rota.binding === "query");
      const manipulador = despacho[rota.path as keyof typeof despacho];
      if (!manipulador) throw new Error("Endpoint sem implementação.");
      const entrada = rota.binding === "query" ? consulta : corpo;
      if (entrada === undefined) {
        throw new ErroRegraNegocioHttp(
          "Confira os campos informados e envie uma requisição válida.",
        );
      }
      return manipulador(entrada);
    })();

    return responder(respostaDados, 200, requisicao, identificador, cookiesPendentes);
  } catch (erro) {
    const classificado = classificarErroAplicacao(erro);
    status = classificado.status;
    logger.warn(
      {
        requestId: identificador,
        status,
        errorType: erro instanceof Error ? erro.name : "Unknown",
      },
      "Requisição recusada",
    );
    const resposta = responder(
      criarRespostaErro(status, classificado.message),
      status,
      requisicao,
      identificador,
      cookiesPendentes,
    );
    if (status === 401) resposta.headers.set("WWW-Authenticate", "Bearer");
    return resposta;
  } finally {
    logger.info(
      {
        requestId: identificador,
        method: metodo,
        path: caminho,
        status,
        durationMs: Date.now() - inicio,
      },
      "HTTP",
    );
  }
}
