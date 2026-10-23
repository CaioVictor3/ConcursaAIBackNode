import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import request from "supertest";
import { cluster } from "../postgres/cluster-postgresql-descartavel.js";
import { criarAplicacaoHttpExpress } from "../../src/aplicacao-http-express.js";
import { carregarConfiguracoesAmbiente } from "../../src/config/configuracoes-ambiente.js";
import { gerarHashSenhaCompativel } from "../../src/infrastructure/criptografia-senhas-tokens-links.js";
import routes from "../../src/contracts/rotas-publicas-api.json" with { type: "json" };
import { obterCamposContrato } from "../../src/contracts/validacao-conversao-contratos-api.js";
import { criarServicosAplicacaoApi } from "../../src/application/composicao-servicos-api.js";
import { ClienteAnaliseQuestoesOpenAI } from "../../src/infrastructure/cliente-analise-questoes-openai.js";

async function freePort() {
  return new Promise<number>((resolverPortaDisponivel) => {
    const servidorTemporario = createServer();

    servidorTemporario.listen(0, "127.0.0.1", () => {
      const port = (servidorTemporario.address() as { port: number }).port;

      servidorTemporario.close(() => resolverPortaDisponivel(port));
    });
  });
}

function normalize(value: unknown, chaveConfiguracao = ""): unknown {
  if (Array.isArray(value)) {
    return value.map((itemAtual) => normalize(itemAtual));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([nomeCampo, valorCampo]) => [
        nomeCampo,
        normalize(valorCampo, nomeCampo),
      ]),
    );
  }

  if (chaveConfiguracao === "traceId") {
    return "<request-trace>";
  }

  if (chaveConfiguracao === "versaoDotNet") {
    return "<runtime>";
  }

  if (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT/.test(value) &&
    Number.isFinite(Date.parse(value))
  ) {
    return new Date(value).toISOString();
  }

  return value;
}

test(
  "comparação HTTP .NET × Node dos 96 endpoints no mesmo banco isolado",
  { timeout: 180000 },
  async (contextoTeste) => {
    const clusterPostgreSql = await cluster();

    const chaveAssinaturaJwt = randomBytes(64).toString("base64");

    const port = await freePort();

    let dotnet: ChildProcess | undefined;

    let logs = "";

    const config = carregarConfiguracoesAmbiente({
      DATABASE_URL: clusterPostgreSql.url,
      AUTH_SIGNING_KEY: chaveAssinaturaJwt,
      CORS_ORIGINS: "http://localhost:5173",
      AUTH_CLIENT_URL: "http://localhost:5173",
      LOG_LEVEL: "silent",
      EMAIL_WORKER_ENABLED: "false",
    });

    let runtime = criarAplicacaoHttpExpress({ config });

    const accounts = runtime.auth.accounts;

    const admin = randomUUID();

    const student = randomUUID();

    const hash = await gerarHashSenhaCompativel("Parity-test-123");

    const conn = new URL(clusterPostgreSql.url);

    const originalEnv = {
      ...process.env,
      ASPNETCORE_ENVIRONMENT: "Development",
      PORT: String(port),
      ConnectionStrings__ConcursaAI: `Host=127.0.0.1;Port=${clusterPostgreSql.port};Database=postgres;Username=concursa_backend;Password=${decodeURIComponent(conn.password)};SSL Mode=Disable`,
      Autenticacao__ChaveAssinatura: chaveAssinaturaJwt,
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
        [resolve(".tmp/dotnet-reference/ConcursaAI.Api/bin/Debug/net10.0/ConcursaAI.Api.dll")],
        {
          cwd: resolve(".tmp/dotnet-reference/ConcursaAI.Api"),
          env: originalEnv,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      dotnet.stdout?.on("data", (mensagemErro) => {
        logs += String(mensagemErro);
      });

      dotnet.stderr?.on("data", (mensagemErro) => {
        logs += String(mensagemErro);
      });

      for (let indiceTentativa = 0; indiceTentativa < 100; indiceTentativa++) {
        if (dotnet.exitCode !== null) {
          throw new Error("API .NET não iniciou: " + logs.slice(-1500));
        }

        try {
          const result = await fetch(`http://127.0.0.1:${port}/api/Sistema/verificar-sistema`);

          if (result.ok) {
            return;
          }
        } catch {}

        await new Promise((rotaApi) => setTimeout(rotaApi, 100));
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
      await accounts.criarContaUsuario(
        admin,
        admin + "@example.test",
        hash,
        new Date().toISOString(),
        { nome_completo: "Administrador Teste" },
        true,
      );

      await accounts.criarContaUsuario(
        student,
        student + "@example.test",
        hash,
        new Date().toISOString(),
        { nome_completo: "Estudante Teste" },
        true,
      );

      await clusterPostgreSql.admin.query(
        "update public.usuarios set tipo='administrador' where \"idUsuario\"=$1",
        [admin],
      );

      const adminLogin = await runtime.auth
        .criarOperacoesAutenticacaoUsuario({ id: "", sessionId: "", token: "" })
        .entrarAdministrador({
          email: admin + "@example.test",
          senha: "Parity-test-123",
        });

      const studentLogin = await runtime.auth
        .criarOperacoesAutenticacaoUsuario({ id: "", sessionId: "", token: "" })
        .entrarEstudante({
          email: student + "@example.test",
          senha: "Parity-test-123",
        });

      const adminToken = adminLogin.data!.accessToken;

      const studentToken = studentLogin.data!.accessToken;

      const adminUser = await runtime.auth.autenticarTokenAcessoJwt(adminToken);

      const studentUser = await runtime.auth.autenticarTokenAcessoJwt(studentToken);

      const servicosAplicacao = criarServicosAplicacaoApi(
        runtime.db,
        runtime.auth,
        new ClienteAnaliseQuestoesOpenAI(config),
        adminUser,
      );

      const bank = (await servicosAplicacao.criarBanca({ nome: "Banca Paridade", sigla: "BP" }))
        .data!;

      const exam = (
        await servicosAplicacao.criarProva({
          ano: 2026,
          orgao: "Órgão Paridade",
          cargo: "Dentista",
          idOrganizadora: bank.idBanca,
          composicaoConfirmada: false,
        })
      ).data!;

      const theme = (await servicosAplicacao.listarTemas({})).data!.itens[0]!;

      const altA = randomUUID();

      const altB = randomUUID();

      const question = (
        await servicosAplicacao.criarQuestao({
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
        await servicosAplicacao.criarSimulado({
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

      const studentServices = criarServicosAplicacaoApi(
        runtime.db,
        runtime.auth,
        new ClienteAnaliseQuestoesOpenAI(config),
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

      const identificadoresFixture: Record<string, string> = {
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
        if (["Autenticacao", "Navegador"].includes(route.controller) && limited === 9) {
          await stop();

          await start();

          await runtime.db.encerrarPoolConexoes();

          runtime = criarAplicacaoHttpExpress({ config });

          limited = 0;
        }

        if (["Autenticacao", "Navegador"].includes(route.controller)) {
          limited++;
        }

        await contextoTeste.test(route.method + " " + route.path, async () => {
          const needsStudent = ["Estudo", "Tentativa", "AnaliseQuestao"].includes(route.controller);

          const token = needsStudent ? studentToken : adminToken;

          let input: Record<string, unknown> = {};

          if (route.method === "GET") {
            for (const campoContrato of obterCamposContrato(route.request)) {
              if (!campoContrato.nullable && identificadoresFixture[campoContrato.name]) {
                input[campoContrato.name] = identificadoresFixture[campoContrato.name]!;
              }
            }
          }
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
                  Object.entries(input).map(([nomeCampo, valorCampo]) => [
                    nomeCampo,
                    String(valorCampo),
                  ]),
                ).toString()
              : "";

          const original = await fetch(
            `http://127.0.0.1:${port}${route.path}${query ? "?" + query : ""}`,
            {
              method: route.method,
              headers,
              ...(route.binding === "body"
                ? { body: JSON.stringify(input) }
                : route.method === "POST" && route.controller === "ResendWebhook"
                  ? { body: "{}" }
                  : {}),
            },
          );

          const originalText = await original.text();

          const originalBody = originalText ? JSON.parse(originalText) : null;

          const call = request(runtime.app)
            [route.method.toLowerCase() as "get"](route.path)
            .set(headers);

          const node = await (route.binding === "query" ? call.query(input) : call.send(input));

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

          assert.deepEqual(normalize(nodeBody), normalize(originalBody), "Response diferente");

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

      await runtime.db.encerrarPoolConexoes();

      await clusterPostgreSql.stop();
    }
  },
);
