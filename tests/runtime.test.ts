import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
async function smoke(mode: "dev" | "production") {
  const port = await new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
  const child = spawn("npm", ["run", mode === "dev" ? "dev" : "start"], {
    env: {
      ...process.env,
      NODE_ENV: mode === "dev" ? "development" : "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      DATABASE_URL: "",
      AUTH_SIGNING_KEY: randomBytes(64).toString("base64"),
      EMAIL_WORKER_ENABLED: "false",
      LOG_LEVEL: "silent",
    },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  let logs = "";
  child.stdout.on("data", (b) => {
    logs += String(b);
  });
  child.stderr.on("data", (b) => {
    logs += String(b);
  });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(logs);
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
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, "Servidor não iniciou: " + logs);
  } finally {
    if (child.pid && child.exitCode === null) {
      if (process.platform === "win32") child.kill("SIGTERM");
      else process.kill(-child.pid, "SIGTERM");
    }
    const result = await Promise.race([
      exited,
      new Promise<never>((_, reject) => {
        const t = setTimeout(
          () => reject(new Error("Shutdown excedeu 10 segundos")),
          10000,
        );
        t.unref();
      }),
    ]);
    assert.ok(
      result[0] === 0 || result[1] === "SIGTERM",
      "Falha no shutdown: " + String(result),
    );
  }
}
test(
  "npm run dev inicia em localhost/porta configurada e encerra",
  { timeout: 20000 },
  () => smoke("dev"),
);
test(
  "npm run start executa build em produção e encerra",
  { timeout: 20000 },
  () => smoke("production"),
);
