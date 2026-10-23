import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import assert from "node:assert/strict";
import inventory from "../docs/source-inventory.json" with { type: "json" };
import routes from "../src/contracts/rotas-publicas-api.json" with { type: "json" };
import { criarServicosAplicacaoApi } from "../src/application/composicao-servicos-api.js";
import { criarAplicacaoHttpExpress } from "../src/aplicacao-http-express.js";
import { carregarConfiguracoesAmbiente } from "../src/config/configuracoes-ambiente.js";

const runtime = criarAplicacaoHttpExpress({
  config: carregarConfiguracoesAmbiente({ LOG_LEVEL: "silent" }),
});

const services = criarServicosAplicacaoApi(
  runtime.db,
  runtime.auth,
  new (
    await import("../src/infrastructure/cliente-analise-questoes-openai.js")
  ).ClienteAnaliseQuestoesOpenAI(runtime.config),
  { id: "", sessionId: "", token: "" },
);

assert.equal(routes.length, inventory.routes.length);

for (const route of routes) {
  if (["Navegador", "ResendWebhook"].includes(route.controller)) {
    continue;
  }

  assert.equal(typeof services[route.action as keyof typeof services], "function", route.path);
}

let verified = 0;

for (const file of inventory.files) {
  const path = join("../ConcursaAI.BackEnd", file.path);

  const actual = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

  assert.equal(actual, file.sha256, "Origem alterada desde inventário: " + file.path);

  verified++;
}

console.log(
  `${routes.length} endpoints com implementação registrada; ${verified} arquivos da origem preservados.`,
);

await runtime.db.encerrarPoolConexoes();
