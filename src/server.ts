import { createApp } from "./app.js";
import { startEmailWorker } from "./infrastructure/emails.js";

const runtime = createApp();
let stopWorker: () => Promise<void> = async () => {};
const server = runtime.app.listen(
  runtime.config.port,
  runtime.config.host,
  () => {
    runtime.logger.info(
      { host: runtime.config.host, port: runtime.config.port },
      "ConcursaAI API em execução",
    );
    if (runtime.config.email.worker && runtime.db.configured)
      stopWorker = startEmailWorker(runtime.emails, runtime.logger);
  },
);
server.on("error", () => {
  runtime.logger.fatal("Não foi possível iniciar o servidor HTTP.");
  process.exitCode = 1;
  void runtime.db.close();
});
let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  runtime.logger.info({ signal }, "Encerrando API");
  const force = setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 30000);
  force.unref();
  await Promise.all([
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    }),
    stopWorker(),
  ]);
  await runtime.db.close();
  clearTimeout(force);
}
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    void shutdown(signal);
  });
