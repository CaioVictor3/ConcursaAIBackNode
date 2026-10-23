import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import request from "supertest";
import { cluster } from "./cluster.js";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config/config.js";
import {
  hashPassword,
  newToken,
  tokenHash,
  decrypt,
  verifyPassword,
} from "../../src/infrastructure/crypto.js";
import { Repository, eq } from "../../src/infrastructure/repository.js";
import { Accounts } from "../../src/infrastructure/accounts.js";
import type { HttpFetch } from "../../src/infrastructure/providers.js";
import type { Logger } from "pino";
import { pino } from "pino";
async function sqlFile(path: string): Promise<string> {
  let text = await readFile(path, "utf8");
  for (const m of [...text.matchAll(/^\\ir (.+)$/gm)]) {
    const included = await sqlFile(join(dirname(path), m[1]!.trim()));
    text = text.replace(m[0], () => included);
  }
  return text;
}
test(
  "PostgreSQL real, RLS, autenticação e fluxos HTTP completos",
  { timeout: 180000 },
  async (t) => {
    const c = await cluster();
    const key = randomBytes(64),
      webhookSecret = randomBytes(32);
    let providerCalls = 0;
    let providerMode = "ok";
    let aiCalls = 0;
    const http: HttpFetch = async (url, init) => {
      if (String(url).includes("openai")) {
        aiCalls++;
        const body = JSON.parse(init!.body as string),
          context = JSON.parse(body.input[0].content);
        const content = {
          resumo: "Resumo didático",
          respostaMarcada: "Alternativa B incorreta",
          respostaCorreta: "Alternativa A correta",
          alternativas: context.alternativas.map(
            (a: { idAlternativa: string }) => ({
              idAlternativa: a.idAlternativa,
              justificativa: "Justificativa didática",
            }),
          ),
          pontosRevisao: ["Revisar tema"],
          ressalvas: null,
        };
        return new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  { type: "output_text", text: JSON.stringify(content) },
                ],
              },
            ],
          }),
        );
      }
      if (String(url).includes("resend")) {
        providerCalls++;
        const body = JSON.parse(init!.body as string);
        assert.ok(body.html.includes("ConcursaAI"));
        assert.ok((init!.headers as Record<string, string>)["Idempotency-Key"]);
        return new Response(
          JSON.stringify(
            providerMode === "ok"
              ? { id: "message-" + providerCalls }
              : { error: "test" },
          ),
          { status: providerMode === "ok" ? 200 : 422 },
        );
      }
      throw new Error(
        "Chamada externa não autorizada no teste: " + String(url),
      );
    };
    const config = loadConfig({
      DATABASE_URL: c.url,
      AUTH_SIGNING_KEY: key.toString("base64"),
      AUTH_CLIENT_URL: "http://localhost:5173",
      CORS_ORIGINS: "http://localhost:5173",
      RESEND_API_KEY: "test-only",
      RESEND_FROM: "sender@example.test",
      RESEND_WEBHOOK_SECRET: "whsec_" + webhookSecret.toString("base64"),
      OPENAI_API_KEY: "test-only",
      EMAIL_WORKER_ENABLED: "false",
      LOG_LEVEL: "silent",
    });
    const runtime = createApp({ config, fetch: http }),
      accounts = runtime.auth.accounts,
      logger = pino({ level: "silent" });
    const adminId = randomUUID(),
      studentId = randomUUID(),
      otherId = randomUUID(),
      password = "SenhaTeste-123",
      hash = await hashPassword(password);
    const person = { nome_completo: "Pessoa de Teste" };
    let adminToken = "",
      studentToken = "",
      otherToken = "",
      studentRefresh = "",
      bankId = "",
      examId = "",
      questionId = "",
      simulationId = "",
      attemptId = "",
      altA = "",
      altB = "";
    const call = async (
      method: string,
      path: string,
      body: Record<string, unknown> = {},
      token = adminToken,
      expected = 200,
    ) => {
      const q = request(runtime.app)
        [method as "get"]("/api/" + path)
        .set("Authorization", "Bearer " + token);
      const res = await (method === "get" || method === "delete"
        ? q.query(body)
        : q.send(body));
      assert.equal(
        res.status,
        expected,
        `${method} ${path}: ${JSON.stringify(res.body)}`,
      );
      return res.body;
    };
    try {
      await t.test(
        "testes SQL originais: provas, cotas, revisão, IA, suporte e identidade",
        async () => {
          for (const filename of (await readdir("database/reference/tests"))
            .filter((x) => x.endsWith(".sql"))
            .sort()) {
            const client = await c.admin.connect();
            try {
              await client.query(
                await sqlFile(join("database/reference/tests", filename)),
              );
            } catch (e) {
              await client.query("ROLLBACK");
              throw new Error(
                "Teste SQL original falhou: " +
                  filename +
                  ": " +
                  (e as Error).message,
                { cause: e },
              );
            } finally {
              client.release();
            }
          }
        },
      );
      await t.test(
        "provisionamento de contas sem privilégios administrativos e login",
        async () => {
          for (const id of [adminId, studentId, otherId])
            await accounts.create(
              id,
              id + "@example.test",
              hash,
              new Date().toISOString(),
              person,
              true,
            );
          assert.equal(
            (await accounts.get("id", adminId))!.perfil.tipo,
            "estudante",
          );
          await c.admin.query(
            'update public.usuarios set tipo=$1 where "idUsuario"=$2',
            ["administrador", adminId],
          );
          const a = await call("post", "Autenticacao/entrar-administrador", {
            email: adminId + "@example.test",
            senha: password,
          });
          adminToken = a.data.accessToken;
          const s = await call("post", "Autenticacao/entrar-estudante", {
            email: studentId + "@example.test",
            senha: password,
          });
          studentToken = s.data.accessToken;
          studentRefresh = s.data.refreshToken;
          const o = await call("post", "Autenticacao/entrar-estudante", {
            email: otherId + "@example.test",
            senha: password,
          });
          otherToken = o.data.accessToken;
          await call("get", "Questao/listar-questoes", {}, studentToken, 403);
        },
      );
      await t.test(
        "RLS, pool concorrente e ausência de acesso a credenciais pelo papel de negócio",
        async () => {
          const repo = (id: string) =>
            new Repository(runtime.db, {
              id,
              sessionId: randomUUID(),
              token: "validado",
            });
          const result = await Promise.all(
            Array.from({ length: 12 }, async (_, i) => {
              const id = i % 2 ? studentId : otherId;
              const p = await repo(id).query("Usuario", "UsuarioResponseModel");
              assert.equal(p.total, 1);
              assert.equal(p.itens[0]!.idUsuario, id);
            }),
          );
          assert.equal(result.length, 12);
          await assert.rejects(
            runtime.db.asUser(
              { id: studentId, sessionId: "", token: "validado" },
              (c) => c.query("select * from identidade.contas"),
            ),
            { code: "42501" },
          );
          assert.equal(
            (
              await runtime.db.query<{ current_user: string }>(
                "select current_user",
              )
            ).rows[0]!.current_user,
            "concursa_backend",
          );
        },
      );
      await t.test(
        "cadastros administrativos, normalização, duplicidades e filtros literais",
        async () => {
          const bank = await call("post", "Banca/criar-banca", {
            nome: "  Banca Teste  ",
            sigla: "BT",
          });
          bankId = bank.data.idBanca;
          assert.equal(bank.data.nome, "Banca Teste");
          await call(
            "post",
            "Banca/criar-banca",
            { nome: "banca teste" },
            adminToken,
            409,
          );
          const percent = await call("get", "Banca/listar-bancas", {
            busca: "%",
          });
          assert.equal(percent.data.total, 0);
          await call("put", "Banca/atualizar-banca", {
            idBanca: bankId,
            nome: "Banca Teste Atualizada",
            sigla: "BTA",
          });
          const discipline = await call("post", "Disciplina/criar-disciplina", {
            nome: "Disciplina Teste",
            ativa: true,
          });
          const d = discipline.data.idDisciplina;
          const subject = await call("post", "Assunto/criar-assunto", {
            nome: "Assunto Teste",
            idDisciplina: d,
          });
          await call(
            "put",
            "Assunto/atualizar-assunto",
            {
              idAssunto: subject.data.idAssunto,
              idAssuntoPai: subject.data.idAssunto,
              idDisciplina: d,
              nome: "Assunto Teste",
            },
            adminToken,
            400,
          );
          await call("delete", "Assunto/excluir-assunto", {
            idAssunto: subject.data.idAssunto,
          });
          await call("patch", "Disciplina/desativar-disciplina", {
            idDisciplina: d,
          });
          await call(
            "post",
            "Concurso/criar-concurso",
            { nome: "Concurso Teste", ano: 2026, status: "ativo" },
            adminToken,
            400,
          );
        },
      );
      await t.test(
        "prova, tema, questão, alternativas, gabarito e explicação",
        async () => {
          const exam = await call("post", "Prova/criar-prova", {
            ano: 2026,
            orgao: "Órgão Teste",
            idOrganizadora: bankId,
            cargo: "Dentista",
            composicaoConfirmada: false,
          });
          examId = exam.data.idProva;
          const themes = await call(
            "get",
            "Prova/listar-temas",
            {},
            studentToken,
          );
          assert.equal(themes.data.itens.length, 25);
          const theme = themes.data.itens[0].idTema;
          altA = randomUUID();
          altB = randomUUID();
          const q = await call("post", "Questao/criar-questao", {
            idProva: examId,
            idTema: theme,
            numero: 1,
            enunciado: "Qual alternativa está correta?",
            explicacao: "A alternativa A está correta.",
            status: "publicada",
            statusGabarito: "definitivo",
            idAlternativaCorreta: altA,
            alternativas: [
              { idAlternativa: altA, letra: "a", texto: "Alternativa A" },
              { idAlternativa: altB, letra: "b", texto: "Alternativa B" },
            ],
          });
          questionId = q.data.idQuestao;
          assert.equal(q.data.gabarito.idAlternativaCorreta, altA);
          assert.equal(q.data.alternativas[0].letra, "A");
          assert.equal(q.data.revisaoPendente, false);
          const listed = await call("get", "Questao/listar-questoes", {
            ano: 2026,
            orgao: "Órgão Teste",
          });
          assert.equal(listed.data.total, 1);
          assert.equal("gabarito" in listed.data.itens[0], false);
          assert.equal("explicacao" in listed.data.itens[0], false);
          await call("put", "Prova/atualizar-prova", {
            idProva: examId,
            ano: 2026,
            orgao: "Órgão Teste",
            idOrganizadora: bankId,
            cargo: "Dentista",
            composicaoConfirmada: true,
          });
        },
      );
      await t.test(
        "simulado público, tentativa, resposta, finalização e correção protegida",
        async () => {
          const sim = await call("post", "Simulado/criar-simulado", {
            nome: "Simulado Teste",
            idsQuestoes: [questionId],
            publico: true,
            status: "publicado",
            tipo: "padrao",
          });
          simulationId = sim.data.idSimulado;
          const start = await call(
            "post",
            "Tentativa/iniciar-tentativa-simulado",
            { idSimulado: simulationId },
            studentToken,
          );
          attemptId = start.data.idTentativa;
          await call(
            "get",
            "Tentativa/obter-tentativa-simulado",
            { idTentativa: attemptId },
            otherToken,
            404,
          );
          const questions = await call(
            "get",
            "Tentativa/obter-questoes-tentativa",
            { idTentativa: attemptId },
            studentToken,
          );
          assert.equal(questions.data.itens.length, 1);
          assert.equal("explicacao" in questions.data.itens[0], false);
          await call(
            "get",
            "Tentativa/obter-resultado-tentativa",
            { idTentativa: attemptId },
            studentToken,
            409,
          );
          await call(
            "put",
            "Tentativa/responder-questao-simulado",
            {
              idTentativa: attemptId,
              idQuestao: questionId,
              idAlternativaSelecionada: altB,
            },
            studentToken,
          );
          const result = await call(
            "post",
            "Tentativa/finalizar-tentativa-simulado",
            { idTentativa: attemptId },
            studentToken,
          );
          assert.equal(result.data.tentativa.totalErros, 1);
          assert.equal(result.data.itens[0].idAlternativaCorreta, altA);
          assert.ok(result.data.itens[0].explicacao);
          await call(
            "put",
            "Tentativa/responder-questao-simulado",
            {
              idTentativa: attemptId,
              idQuestao: questionId,
              idAlternativaSelecionada: altA,
            },
            studentToken,
            409,
          );
          const history = await call(
            "get",
            "Tentativa/listar-minhas-tentativas",
            {},
            studentToken,
          );
          assert.equal(history.data.total, 1);
          assert.equal(history.data.itens[0].nomeSimulado, "Simulado Teste");
        },
      );
      await t.test(
        "IA: autorização, reserva real, conteúdo, persistência e cache sem nova cobrança",
        async () => {
          await call(
            "get",
            "AnaliseQuestao/consultar-analise-questao",
            { idTentativa: attemptId, idQuestao: questionId },
            otherToken,
            404,
          );
          const first = await call(
            "post",
            "AnaliseQuestao/solicitar-analise-questao",
            { idTentativa: attemptId, idQuestao: questionId },
            studentToken,
          );
          assert.equal(first.data.conteudo.alternativas.length, 2);
          assert.equal(aiCalls, 1);
          const second = await call(
            "post",
            "AnaliseQuestao/solicitar-analise-questao",
            { idTentativa: attemptId, idQuestao: questionId },
            studentToken,
          );
          assert.deepEqual(second.data.conteudo, first.data.conteudo);
          assert.equal(aiCalls, 1);
        },
      );
      await t.test(
        "revisão, recomendação, estatísticas, meta e prova integral",
        async () => {
          for (const route of [
            "obter-resumo-revisao",
            "listar-questoes-revisao",
            "obter-estatisticas-assuntos",
            "obter-meta-semanal",
          ])
            await call("get", "Estudo/" + route, {}, studentToken);
          const goal = await call(
            "put",
            "Estudo/salvar-meta-semanal",
            { quantidadeSemanal: 80 },
            studentToken,
          );
          assert.equal(goal.data.meta, 80);
          await call(
            "put",
            "Estudo/salvar-meta-semanal",
            { quantidadeSemanal: 2001 },
            studentToken,
            400,
          );
          await call(
            "post",
            "Prova/iniciar-prova",
            { idProva: examId },
            studentToken,
          );
          await call(
            "post",
            "Simulado/criar-simulado-filtrado",
            { nome: "Filtrado Teste", quantidade: 1, cotasTemas: [] },
            studentToken,
          );
        },
      );
      await t.test(
        "suporte: propriedade, resposta administrativa e encerramento",
        async () => {
          const open = await call(
            "post",
            "Suporte/abrir-chamado",
            {
              assunto: "Dúvida de teste",
              categoria: "simulados",
              mensagem: "Descrição completa de teste.",
            },
            studentToken,
          );
          const id = open.data.idChamado;
          await call(
            "get",
            "Suporte/obter-chamado",
            { idChamado: id },
            otherToken,
            404,
          );
          await call("post", "Suporte/responder-chamado", {
            idChamado: id,
            mensagem: "Resposta administrativa.",
          });
          const done = await call("post", "Suporte/finalizar-chamado", {
            idChamado: id,
            resolucao: "Atendimento resolvido no teste.",
          });
          assert.equal(done.data.status, "finalizado");
          await call(
            "post",
            "Suporte/responder-chamado",
            { idChamado: id, mensagem: "Não permitido" },
            studentToken,
            409,
          );
        },
      );
      await t.test(
        "preferências, workflows e histórico de emails",
        async () => {
          await call(
            "put",
            "PreferenciaComunicacao/atualizar-minha-preferencia",
            { receberInatividade: true },
            studentToken,
          );
          assert.equal(
            (
              await call(
                "get",
                "PreferenciaComunicacao/obter-minha-preferencia",
                {},
                studentToken,
              )
            ).data.receberInatividade,
            true,
          );
          const workflows = await call(
            "get",
            "EmailsTransacionais/listar-fluxos",
          );
          assert.equal(workflows.data.fluxos.length, 4);
          await call("put", "EmailsTransacionais/atualizar-fluxo", {
            tipoEvento: "USER_INACTIVE",
            habilitado: false,
          });
          await call("get", "EmailsTransacionais/listar-historico");
          await call("get", "EmailsTransacionais/obter-metricas");
          await call(
            "get",
            "EmailsTransacionais/listar-historico",
            {},
            studentToken,
            403,
          );
        },
      );
      await t.test(
        "tokens de email, fila atômica, templates, worker e webhook idempotente",
        async () => {
          const id = randomUUID();
          await accounts.create(
            id,
            id + "@example.test",
            hash,
            null,
            person,
            true,
          );
          const account = (await accounts.get("id", id))!;
          const raw = newToken(),
            link =
              config.auth.clientUrl +
              "/autenticacao/confirmar-email#tipo=confirmacao&token=" +
              raw;
          const pending = runtime.emails.prepare(
            id,
            id + "@example.test",
            "Nome <script>",
            "confirmacao",
            link,
          );
          assert.equal(
            await accounts.emailToken(
              id,
              "confirmacao",
              tokenHash(raw),
              new Date(Date.now() + 60000),
              pending,
            ),
            true,
          );
          assert.equal(
            await accounts.emailToken(
              id,
              "confirmacao",
              tokenHash(newToken()),
              new Date(Date.now() + 60000),
            ),
            false,
          );
          const reserved = await runtime.emails.reserve();
          assert.ok(reserved.length >= 1);
          const item = reserved.find(
            (e) => e.idEmailTransacional === pending.id,
          )!;
          assert.ok(item);
          assert.equal(await runtime.emails.canSend(item), true);
          assert.ok(
            runtime.emails.render(item).html.includes("&lt;script&gt;"),
          );
          await runtime.emails.process(
            item,
            logger,
            new AbortController().signal,
          );
          assert.equal(providerCalls, 1);
          const body = JSON.stringify({
              type: "email.delivered",
              data: { email_id: "message-1" },
            }),
            timestamp = String(Math.floor(Date.now() / 1000)),
            webhook = "webhook-1",
            signature =
              "v1," +
              createHmac("sha256", webhookSecret)
                .update(webhook + "." + timestamp + "." + body)
                .digest("base64");
          for (let i = 0; i < 2; i++) {
            const res = await request(runtime.app)
              .post("/api/ResendWebhook/registrar-evento-entrega")
              .set("svix-id", webhook)
              .set("svix-timestamp", timestamp)
              .set("svix-signature", signature)
              .set("Content-Type", "application/json")
              .send(body);
            assert.equal(res.status, 200);
          }
          assert.equal(
            (
              await c.admin.query(
                'select status from comunicacao.emails_transacionais where "idEmailTransacional"=$1',
                [pending.id],
              )
            ).rows[0].status,
            "entregue",
          );
          assert.equal(
            await accounts.consumeEmail(
              tokenHash(raw),
              "confirmacao",
              null,
              true,
            ),
            true,
          );
          assert.equal(
            await accounts.consumeEmail(tokenHash(raw), "confirmacao", null),
            false,
          );
          await runtime.emails.cycle(
            logger,
            new AbortController().signal,
            true,
          );
          assert.ok(providerCalls >= 2);
          const reset = newToken();
          assert.equal(
            await accounts.emailToken(
              id,
              "recuperacao",
              tokenHash(reset),
              new Date(Date.now() + 60000),
            ),
            true,
          );
          assert.equal(
            await accounts.consumeEmail(
              tokenHash(reset),
              "recuperacao",
              await hashPassword("NovaSenha-456"),
            ),
            true,
          );
          assert.equal(
            (
              await verifyPassword(
                (await accounts.get("id", id))!.senha_hash,
                "aspnet",
                "NovaSenha-456",
              )
            ).valid,
            true,
          );
        },
      );
      await t.test(
        "cookies HttpOnly, renovação e proteção CSRF no navegador",
        async () => {
          const agent = request.agent(runtime.app),
            headers = {
              Origin: "http://localhost:5173",
              "X-Concursa-Client": "web",
            };
          const login = await agent
            .post("/api/Navegador/entrar-estudante")
            .set(headers)
            .send({ email: otherId + "@example.test", senha: password });
          assert.equal(login.status, 200);
          assert.equal("accessToken" in login.body.data, false);
          assert.ok(String(login.headers["set-cookie"]).includes("HttpOnly"));
          assert.equal(
            (await agent.get("/api/Usuario/obter-meu-usuario")).status,
            200,
          );
          assert.equal(
            (
              await agent
                .put("/api/PreferenciaComunicacao/atualizar-minha-preferencia")
                .send({ receberInatividade: false })
            ).status,
            403,
          );
          assert.equal(
            (
              await agent
                .post("/api/Navegador/renovar-sessao")
                .set(headers)
                .send({})
            ).status,
            200,
          );
          assert.equal(
            (
              await agent
                .post("/api/Navegador/sair-sessao")
                .set(headers)
                .send({})
            ).status,
            200,
          );
          assert.equal(
            (await agent.get("/api/Usuario/obter-meu-usuario")).status,
            401,
          );
        },
      );
      await t.test(
        "falha permanente Resend e reprocessamento seguro sem duplicação",
        async () => {
          const id = randomUUID();
          await c.admin.query(
            `insert into comunicacao.emails_transacionais("idEmailTransacional",tipo_evento,"idUsuario",email_destinatario,assunto,dados_template,maximo_tentativas,chave_idempotencia,agendado_em) values($1,'WELCOME_EMAIL',$2,'failure@example.test','Teste','{}',5,$3,now())`,
            [id, otherId, "WELCOME_EMAIL/" + id],
          );
          const item = (await runtime.emails.reserve()).find(
            (e) => e.idEmailTransacional === id,
          )!;
          assert.ok(item);
          providerMode = "fail";
          await runtime.emails.process(
            item,
            logger,
            new AbortController().signal,
          );
          providerMode = "ok";
          const failed = (
            await c.admin.query(
              'select status,mensagem_erro from comunicacao.emails_transacionais where "idEmailTransacional"=$1',
              [id],
            )
          ).rows[0];
          assert.equal(failed.status, "falha");
          assert.equal(failed.mensagem_erro, "resend_http_422");
          assert.equal(await runtime.emails.reprocess(id), true);
          assert.equal(await runtime.emails.reprocess(id), false);
          await runtime.emails.cycle(
            logger,
            new AbortController().signal,
            false,
          );
          assert.equal(
            (
              await c.admin.query(
                'select status from comunicacao.emails_transacionais where "idEmailTransacional"=$1',
                [id],
              )
            ).rows[0].status,
            "aceito",
          );
        },
      );
      await t.test(
        "cadastro, confirmação, login e recuperação por HTTP com persistência real",
        async () => {
          const app = createApp({
            config,
            database: runtime.db,
            fetch: http,
          }).app;
          const email = "cadastro-" + randomUUID() + "@example.test";
          const data = {
            email,
            senha: "SenhaCadastro-123",
            pessoa: {
              nomeCompleto: "Pessoa Cadastro",
              dataNascimento: "1995-01-02",
              cpf: "52998224725",
              cep: "01001000",
              logradouro: "Rua",
              numero: "1",
              complemento: null,
              bairro: "Centro",
              cidade: "São Paulo",
              uf: "SP",
            },
          };
          const registered = await request(app)
            .post("/api/Autenticacao/cadastrar-estudante")
            .send(data);
          assert.equal(registered.status, 200);
          const id = registered.body.data.idUsuario;
          assert.equal(registered.body.data.confirmacaoEmailNecessaria, true);
          const pending = (
            await c.admin.query(
              `select link_protegido from comunicacao.emails_transacionais where "idUsuario"=$1 and tipo_evento='EMAIL_VERIFICATION'`,
              [id],
            )
          ).rows[0];
          const confirmation = new URLSearchParams(
            new URL(decrypt(pending.link_protegido, key)).hash.slice(1),
          ).get("token");
          assert.equal(
            (
              await request(app)
                .post("/api/Autenticacao/confirmar-email")
                .send({ token: confirmation })
            ).status,
            200,
          );
          const login = await request(app)
            .post("/api/Autenticacao/entrar-estudante")
            .send({ email, senha: data.senha });
          assert.equal(login.status, 200);
          assert.equal(
            (
              await request(app)
                .post("/api/Autenticacao/solicitar-recuperacao-senha")
                .send({ email })
            ).status,
            200,
          );
          const recovery = (
            await c.admin.query(
              `select link_protegido from comunicacao.emails_transacionais where "idUsuario"=$1 and tipo_evento='PASSWORD_RESET'`,
              [id],
            )
          ).rows[0];
          const reset = new URLSearchParams(
            new URL(decrypt(recovery.link_protegido, key)).hash.slice(1),
          ).get("token");
          assert.equal(
            (
              await request(app)
                .post("/api/Autenticacao/redefinir-senha")
                .send({ token: reset, senha: "SenhaAlterada-456" })
            ).status,
            200,
          );
          assert.equal(
            (
              await request(app)
                .get("/api/Usuario/obter-meu-usuario")
                .set("Authorization", "Bearer " + login.body.data.accessToken)
            ).status,
            401,
          );
          assert.equal(
            (
              await request(app)
                .post("/api/Autenticacao/entrar-estudante")
                .send({ email, senha: "SenhaAlterada-456" })
            ).status,
            200,
          );
        },
      );
      await t.test(
        "identidade Google vinculada por sujeito não pode mudar de proprietário",
        async () => {
          const subject = "google-test-" + randomUUID();
          await accounts.linkGoogle(otherId, subject, "google@example.test");
          assert.equal(
            (await accounts.get("google", subject))!.idUsuario,
            otherId,
          );
          assert.equal(await accounts.googleLinked(otherId), true);
          await assert.rejects(
            accounts.linkGoogle(studentId, subject, "google@example.test"),
          );
        },
      );
      await t.test(
        "inatividade opt-in, seleção idempotente e cancelamento por preferência",
        async () => {
          await runtime.emails.workflow("USER_INACTIVE", true);
          await runtime.emails.setPreference(otherId, true);
          await c.admin.query(
            `update public.usuarios set ultimo_acesso_em=now()-interval '31 days' where "idUsuario"=$1`,
            [otherId],
          );
          const params = { dias: [7, 15, 30], maximo: 5, limite: 100 };
          await runtime.emails.sql(
            "EnfileirarInativosAsync",
            "comando",
            params,
          );
          await runtime.emails.sql(
            "EnfileirarInativosAsync",
            "comando",
            params,
          );
          const rows = (
            await c.admin.query(
              `select "idEmailTransacional" from comunicacao.emails_transacionais where "idUsuario"=$1 and tipo_evento='USER_INACTIVE'`,
              [otherId],
            )
          ).rows;
          assert.equal(rows.length, 1);
          await runtime.emails.setPreference(otherId, false);
          assert.equal(
            (
              await c.admin.query(
                'select status from comunicacao.emails_transacionais where "idEmailTransacional"=$1',
                [rows[0].idEmailTransacional],
              )
            ).rows[0].status,
            "cancelado",
          );
          await runtime.emails.workflow("USER_INACTIVE", false);
        },
      );
      await t.test(
        "refresh rotaciona, reutilização revoga família e JWT deixa de autenticar",
        async () => {
          const refreshed = await call("post", "Autenticacao/renovar-sessao", {
            refreshToken: studentRefresh,
          });
          assert.ok(refreshed.data.accessToken);
          await call(
            "post",
            "Autenticacao/renovar-sessao",
            { refreshToken: studentRefresh },
            adminToken,
            401,
          );
          await call(
            "get",
            "Usuario/obter-meu-usuario",
            {},
            refreshed.data.accessToken,
            401,
          );
        },
      );
      await t.test(
        "schema e privilégios reais disponíveis sem migrations no runtime",
        async () => {
          assert.equal(
            (
              await c.admin.query(
                "select rolbypassrls from pg_roles where rolname='concursa_backend'",
              )
            ).rows[0].rolbypassrls,
            false,
          );
          assert.equal(
            (
              await c.admin.query(
                "select has_table_privilege('anon','public.questoes','select') as allowed",
              )
            ).rows[0].allowed,
            false,
          );
        },
      );
    } finally {
      await runtime.db.close();
      await c.stop();
    }
  },
);
