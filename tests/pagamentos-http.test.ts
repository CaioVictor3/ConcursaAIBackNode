import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHmac } from "node:crypto";
import { resolve } from "node:path";

// Real Next HTTP server; only the Supabase transport is a local test double.
// No provider or remote Supabase requests, credentials or financial data are used.
test(
  "financeiro HTTP Next: autenticação, administração, CSRF, assinatura e isolamento",
  { timeout: 45000 },
  async (t) => {
    const aluno = "11111111-1111-4111-8111-111111111111",
      outro = "22222222-2222-4222-8222-222222222222",
      admin = "33333333-3333-4333-8333-333333333333";
    const pedido = "44444444-4444-4444-8444-444444444444";
    const order = "ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9";
    const segredo = "webhook-unitario-nao-real-123456";
    const recebidos = new Set<string>();
    const chamadas: { path: string; dados: any }[] = [];
    const simulado = createServer(async (req, res) => {
      const url = new URL(req.url!, "http://localhost");
      let body = "";
      for await (const b of req) body += b;
      const dados = body ? JSON.parse(body) : {};
      chamadas.push({ path: url.pathname, dados });
      const send = (data: unknown, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      };
      if (url.pathname === "/auth/v1/user") {
        const token = req.headers.authorization?.replace("Bearer ", "");
        const id =
          token === "admin-token"
            ? admin
            : token === "outro-token"
              ? outro
              : token === "aluno-token"
                ? aluno
                : null;
        if (!id) {
          send({ message: "Token inválido" }, 401);
          return;
        }
        send({
          id,
          email: "fixture@example.invalid",
          aud: "authenticated",
          role: "authenticated",
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        });
        return;
      }
      if (url.pathname === "/rest/v1/usuarios") {
        send({
          tipo: url.searchParams.get("idUsuario") === "eq." + admin ? "administrador" : "estudante",
          estado_cadastro: "ativo",
          cadastro_completo: true,
        });
        return;
      }
      if (url.pathname === "/rest/v1/planos_comerciais") {
        send([{ id: pedido, nome: "Plano de teste local", valor: 19.9, ativo: true }]);
        return;
      }
      if (url.pathname === "/rest/v1/pedidos_pagamento") {
        if (url.searchParams.get("id_pessoa") === "eq." + outro) {
          send({ code: "PGRST116", message: "Sem linhas" }, 406);
          return;
        }
        send({ id: pedido, id_pessoa: aluno, status: "pendente", valor: 19.9 });
        return;
      }
      if (url.pathname === "/rest/v1/rpc/tem_acesso_premium") {
        send(false);
        return;
      }
      if (url.pathname === "/rest/v1/rpc/operar_financeiro_backend") {
        if (dados.p_operacao === "receber_webhook") recebidos.add(dados.p_dados.chave);
        if (dados.p_operacao === "reservar_eventos") {
          send([]);
          return;
        }
        if (dados.p_operacao === "pedido") {
          send({ id: pedido, id_pessoa: aluno, status: "pendente", valor: "19.90" });
          return;
        }
        if (dados.p_operacao === "painel") {
          send({ ambiente: "teste", planos: [], pagamentos: [] });
          return;
        }
        send(true);
        return;
      }
      send([]);
    });
    simulado.listen(0, "127.0.0.1");
    await once(simulado, "listening");
    const mockPort = (simulado.address() as { port: number }).port;
    const portaLivre = createServer();
    portaLivre.listen(0, "127.0.0.1");
    await once(portaLivre, "listening");
    const port = (portaLivre.address() as { port: number }).port;
    await new Promise<void>((r) => portaLivre.close(() => r()));
    const filho = spawn(
      process.execPath,
      [
        resolve("node_modules/next/dist/bin/next"),
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
          NEXT_TELEMETRY_DISABLED: "1",
          SUPABASE_URL: `http://127.0.0.1:${mockPort}`,
          SUPABASE_PUBLISHABLE_KEY: "publishable-fixture-local",
          SUPABASE_SECRET_KEY: "secret-fixture-local",
          CORS_ORIGINS: "http://localhost:5173",
          MP_AMBIENTE: "teste",
          MP_ACCESS_TOKEN: "APP_USR-fixture-sem-credencial",
          MP_WEBHOOK_SECRET: segredo,
          MP_SELLER_ID: "1234",
          MP_APPLICATION_ID: "5678",
          MP_RETORNO_URL: "https://app.example.test/pagamento/retorno",
          MP_WORKER_SECRET: "segredo-unitario-agendador-1234567890",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let saida = "";
    filho.stdout.on("data", (b) => (saida += b));
    filho.stderr.on("data", (b) => (saida += b));
    const base = `http://127.0.0.1:${port}`;
    const call = async (
      path: string,
      method = "GET",
      token = "",
      body?: unknown,
      headers: Record<string, string> = {},
    ) => {
      const r = await fetch(base + "/api/financeiro/" + path, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: await r.json(), headers: r.headers };
    };
    try {
      let pronto = false;
      const inicio = Date.now();
      while (Date.now() - inicio < 20000) {
        try {
          const r = await fetch(base + "/api/health");
          if (r.ok) {
            pronto = true;
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(pronto, "Servidor Next não iniciou: " + saida.slice(-1200));
      await t.test("catálogo é público e protegido por no-store", async () => {
        const r = await call("planos");
        assert.equal(r.status, 200);
        assert.equal(r.body.data[0].valor, "19.9");
        assert.equal(r.headers.get("cache-control"), "no-store");
      });
      await t.test(
        "endpoints do estudante e administrativos recusam requisições sem sessão",
        async () => {
          for (const path of ["minha-assinatura", "acesso", "admin/painel"])
            assert.equal((await call(path)).status, 401);
        },
      );
      await t.test(
        "estudante não consulta administração; administrador válido consulta",
        async () => {
          assert.equal((await call("admin/painel", "GET", "aluno-token")).status, 403);
          assert.equal((await call("admin/painel", "GET", "admin-token")).status, 200);
        },
      );
      await t.test("mutação por navegador sem proteção CSRF é recusada", async () => {
        assert.equal((await call("checkout", "POST", "", { idPlano: pedido })).status, 403);
      });
      await t.test("checkout rejeita preço enviado pelo cliente e ID inválido", async () => {
        assert.equal(
          (
            await call(
              "checkout",
              "POST",
              "aluno-token",
              { idPlano: pedido, valor: "0.01" },
              { "X-Idempotency-Key": pedido },
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              "checkout",
              "POST",
              "aluno-token",
              { idPlano: "invalido" },
              { "X-Idempotency-Key": pedido },
            )
          ).status,
          400,
        );
        assert.equal(
          chamadas.some((c) => c.dados.p_operacao === "criar_pedido"),
          false,
        );
      });
      await t.test(
        "pedido e sincronização de outro estudante são recusados antes do gateway",
        async () => {
          assert.equal((await call("pedido?id=" + pedido, "GET", "outro-token")).status, 404);
          assert.equal(
            (await call("sincronizar", "POST", "outro-token", { id: pedido })).status,
            404,
          );
        },
      );
      await t.test("webhook sem assinatura e agendador sem segredo são recusados", async () => {
        assert.equal(
          (await call("webhook?data.id=" + order, "POST", "", { type: "order" })).status,
          401,
        );
        assert.equal((await call("tarefas", "POST")).status, 401);
      });
      await t.test(
        "webhook assinado persiste o evento e confirma HTTP 200; replay é deduplicável",
        async () => {
          const ts = String(Date.now()),
            requestId = "request-fixture-local";
          const v1 = createHmac("sha256", segredo)
            .update(`id:${order.toLowerCase()};request-id:${requestId};ts:${ts};`)
            .digest("hex");
          const headers = { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId };
          for (let i = 0; i < 2; i++) {
            const r = await call(
              "webhook?data.id=" + order + "&type=order",
              "POST",
              "",
              { type: "order", data: { id: order } },
              headers,
            );
            assert.equal(r.status, 200);
            assert.equal(r.body.data.recebido, true);
          }
          assert.equal(recebidos.size, 1);
        },
      );
      assert.equal(saida.includes(segredo), false);
      assert.equal(saida.includes("APP_USR-fixture-sem-credencial"), false);
    } finally {
      filho.kill("SIGTERM");
      if (filho.exitCode === null) await once(filho, "exit");
      simulado.closeAllConnections();
      await new Promise<void>((r) => simulado.close(() => r()));
    }
  },
);
