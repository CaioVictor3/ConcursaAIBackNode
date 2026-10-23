import type { Logger } from "pino";
import { ServicoEnvioEmailsTransacionaisResend } from "./envio-emails-transacionais-resend.js";

export function iniciarWorkerEnvioEmailsTransacionais(
  servicoEmailsTransacionais: ServicoEnvioEmailsTransacionaisResend,
  registradorEventos: Logger,
) {
  const controller = new AbortController();

  let timer: NodeJS.Timeout | undefined;

  let lastMaintenance = 0;

  let inflight: Promise<void> = Promise.resolve();

  const tick = () => {
    inflight = (async () => {
      try {
        const maintenance = Date.now() - lastMaintenance >= 3600000;

        await servicoEmailsTransacionais.executarCicloWorker(
          registradorEventos,
          controller.signal,
          maintenance,
        );

        if (maintenance) {
          lastMaintenance = Date.now();
        }
      } catch {
        registradorEventos.error("Falha no ciclo do worker de emails");
      } finally {
        if (!controller.signal.aborted) {
          timer = setTimeout(tick, servicoEmailsTransacionais.config.email.interval * 1000);
        }
      }
    })();
  };

  tick();

  return async () => {
    controller.abort();

    if (timer) {
      clearTimeout(timer);
    }

    await inflight;
  };
}
