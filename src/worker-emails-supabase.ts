import { config as carregarArquivoAmbiente } from "dotenv";
import { pino } from "pino";
import { carregarConfiguracoesAmbiente } from "./config/configuracoes-ambiente.js";
import { ConexaoTransacoesPostgreSql } from "./infrastructure/conexao-transacoes-postgresql.js";
import { ServicoEnvioEmailsTransacionaisResend } from "./infrastructure/envio-emails-transacionais-resend.js";
import { PersistenciaWorkerEmailsSupabase } from "./infrastructure/persistencia-worker-emails-supabase.js";
import { iniciarWorkerEnvioEmailsTransacionais } from "./infrastructure/worker-envio-emails-transacionais.js";
import { criarClienteSupabaseAdministrativo } from "./utils/supabase/admin.js";

carregarArquivoAmbiente({ path: ".env.local" });
const ambiente = carregarConfiguracoesAmbiente(process.env, { supabase: true });
const logger = pino({ level: ambiente.logLevel });
const persistencia = new PersistenciaWorkerEmailsSupabase(criarClienteSupabaseAdministrativo());

if (process.argv.includes("--verificar")) {
  await persistencia.executar("listarFluxos");
  logger.info("Conexão do worker com o Supabase verificada, sem enviar e-mails.");
} else if (!ambiente.email.worker) {
  logger.info("Worker de e-mails desabilitado na configuração.");
} else {
  if (!ambiente.email.key || !ambiente.email.from)
    throw new Error("Configure RESEND_API_KEY e RESEND_FROM para iniciar o worker.");
  if (!ambiente.auth.clientUrl || !ambiente.origins.includes(ambiente.auth.clientUrl))
    throw new Error("Configure AUTH_CLIENT_URL com uma origem autorizada em CORS_ORIGINS.");
  const servico = new ServicoEnvioEmailsTransacionaisResend(
    new ConexaoTransacoesPostgreSql(ambiente),
    ambiente,
    fetch,
    persistencia,
  );
  const parar = iniciarWorkerEnvioEmailsTransacionais(servico, logger);
  let encerrando = false;
  for (const sinal of ["SIGINT", "SIGTERM"] as const)
    process.on(sinal, () => {
      if (encerrando) return;
      encerrando = true;
      void parar().then(() => logger.info("Worker de e-mails encerrado."));
    });
  logger.info("Worker Resend em execução usando a Data API do Supabase.");
}
