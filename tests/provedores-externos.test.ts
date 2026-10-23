import test from "node:test";
import assert from "node:assert/strict";
import { carregarConfiguracoesAmbiente } from "../src/config/configuracoes-ambiente.js";
import { ClienteAnaliseQuestoesOpenAI } from "../src/infrastructure/cliente-analise-questoes-openai.js";
import { consultarEnderecoViaCep } from "../src/infrastructure/cliente-enderecos-viacep.js";
import { type HttpFetch } from "../src/infrastructure/seguranca-requisicoes-https.js";

const fetchReturning = (body: unknown, status = 200): HttpFetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as HttpFetch;

test("ViaCEP: contrato, sanitização, não encontrado e indisponibilidade", async () => {
  const result = await consultarEnderecoViaCep(
    "38400-100",
    "https://viacep.com.br/ws/",
    fetchReturning({
      logradouro: "Rua",
      bairro: "Centro",
      localidade: "Uberlândia",
      uf: "MG",
    }),
  );

  assert.deepEqual(result, {
    cep: "38400100",
    logradouro: "Rua",
    bairro: "Centro",
    cidade: "Uberlândia",
    uf: "MG",
  });

  await assert.rejects(
    consultarEnderecoViaCep("1234", "https://viacep.com.br/ws/", fetchReturning({})),
  );

  await assert.rejects(
    consultarEnderecoViaCep(
      "12345678",
      "https://viacep.com.br/ws/",
      fetchReturning({ erro: true }),
    ),
    { status: 404 },
  );

  await assert.rejects(
    consultarEnderecoViaCep("12345678", "https://viacep.com.br/ws/", fetchReturning({}, 500)),
    { status: 503 },
  );
});

test("OpenAI Responses envia modelo, prompt, schema estrito e não armazena", async () => {
  const configuracoesAmbiente = carregarConfiguracoesAmbiente({ OPENAI_API_KEY: "test-only" });

  const context = {
    enunciado: "Questão",
    explicacaoOficial: "Explicação",
    alternativas: [
      { idAlternativa: "a", texto: "A" },
      { idAlternativa: "b", texto: "B" },
    ],
  };

  let payload: Record<string, unknown> = {};

  const http: HttpFetch = async (_url, init) => {
    payload = JSON.parse(init!.body as string);

    return new Response(
      JSON.stringify({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: '{"resumo":"Resumo"}' }],
          },
        ],
      }),
    );
  };

  const result = await new ClienteAnaliseQuestoesOpenAI(
    configuracoesAmbiente,
    http,
  ).gerarAnaliseQuestaoOpenAI(context);

  assert.deepEqual(result, { resumo: "Resumo" });

  assert.equal(payload.model, "gpt-4.1-mini");

  assert.equal(payload.store, false);

  assert.equal(payload.max_output_tokens, 4000);

  assert.equal((payload.text as { format: { strict: boolean } }).format.strict, true);

  await assert.rejects(
    new ClienteAnaliseQuestoesOpenAI(
      configuracoesAmbiente,
      fetchReturning({}, 429),
    ).gerarAnaliseQuestaoOpenAI(context),
    {
      status: 503,
    },
  );

  await assert.rejects(
    new ClienteAnaliseQuestoesOpenAI(
      configuracoesAmbiente,
      fetchReturning({ status: "incomplete" }),
    ).gerarAnaliseQuestaoOpenAI(context),
    { status: 502 },
  );

  await assert.rejects(
    new ClienteAnaliseQuestoesOpenAI(configuracoesAmbiente, http).gerarAnaliseQuestaoOpenAI({
      ...context,
      alternativas: [],
    }),
    {
      status: 422,
    },
  );
});

test("Google OAuth valida PKCE, assinatura JWKS, issuer, audience, nonce, azp e email verificado", async () => {
  const { ClienteAutenticacaoGoogle } =
    await import("../src/infrastructure/cliente-autenticacao-google.js");

  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");

  const keys = await generateKeyPair("RS256");

  const chavePublicaJwk = await exportJWK(keys.publicKey);

  Object.assign(chavePublicaJwk, { kid: "test-rsa", alg: "RS256", use: "sig" });

  const configuracoesAmbiente = carregarConfiguracoesAmbiente({
    GOOGLE_CLIENT_ID: "client-test",
    GOOGLE_CLIENT_SECRET: "secret-test",
  });

  let claims: Record<string, unknown> = {
    email: "person@example.test",
    email_verified: true,
    nonce: "expected-nonce",
    azp: "client-test",
    name: "Pessoa Teste",
  };

  let form = "";

  const http: HttpFetch = async (urlSolicitada, init) => {
    if (String(urlSolicitada).endsWith("/token")) {
      form = String(init?.body);

      const token = await new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "test-rsa" })
        .setSubject("subject-test")
        .setIssuer("https://accounts.google.com")
        .setAudience("client-test")
        .setExpirationTime("5m")
        .sign(keys.privateKey);

      return new Response(JSON.stringify({ id_token: token }));
    }

    if (String(urlSolicitada).includes("openid-configuration")) {
      return new Response(
        JSON.stringify({
          jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
        }),
      );
    }

    return new Response(JSON.stringify({ keys: [chavePublicaJwk] }), {
      headers: { "Content-Type": "application/json" },
    });
  };

  const provider = new ClienteAutenticacaoGoogle(configuracoesAmbiente, http);

  const urlAutorizacaoGoogle = new URL(
    provider.gerarUrlAutorizacaoGoogle(
      "state",
      "challenge",
      "expected-nonce",
      "http://localhost/auth",
    ),
  );

  assert.equal(urlAutorizacaoGoogle.searchParams.get("code_challenge_method"), "S256");

  assert.deepEqual(
    await provider.confirmarCodigoAutorizacaoGoogle(
      "code",
      "verifier",
      "expected-nonce",
      "http://localhost/auth",
    ),
    {
      subject: "subject-test",
      email: "person@example.test",
      name: "Pessoa Teste",
    },
  );

  assert.ok(form.includes("code_verifier=verifier"));

  await assert.rejects(
    provider.confirmarCodigoAutorizacaoGoogle(
      "code",
      "verifier",
      "wrong-nonce",
      "http://localhost/auth",
    ),
    { status: 401 },
  );

  claims = { ...claims, email_verified: false };

  await assert.rejects(
    provider.confirmarCodigoAutorizacaoGoogle(
      "code",
      "verifier",
      "expected-nonce",
      "http://localhost/auth",
    ),
    { status: 401 },
  );

  claims = { ...claims, email_verified: true, azp: "another-client" };

  await assert.rejects(
    provider.confirmarCodigoAutorizacaoGoogle(
      "code",
      "verifier",
      "expected-nonce",
      "http://localhost/auth",
    ),
    { status: 401 },
  );
});
