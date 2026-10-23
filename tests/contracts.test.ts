import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHmac } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config/config.js";
import { bind, project } from "../src/contracts/codec.js";
import {
  hashPassword,
  verifyPassword,
  encrypt,
  decrypt,
} from "../src/infrastructure/crypto.js";
import { validatePerson } from "../src/domain/person.js";
import {
  validateThemeQuotas,
  validateSubjectQuotas,
} from "../src/application/simulations.js";
import { classifyError } from "../src/domain/errors.js";
import { Emails, namedSql } from "../src/infrastructure/emails.js";
import routes from "../src/contracts/routes.json" with { type: "json" };
const config = loadConfig({
  AUTH_SIGNING_KEY: randomBytes(64).toString("base64"),
  CORS_ORIGINS: "http://localhost:5173",
  AUTH_CLIENT_URL: "http://localhost:5173",
  LOG_LEVEL: "silent",
});
test("96 contratos registrados; proteção de todos os endpoints privados", async () => {
  const runtime = createApp({ config });
  assert.equal(routes.length, 96);
  for (const route of routes.filter((r) => !r.anonymous)) {
    let call = request(runtime.app)[route.method.toLowerCase() as "get"](
      route.path,
    );
    if (route.controller === "Navegador")
      call = call
        .set("Origin", "http://localhost:5173")
        .set("X-Concursa-Client", "web");
    const res = await call.send({});
    assert.equal(res.status, 401, route.path);
    assert.deepEqual(res.body, {
      success: false,
      statusCode: 401,
      message: "Entre na sua conta para continuar.",
      data: null,
    });
  }
  await runtime.db.close();
});
test("health independente, CORS, OpenAPI e erros JSON sem secrets", async () => {
  const { app } = createApp({ config });
  const health = await request(app)
    .get("/api/health")
    .set("Origin", "http://localhost:5173");
  assert.equal(health.status, 200);
  assert.equal(
    health.headers["access-control-allow-origin"],
    "http://localhost:5173",
  );
  assert.equal(health.body.data.bancoConfigurado, false);
  const denied = await request(app)
    .get("/api/health")
    .set("Origin", "https://untrusted.test");
  assert.equal(denied.headers["access-control-allow-origin"], undefined);
  const spec = (await request(app).get("/openapi/v1.json")).body;
  assert.equal(Object.keys(spec.paths).length, 97);
  assert.ok(spec.components.schemas.CriarQuestaoRequestModel);
  assert.equal((await request(app).get("/api/docs/")).status, 200);
  const invalid = await request(app)
    .post("/api/Autenticacao/entrar-estudante")
    .set("Content-Type", "application/json")
    .send("{");
  assert.equal(invalid.status, 400);
  const csrf = await request(app)
    .post("/api/Navegador/entrar-estudante")
    .send({});
  assert.equal(csrf.status, 403);
  const webhook = await request(app)
    .post("/api/ResendWebhook/registrar-evento-entrega")
    .send({});
  assert.equal(webhook.status, 401);
  assert.equal(webhook.body.title, "Unauthorized");
  assert.equal(webhook.body.status, 401);
});
test("binding estrito de body, defaults herdados e números na query", () => {
  assert.throws(() =>
    bind("GerarSimuladoPersonalizadoRequestModel", { quantidade: "2" }),
  );
  assert.equal(bind("ListarBancasRequestModel", {}).quantidadePorPagina, 20);
  assert.equal(
    bind("ListarBancasRequestModel", { pagina: "2" }, true).pagina,
    2,
  );
  assert.equal(
    bind("AtualizarQuestaoRequestModel", {
      idQuestao: "11111111-1111-1111-1111-111111111111",
      enunciado: "Q",
    }).status,
    "rascunho",
  );
  assert.throws(() => bind("IniciarProvaRequestModel", { idProva: "invalid" }));
  assert.throws(() =>
    bind("CadastrarEstudanteRequestModel", {
      email: "x",
      senha: "x",
      pessoa: { dataNascimento: "2026-02-31" },
    }),
  );
  assert.equal(
    project("UsuarioResponseModel", {
      nome_completo: "Nome",
      estado_cadastro: "ativo",
      cadastro_completo: true,
    }).cadastroCompleto,
    true,
  );
  const q = project("QuestaoPublicaResponseModel", {
    idQuestao: "x",
    explicacao: "secreto",
    idAlternativaCorreta: "x",
    idPessoaCriadora: "x",
  });
  assert.equal("explicacao" in q, false);
  assert.equal("idPessoaCriadora" in q, false);
  assert.equal(q.revisaoPendente, true);
});
test("senha ASP.NET Identity v3, rehash bcrypt e cifragem compatível de links", async () => {
  const hash = await hashPassword("SenhaSegura-123");
  assert.equal(Buffer.from(hash, "base64")[0], 1);
  assert.deepEqual(await verifyPassword(hash, "aspnet", "SenhaSegura-123"), {
    valid: true,
    rehash: false,
  });
  assert.equal((await verifyPassword(hash, "aspnet", "errada")).valid, false);
  const bcrypt = await import("bcryptjs");
  const old = await bcrypt.hash("SenhaSegura-123", 4);
  assert.deepEqual(await verifyPassword(old, "bcrypt", "SenhaSegura-123"), {
    valid: true,
    rehash: true,
  });
  assert.equal((await verifyPassword("invalid", "aspnet", "x")).valid, false);
  const key = randomBytes(64),
    cipher = encrypt("https://example.test/#token=123", key);
  assert.equal(decrypt(cipher, key), "https://example.test/#token=123");
  assert.throws(() => decrypt(cipher, randomBytes(64)));
});
test("CPF, endereço, datas e cotas preservam regras de negócio", () => {
  const p = {
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
  assert.equal(validatePerson(p).nome_completo, "Maria Silva");
  assert.equal(validatePerson(p).uf, "MG");
  assert.throws(() => validatePerson({ ...p, cpf: "11111111111" }));
  const q = bind("CriarSimuladoFiltradoRequestModel", {
    quantidade: 3,
    cotasTemas: [
      { idTema: "11111111-1111-1111-1111-111111111111", quantidade: 4 },
    ],
  });
  assert.throws(() => validateThemeQuotas(q));
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
  validateSubjectQuotas(
    { quantidade: 3, cotasAssuntos: [{ idAssunto: "a", quantidade: 0 }] },
    stock,
  );
  assert.throws(() =>
    validateSubjectQuotas(
      { quantidade: 4, cotasAssuntos: [{ idAssunto: "a", quantidade: 0 }] },
      stock,
    ),
  );
});
test("assinatura Svix/Resend usa corpo bruto, prazo e comparação segura", () => {
  const secret = randomBytes(32),
    cfg = loadConfig({
      RESEND_WEBHOOK_SECRET: "whsec_" + secret.toString("base64"),
    });
  const { db } = createApp({ config: cfg });
  const emails = new Emails(db, cfg),
    body = Buffer.from('{"type":"email.delivered"}'),
    id = "evt_1",
    ts = String(Math.floor(Date.now() / 1000));
  const signature =
    "v1," +
    createHmac("sha256", secret)
      .update(id + "." + ts + ".")
      .update(body)
      .digest("base64");
  assert.equal(emails.verifyWebhook(id, ts, signature, body), true);
  assert.equal(
    emails.verifyWebhook(id, ts, signature, Buffer.from("{}")),
    false,
  );
  assert.equal(emails.verifyWebhook(id, "0", signature, body), false);
});
test("SQL parametrizado e classificação de falhas preservados", () => {
  assert.deepEqual(
    namedSql("select @id::uuid where @id=@other", { id: "a", other: "b" }),
    { text: "select $1::uuid where $1=$2", values: ["a", "b"] },
  );
  assert.throws(() => namedSql("select @missing", {}));
  assert.equal(classifyError({ code: "23505" }).status, 409);
  assert.equal(classifyError({ code: "42501" }).status, 403);
  assert.equal(
    classifyError({ code: "P0001", message: "limite de 20 análises" }).status,
    429,
  );
  assert.equal(
    classifyError(new Error("secret")).message.includes("secret"),
    false,
  );
});
test("rate limit de autenticação limita a 10 tentativas por minuto", async () => {
  const { app } = createApp({ config });
  for (let i = 0; i < 10; i++)
    assert.equal(
      (
        await request(app)
          .post("/api/Autenticacao/entrar-estudante")
          .send({ email: "invalid", senha: "x" })
      ).status,
      400,
    );
  const response = await request(app)
    .post("/api/Autenticacao/entrar-estudante")
    .send({ email: "invalid", senha: "x" });
  assert.equal(response.status, 429);
});
