import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { pino } from "pino";
import { carregarConfiguracoesAmbiente } from "../src/config/configuracoes-ambiente.js";
import { ConexaoTransacoesPostgreSql } from "../src/infrastructure/conexao-transacoes-postgresql.js";
import { ServicoEnvioEmailsTransacionaisResend } from "../src/infrastructure/envio-emails-transacionais-resend.js";
import { PersistenciaWorkerEmailsSupabase } from "../src/infrastructure/persistencia-worker-emails-supabase.js";

test("worker usa somente RPCs, preserva datas e confirma o envio atomicamente", async () => {
  const chamadas: string[] = [];
  const email = {
    idEmailTransacional: "email-teste",
    tipo_evento: "WELCOME_EMAIL",
    idUsuario: null,
    email_destinatario: "aluno@example.invalid",
    assunto: "Boas-vindas",
    dados_template: '{"nome":"Aluno Teste"}',
    link_protegido: null,
    validade_link_em: "2099-01-01T00:00:00Z",
    quantidade_tentativas: 1,
    maximo_tentativas: 5,
    chave_idempotencia: "email-teste",
    identificador_processamento: "reserva-teste",
  };
  const cliente = createClient("https://projeto.supabase.co", "chave-secreta-teste", {
    auth: { persistSession: false },
    global: {
      fetch: async (_entrada, opcoes) => {
        const corpo = JSON.parse(String(opcoes?.body)) as { p_operacao: string };
        chamadas.push(corpo.p_operacao);
        const rows =
          corpo.p_operacao === "listarFluxos"
            ? [
                {
                  tipo_evento: "WELCOME_EMAIL",
                  habilitado: true,
                  atualizado_em: "2026-10-23T00:00:00Z",
                },
              ]
            : corpo.p_operacao === "reservarLoteEmailsPendentes"
              ? [email]
              : corpo.p_operacao === "consultarReservaEmail"
                ? [{ exists: true }]
                : [];
        return new Response(JSON.stringify({ rows, rowCount: rows.length }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  });
  const config = carregarConfiguracoesAmbiente(
    {
      RESEND_API_KEY: "re_teste",
      RESEND_FROM: "noreply@example.invalid",
      LOG_LEVEL: "silent",
      AUTH_CLIENT_URL: "https://concursa.example.invalid",
    },
    { supabase: true },
  );
  assert.equal(config.databaseUrl, "");
  let enviados = 0;
  const servico = new ServicoEnvioEmailsTransacionaisResend(
    new ConexaoTransacoesPostgreSql(config),
    config,
    async () => {
      enviados++;
      return new Response(JSON.stringify({ id: "resend-teste" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    new PersistenciaWorkerEmailsSupabase(cliente),
  );
  await servico.executarCicloWorker(pino({ level: "silent" }), new AbortController().signal, false);
  assert.equal(enviados, 1);
  assert.ok(chamadas.includes("confirmarEnvio"));
  assert.equal(chamadas.includes("marcarFalhaProcessamentoEmail"), false);
});
