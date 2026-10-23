import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

async function smoke(mode: "dev" | "production") {
  const port = await new Promise<number>((resolve) => {
    const servidorTemporario = createServer();

    servidorTemporario.listen(0, "127.0.0.1", () => {
      const portaDisponivel = (servidorTemporario.address() as { port: number }).port;

      servidorTemporario.close(() => resolve(portaDisponivel));
    });
  });

  const child = spawn(
    process.execPath,
    [
      resolve("node_modules/next/dist/bin/next"),
      mode === "dev" ? "dev" : "start",
      ...(mode === "dev" ? ["--webpack"] : []),
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: mode === "dev" ? "development" : "production",
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
        DATABASE_URL: "",
        SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_URL: "",
        AUTH_SIGNING_KEY: randomBytes(64).toString("base64"),
        EMAIL_WORKER_ENABLED: "false",
        LOG_LEVEL: "silent",
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const exited = once(child, "exit");

  let logs = "";

  child.stdout.on("data", (fragmentoResposta) => {
    logs += String(fragmentoResposta);
  });

  child.stderr.on("data", (fragmentoResposta) => {
    logs += String(fragmentoResposta);
  });

  try {
    let ready = false;

    for (let indiceTentativa = 0; indiceTentativa < 100; indiceTentativa++) {
      if (child.exitCode !== null) {
        throw new Error(logs);
      }

      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
          signal: AbortSignal.timeout(500),
        });

        if (response.ok) {
          const body = (await response.json()) as {
            data: { bancoConfigurado: boolean };
          };

          assert.equal(body.data.bancoConfigurado, false);

          ready = true;

          break;
        }
      } catch {}

      await new Promise((respostaHttp) => setTimeout(respostaHttp, 100));
    }

    assert.ok(ready, "Servidor não iniciou: " + logs);

    const baseUrl = `http://127.0.0.1:${port}`;
    const redirecionamento = await fetch(baseUrl + "/swagger", { redirect: "manual" });
    assert.equal(redirecionamento.status, 307);
    assert.equal(redirecionamento.headers.get("location"), "/api/docs");

    const pagina = await fetch(baseUrl + "/api/docs");
    assert.equal(pagina.status, 200);
    assert.match(pagina.headers.get("content-type")!, /text\/html/);
    assert.match(await pagina.text(), /ConcursaAI API · Swagger/);

    for (const arquivo of ["swagger-ui.css", "swagger-ui-bundle.js", "swagger-initializer.js"]) {
      const resposta = await fetch(baseUrl + "/api/docs/" + arquivo);
      assert.equal(resposta.status, 200, arquivo);
      assert.ok((await resposta.text()).length > 100, arquivo);
    }

    const arquivoInexistente = await fetch(baseUrl + "/api/docs/package.json");
    assert.equal(arquivoInexistente.status, 404);

    const documento = await (await fetch(baseUrl + "/api/openapi.json")).json();
    assert.equal(documento.openapi, "3.1.0");
    assert.equal(documento.servers[0].url, "/");
    assert.ok(documento.paths["/api/Autenticacao/entrar-estudante"].post.requestBody);
    assert.equal(documento.components.securitySchemes.bearerAuth.scheme, "bearer");
    assert.ok(documento.paths["/api/health/ready"].get);
    const execucao = await fetch(baseUrl + "/api/health", {
      method: Object.keys(documento.paths["/api/health"])[0]!.toUpperCase(),
    });
    assert.equal(execucao.status, 200);
  } finally {
    if (child.pid && child.exitCode === null) {
      if (process.platform === "win32") {
        child.kill("SIGTERM");
      } else {
        process.kill(-child.pid, "SIGTERM");
      }
    }

    const result = await Promise.race([
      exited,
      new Promise<never>((_, reject) => {
        const temporizadorLimiteDesligamento = setTimeout(
          () => reject(new Error("Shutdown excedeu 10 segundos")),
          10000,
        );

        temporizadorLimiteDesligamento.unref();
      }),
    ]);

    assert.ok(result[0] === 0 || result[1] === "SIGTERM", "Falha no shutdown: " + String(result));
  }
}

test("Next dev inicia em localhost/porta configurada e encerra", { timeout: 20000 }, () =>
  smoke("dev"),
);

test("Next start executa build em produção e encerra", { timeout: 20000 }, () =>
  smoke("production"),
);
