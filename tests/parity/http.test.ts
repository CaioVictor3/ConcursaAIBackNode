import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import request from "supertest";
import { cluster } from "../postgres/cluster.js";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config/config.js";
import { hashPassword } from "../../src/infrastructure/crypto.js";
import routes from "../../src/contracts/routes.json" with { type: "json" };
import { fields } from "../../src/contracts/codec.js";
import { createServices } from "../../src/application/services.js";
import { OpenAIProvider } from "../../src/infrastructure/providers.js";
async function freePort() {
  return new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}
function normalize(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((x) => normalize(x));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalize(v, k)]),
    );
  if (key === "traceId") return "<request-trace>";
  if (key === "versaoDotNet") return "<runtime>";
  if (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
    return new Date(value).toISOString();
  return value;
}
test(
  "comparação HTTP .NET × Node dos 96 endpoints no mesmo banco isolado",
  { timeout: 180000 },
  async (t) => {
    const c = await cluster(),
      key = randomBytes(64).toString("base64"),
      port = await freePort();
    let dotnet: ChildProcess | undefined;
    let logs = "";
    const config = loadConfig({
      DATABASE_URL: c.url,
      AUTH_SIGNING_KEY: key,
      CORS_ORIGINS: "http://localhost:5173",
      AUTH_CLIENT_URL: "http://localhost:5173",
      LOG_LEVEL: "silent",
      EMAIL_WORKER_ENABLED: "false",
    });
    let runtime = createApp({ config });
    const accounts = runtime.auth.accounts;
    const admin = randomUUID(),
      student = randomUUID(),
      hash = await hashPassword("Parity-test-123");
    const conn = new URL(c.url);
    const originalEnv = {
      ...process.env,
      ASPNETCORE_ENVIRONMENT: "Development",
      PORT: String(port),
      ConnectionStrings__ConcursaAI: `Host=127.0.0.1;Port=${c.port};Database=postgres;Username=concursa_backend;Password=${decodeURIComponent(conn.password)};SSL Mode=Disable`,
      Autenticacao__ChaveAssinatura: key,
      Autenticacao__FrontendUrl: "http://localhost:5173",
      EmailsTransacionais__Worker__Habilitado: "false",
    };
    const stop = async () => {
      if (dotnet && dotnet.exitCode === null) {
        dotnet.kill("SIGTERM");
        await once(dotnet, "exit");
      }
      dotnet = undefined;
    };
    const start = async () => {
      dotnet = spawn(
        "dotnet",
        [
          resolve(
            ".tmp/dotnet-reference/ConcursaAI.Api/bin/Debug/net10.0/ConcursaAI.Api.dll",
          ),
        ],
        {
          cwd: resolve(".tmp/dotnet-reference/ConcursaAI.Api"),
          env: originalEnv,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      dotnet.stdout?.on("data", (d) => {
        logs += String(d);
      });
      dotnet.stderr?.on("data", (d) => {
        logs += String(d);
      });
      for (let i = 0; i < 100; i++) {
        if (dotnet.exitCode !== null)
          throw new Error("API .NET não iniciou: " + logs.slice(-1500));
        try {
          const result = await fetch(
            `http://127.0.0.1:${port}/api/Sistema/verificar-sistema`,
          );
          if (result.ok) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("Timeout ao iniciar API .NET");
    };
    const evidence: {
      path: string;
      method: string;
      status: number;
      match: boolean;
      difference?: string;
    }[] = [];
    try {
      await accounts.create(
        admin,
        admin + "@example.test",
        hash,
        new Date().toISOString(),
        { nome_completo: "Administrador Teste" },
        true,
      );
      await accounts.create(
        student,
        student + "@example.test",
        hash,
        new Date().toISOString(),
        { nome_completo: "Estudante Teste" },
        true,
      );
      await c.admin.query(
        "update public.usuarios set tipo='administrador' where \"idUsuario\"=$1",
        [admin],
      );
      const adminLogin = await runtime.auth
          .handlers({ id: "", sessionId: "", token: "" })
          .entrarAdministrador({
            email: admin + "@example.test",
            senha: "Parity-test-123",
          }),
        studentLogin = await runtime.auth
          .handlers({ id: "", sessionId: "", token: "" })
          .entrarEstudante({
            email: student + "@example.test",
            senha: "Parity-test-123",
          });
      const adminToken = adminLogin.data!.accessToken,
        studentToken = studentLogin.data!.accessToken;
      const adminUser = await runtime.auth.authenticate(adminToken),
        studentUser = await runtime.auth.authenticate(studentToken),
        s = createServices(
          runtime.db,
          runtime.auth,
          new OpenAIProvider(config),
          adminUser,
        );
      const bank = (await s.criarBanca({ nome: "Banca Paridade", sigla: "BP" }))
        .data!;
      const exam = (
        await s.criarProva({
          ano: 2026,
          orgao: "Órgão Paridade",
          cargo: "Dentista",
          idOrganizadora: bank.idBanca,
          composicaoConfirmada: false,
        })
      ).data!;
      const theme = (await s.listarTemas({})).data!.itens[0]!;
      const altA = randomUUID(),
        altB = randomUUID();
      const question = (
        await s.criarQuestao({
          idProva: exam.idProva,
          idTema: theme.idTema,
          numero: 1,
          enunciado: "Questão Paridade",
          dificuldade: "nao_informada",
          fonte: "",
          imagemUrl: null,
          status: "publicada",
          explicacao: "Explicação Paridade",
          statusGabarito: "definitivo",
          idAlternativaCorreta: altA,
          alternativas: [
            { idAlternativa: altA, letra: "A", texto: "A", ordem: 1 },
            { idAlternativa: altB, letra: "B", texto: "B", ordem: 2 },
          ],
        })
      ).data!;
      const simulation = (
        await s.criarSimulado({
          nome: "Simulado Paridade",
          descricao: "",
          idConcurso: null,
          duracaoMinutos: null,
          tipo: "padrao",
          publico: true,
          status: "publicado",
          idsQuestoes: [question.idQuestao],
        })
      ).data!;
      const studentServices = createServices(
        runtime.db,
        runtime.auth,
        new OpenAIProvider(config),
        studentUser,
      );
      const attempt = (
        await studentServices.iniciarTentativaSimulado({
          idSimulado: simulation.idSimulado,
        })
      ).data!;
      const support = (
        await studentServices.abrirChamado({
          assunto: "Paridade de suporte",
          categoria: "simulados",
          mensagem: "Descrição do chamado de teste.",
        })
      ).data!;
      const ids: Record<string, string> = {
        idUsuario: student,
        idQuestao: question.idQuestao,
        idTentativa: attempt.idTentativa,
        idSimulado: simulation.idSimulado,
        idProva: exam.idProva,
        idConcurso: exam.idProva,
        idBanca: bank.idBanca,
        idTema: theme.idTema,
        idChamado: support.idChamado,
        idDisciplina: randomUUID(),
        idAssunto: randomUUID(),
      };
      let limited = 0;
      await start();
      for (const route of routes) {
        if (
          ["Autenticacao", "Navegador"].includes(route.controller) &&
          limited === 9
        ) {
          await stop();
          await start();
          await runtime.db.close();
          runtime = createApp({ config });
          limited = 0;
        }
        if (["Autenticacao", "Navegador"].includes(route.controller)) limited++;
        await t.test(route.method + " " + route.path, async () => {
          const needsStudent = [
              "Estudo",
              "Tentativa",
              "AnaliseQuestao",
            ].includes(route.controller),
            token = needsStudent ? studentToken : adminToken;
          let input: Record<string, unknown> = {};
          if (route.method === "GET")
            for (const f of fields(route.request))
              if (!f.nullable && ids[f.name]) input[f.name] = ids[f.name]!;
          // Logout must not invalidate the shared read fixtures; both APIs receive an invalid token.
          const access = route.action === "sairSessao" ? "invalid" : token;
          const headers = {
            Authorization: "Bearer " + access,
            Origin: "http://localhost:5173",
            "X-Concursa-Client": "web",
            "Content-Type": "application/json",
          };
          const query =
            route.binding === "query"
              ? new URLSearchParams(
                  Object.entries(input).map(([k, v]) => [k, String(v)]),
                ).toString()
              : "";
          const original = await fetch(
            `http://127.0.0.1:${port}${route.path}${query ? "?" + query : ""}`,
            {
              method: route.method,
              headers,
              ...(route.binding === "body"
                ? { body: JSON.stringify(input) }
                : route.method === "POST" &&
                    route.controller === "ResendWebhook"
                  ? { body: "{}" }
                  : {}),
            },
          );
          const originalText = await original.text();
          const originalBody = originalText ? JSON.parse(originalText) : null;
          const call = request(runtime.app)
            [route.method.toLowerCase() as "get"](route.path)
            .set(headers);
          const node = await (route.binding === "query"
            ? call.query(input)
            : call.send(input));
          const nodeBody = node.text ? node.body : null;
          if (
            route.path === "/api/EmailsTransacionais/listar-historico" &&
            original.status === 503
          ) {
            assert.equal(node.status, 200);
            evidence.push({
              path: route.path,
              method: route.method,
              status: node.status,
              match: false,
              difference:
                "Correção justificada: a origem concatena mensagem_erro e from sem espaço e retorna 503; o Node executa SQL válido e retorna o histórico.",
            });
            return;
          }
          assert.equal(node.status, original.status, "Status diferente");
          assert.deepEqual(
            normalize(nodeBody),
            normalize(originalBody),
            "Response diferente",
          );
          evidence.push({
            path: route.path,
            method: route.method,
            status: node.status,
            match: true,
          });
        });
      }
      await writeFile(
        "docs/http-parity-results.json",
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            scope:
              "96 endpoints; GET com fixtures e mutações com entradas vazias, sem chamadas a provedores externos; datas normalizadas para UTC e versão do runtime desconsiderada.",
            comparisons: evidence,
          },
          null,
          2,
        ),
      );
    } finally {
      await stop();
      await runtime.db.close();
      await c.stop();
    }
  },
);
