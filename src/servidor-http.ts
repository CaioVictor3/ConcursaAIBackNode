import { criarAplicacaoHttpExpress } from "./aplicacao-http-express.js";
import { iniciarWorkerEnvioEmailsTransacionais } from "./infrastructure/worker-envio-emails-transacionais.js";

const componentesAplicacao = criarAplicacaoHttpExpress();

let stopWorker: () => Promise<void> = async () => {};

const servidorHttp = componentesAplicacao.app.listen(
  componentesAplicacao.config.port,
  componentesAplicacao.config.host,
  () => {
    componentesAplicacao.logger.info(
      { host: componentesAplicacao.config.host, port: componentesAplicacao.config.port },
      "ConcursaAI API em execução",
    );

    if (componentesAplicacao.config.email.worker && componentesAplicacao.db.estaConfigurada) {
      stopWorker = iniciarWorkerEnvioEmailsTransacionais(
        componentesAplicacao.emails,
        componentesAplicacao.logger,
      );
    }
  },
);

servidorHttp.on("error", () => {
  componentesAplicacao.logger.fatal("Não foi possível iniciar o servidor HTTP.");

  process.exitCode = 1;

  void componentesAplicacao.db.encerrarPoolConexoes();
});

let closing = false;

async function shutdown(sinalCancelamento: string) {
  if (closing) {
    return;
  }

  closing = true;

  componentesAplicacao.logger.info({ signal: sinalCancelamento }, "Encerrando API");

  const force = setTimeout(() => {
    servidorHttp.closeAllConnections();

    process.exit(1);
  }, 30000);

  force.unref();

  await Promise.all([
    new Promise<void>((resolve) => {
      servidorHttp.close(() => resolve());

      servidorHttp.closeIdleConnections();
    }),
    stopWorker(),
  ]);

  await componentesAplicacao.db.encerrarPoolConexoes();

  clearTimeout(force);
}

for (const sinalCancelamento of ["SIGTERM", "SIGINT"]) {
  process.on(sinalCancelamento, () => {
    void shutdown(sinalCancelamento);
  });
}
