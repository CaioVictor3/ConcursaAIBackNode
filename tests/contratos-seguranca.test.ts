import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHmac } from "node:crypto";
import request from "supertest";
import { criarAplicacaoHttpExpress } from "../src/aplicacao-http-express.js";
import { carregarConfiguracoesAmbiente } from "../src/config/configuracoes-ambiente.js";
import {
  vincularRequisicaoAoContrato,
  projetarRespostaPeloContrato,
} from "../src/contracts/validacao-conversao-contratos-api.js";
import {
  gerarHashSenhaCompativel,
  verificarSenhaHashPersistido,
  criptografarConteudoAutenticado,
  descriptografarConteudoAutenticado,
} from "../src/infrastructure/criptografia-senhas-tokens-links.js";
import { validarDadosPessoais } from "../src/domain/validacao-dados-pessoais.js";
import {
  validarCotasTemasSimulado,
  validarCotasAssuntosSimulado,
} from "../src/application/validacao-cotas-simulados.service.js";
import { classificarErroAplicacao } from "../src/domain/erros-validacoes-respostas-api.js";
import {
  ServicoEnvioEmailsTransacionaisResend,
  prepararParametrosSqlNomeados,
} from "../src/infrastructure/envio-emails-transacionais-resend.js";
import routes from "../src/contracts/rotas-publicas-api.json" with { type: "json" };

const config = carregarConfiguracoesAmbiente({
  AUTH_SIGNING_KEY: randomBytes(64).toString("base64"),
  CORS_ORIGINS: "http://localhost:5173",
  AUTH_CLIENT_URL: "http://localhost:5173",
  LOG_LEVEL: "silent",
});

test("96 contratos registrados; proteção de todos os endpoints privados", async () => {
  const runtime = criarAplicacaoHttpExpress({ config });

  assert.equal(routes.length, 96);

  for (const route of routes.filter((rotaApi) => !rotaApi.anonymous)) {
    let call = request(runtime.app)[route.method.toLowerCase() as "get"](route.path);

    if (route.controller === "Navegador") {
      call = call.set("Origin", "http://localhost:5173").set("X-Concursa-Client", "web");
    }

    const respostaHttp = await call.send({});

    assert.equal(respostaHttp.status, 401, route.path);

    assert.deepEqual(respostaHttp.body, {
      success: false,
      statusCode: 401,
      message: "Entre na sua conta para continuar.",
      data: null,
    });
  }

  await runtime.db.encerrarPoolConexoes();
});

test("health independente, CORS, OpenAPI e erros JSON sem secrets", async () => {
  const { app: aplicacaoExpress } = criarAplicacaoHttpExpress({ config });

  const health = await request(aplicacaoExpress)
    .get("/api/health")
    .set("Origin", "http://localhost:5173");

  assert.equal(health.status, 200);

  assert.equal(health.headers["access-control-allow-origin"], "http://localhost:5173");

  assert.equal(health.body.data.bancoConfigurado, false);

  const denied = await request(aplicacaoExpress)
    .get("/api/health")
    .set("Origin", "https://untrusted.test");

  assert.equal(denied.headers["access-control-allow-origin"], undefined);

  const spec = (await request(aplicacaoExpress).get("/openapi/v1.json")).body;

  for (const rotaApi of routes) {
    assert.ok(spec.paths[rotaApi.path], `Rota ausente no OpenAPI: ${rotaApi.path}`);
    assert.ok(
      spec.paths[rotaApi.path][rotaApi.method.toLowerCase()],
      `Método ausente no OpenAPI: ${rotaApi.method} ${rotaApi.path}`,
    );
  }

  assert.ok(spec.components.schemas.CriarQuestaoRequestModel);

  assert.equal((await request(aplicacaoExpress).get("/api/docs/")).status, 200);

  const invalid = await request(aplicacaoExpress)
    .post("/api/Autenticacao/entrar-estudante")
    .set("Content-Type", "application/json")
    .send("{");

  assert.equal(invalid.status, 400);

  const csrf = await request(aplicacaoExpress).post("/api/Navegador/entrar-estudante").send({});

  assert.equal(csrf.status, 403);

  const webhook = await request(aplicacaoExpress)
    .post("/api/ResendWebhook/registrar-evento-entrega")
    .send({});

  assert.equal(webhook.status, 401);

  assert.equal(webhook.body.title, "Unauthorized");

  assert.equal(webhook.body.status, 401);
});

test("binding estrito de body, defaults herdados e números na query", () => {
  assert.throws(() =>
    vincularRequisicaoAoContrato("GerarSimuladoPersonalizadoRequestModel", { quantidade: "2" }),
  );

  assert.equal(
    vincularRequisicaoAoContrato("ListarBancasRequestModel", {}).quantidadePorPagina,
    20,
  );

  assert.equal(
    vincularRequisicaoAoContrato("ListarBancasRequestModel", { pagina: "2" }, true).pagina,
    2,
  );

  assert.equal(
    vincularRequisicaoAoContrato("AtualizarQuestaoRequestModel", {
      idQuestao: "11111111-1111-1111-1111-111111111111",
      enunciado: "Q",
    }).status,
    "rascunho",
  );

  assert.throws(() =>
    vincularRequisicaoAoContrato("IniciarProvaRequestModel", { idProva: "invalid" }),
  );

  assert.throws(() =>
    vincularRequisicaoAoContrato("CadastrarEstudanteRequestModel", {
      email: "x",
      senha: "x",
      pessoa: { dataNascimento: "2026-02-31" },
    }),
  );

  assert.equal(
    projetarRespostaPeloContrato("UsuarioResponseModel", {
      nome_completo: "Nome",
      estado_cadastro: "ativo",
      cadastro_completo: true,
    }).cadastroCompleto,
    true,
  );

  const questaoProjetada = projetarRespostaPeloContrato("QuestaoPublicaResponseModel", {
    idQuestao: "x",
    explicacao: "secreto",
    idAlternativaCorreta: "x",
    idPessoaCriadora: "x",
  });

  assert.equal("explicacao" in questaoProjetada, false);

  assert.equal("idPessoaCriadora" in questaoProjetada, false);

  assert.equal(questaoProjetada.revisaoPendente, true);
});

test("senha ASP.NET Identity v3, rehash bcrypt e cifragem compatível de links", async () => {
  const hash = await gerarHashSenhaCompativel("SenhaSegura-123");

  assert.equal(Buffer.from(hash, "base64")[0], 1);

  assert.deepEqual(await verificarSenhaHashPersistido(hash, "aspnet", "SenhaSegura-123"), {
    valid: true,
    rehash: false,
  });

  assert.equal((await verificarSenhaHashPersistido(hash, "aspnet", "errada")).valid, false);

  const bcrypt = await import("bcryptjs");

  const hashSenhaLegada = await bcrypt.hash("SenhaSegura-123", 4);

  assert.deepEqual(
    await verificarSenhaHashPersistido(hashSenhaLegada, "bcrypt", "SenhaSegura-123"),
    {
      valid: true,
      rehash: true,
    },
  );

  assert.equal((await verificarSenhaHashPersistido("invalid", "aspnet", "x")).valid, false);

  const chaveAssinatura = randomBytes(64);

  const cipher = criptografarConteudoAutenticado(
    "https://example.test/#token=123",
    chaveAssinatura,
  );

  assert.equal(
    descriptografarConteudoAutenticado(cipher, chaveAssinatura),
    "https://example.test/#token=123",
  );

  assert.throws(() => descriptografarConteudoAutenticado(cipher, randomBytes(64)));
});

test("CPF, endereço, datas e cotas preservam regras de negócio", () => {
  const dadosPessoa = {
    nomeCompleto: "  Maria   Silva  ",
    dataNascimento: "1990-01-02",
    cpf: "529.982.247-25",
    cep: "38400-100",
    logradouro: "Rua",
    numero: "1",
    complemento: null,
    bairro: "Centro",
    cidade: "Uberlândia",
    uf: "mg",
  };

  assert.equal(validarDadosPessoais(dadosPessoa).nome_completo, "Maria Silva");

  assert.equal(validarDadosPessoais(dadosPessoa).uf, "MG");

  assert.throws(() => validarDadosPessoais({ ...dadosPessoa, cpf: "11111111111" }));

  const solicitacaoSimulado = vincularRequisicaoAoContrato("CriarSimuladoFiltradoRequestModel", {
    quantidade: 3,
    cotasTemas: [{ idTema: "11111111-1111-1111-1111-111111111111", quantidade: 4 }],
  });

  assert.throws(() => validarCotasTemasSimulado(solicitacaoSimulado));

  const stock = [
    {
      idAssunto: "a",
      assunto: "A",
      idDisciplina: "d",
      disciplina: "D",
      quantidade: 2,
    },
    {
      idAssunto: "b",
      assunto: "B",
      idDisciplina: "d",
      disciplina: "D",
      quantidade: 3,
    },
  ];

  validarCotasAssuntosSimulado(
    { quantidade: 3, cotasAssuntos: [{ idAssunto: "a", quantidade: 0 }] },
    stock,
  );

  assert.throws(() =>
    validarCotasAssuntosSimulado(
      { quantidade: 4, cotasAssuntos: [{ idAssunto: "a", quantidade: 0 }] },
      stock,
    ),
  );
});

test("assinatura Svix/Resend usa corpo bruto, prazo e comparação segura", () => {
  const secret = randomBytes(32);

  const configuracoesAmbiente = carregarConfiguracoesAmbiente({
    RESEND_WEBHOOK_SECRET: "whsec_" + secret.toString("base64"),
  });

  const { db: conexaoPostgreSql } = criarAplicacaoHttpExpress({ config: configuracoesAmbiente });

  const emails = new ServicoEnvioEmailsTransacionaisResend(
    conexaoPostgreSql,
    configuracoesAmbiente,
  );

  const body = Buffer.from('{"type":"email.delivered"}');

  const identificadorEventoWebhook = "evt_1";

  const timestampWebhook = String(Math.floor(Date.now() / 1000));

  const signature =
    "v1," +
    createHmac("sha256", secret)
      .update(identificadorEventoWebhook + "." + timestampWebhook + ".")
      .update(body)
      .digest("base64");

  assert.equal(
    emails.validarAssinaturaWebhook(identificadorEventoWebhook, timestampWebhook, signature, body),
    true,
  );

  assert.equal(
    emails.validarAssinaturaWebhook(
      identificadorEventoWebhook,
      timestampWebhook,
      signature,
      Buffer.from("{}"),
    ),
    false,
  );

  assert.equal(
    emails.validarAssinaturaWebhook(identificadorEventoWebhook, "0", signature, body),
    false,
  );
});

test("SQL parametrizado e classificação de falhas preservados", () => {
  assert.deepEqual(
    prepararParametrosSqlNomeados("select @id::uuid where @id=@other", { id: "a", other: "b" }),
    {
      text: "select $1::uuid where $1=$2",
      values: ["a", "b"],
    },
  );

  assert.throws(() => prepararParametrosSqlNomeados("select @missing", {}));

  assert.equal(classificarErroAplicacao({ code: "23505" }).status, 409);

  assert.equal(classificarErroAplicacao({ code: "42501" }).status, 403);

  assert.equal(
    classificarErroAplicacao({ code: "P0001", message: "limite de 20 análises" }).status,
    429,
  );

  assert.equal(classificarErroAplicacao(new Error("secret")).message.includes("secret"), false);
  assert.equal(
    classificarErroAplicacao(new Error("Connection terminated due to connection timeout")).status,
    503,
  );
});

test("rate limit de autenticação limita a 10 tentativas por minuto", async () => {
  const { app: aplicacaoExpress } = criarAplicacaoHttpExpress({ config });

  for (let indiceTentativa = 0; indiceTentativa < 10; indiceTentativa++) {
    assert.equal(
      (
        await request(aplicacaoExpress)
          .post("/api/Autenticacao/entrar-estudante")
          .send({ email: "invalid", senha: "x" })
      ).status,
      400,
    );
  }

  const response = await request(aplicacaoExpress)
    .post("/api/Autenticacao/entrar-estudante")
    .send({ email: "invalid", senha: "x" });

  assert.equal(response.status, 429);
});
