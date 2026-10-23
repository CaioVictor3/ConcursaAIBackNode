import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryResult, QueryResultRow } from "pg";
import type { NomeConsultaEmailTransacional } from "./consultas-sql-emails-transacionais.js";

export class PersistenciaWorkerEmailsSupabase {
  constructor(private readonly cliente: SupabaseClient) {}
  async executar<T extends QueryResultRow = QueryResultRow>(
    nome: NomeConsultaEmailTransacional | "listarFluxos",
    parametros: Record<string, unknown> = {},
  ): Promise<QueryResult<T>> {
    const { data, error } = await this.cliente.rpc("operar_worker_email", {
      p_operacao: nome,
      p_dados: parametros,
    });
    if (error) throw error;
    const retorno = data as { rows: Record<string, unknown>[]; rowCount: number };
    const datas = new Set([
      "validade_link_em",
      "criado_em",
      "atualizado_em",
      "enviado_em",
      "entregue_em",
    ]);
    const rows = retorno.rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k,
          datas.has(k) && typeof v === "string" ? new Date(v) : v,
        ]),
      ),
    ) as T[];
    return { rows, rowCount: retorno.rowCount, command: "RPC", oid: 0, fields: [] };
  }
  async confirmarEnvio(parametros: Record<string, unknown>) {
    const { error } = await this.cliente.rpc("operar_worker_email", {
      p_operacao: "confirmarEnvio",
      p_dados: parametros,
    });
    if (error) throw error;
  }
  async registrarWebhook(webhook: string, id: string, evento: string) {
    const { error } = await this.cliente.rpc("registrar_evento_resend_backend", {
      p_webhook: webhook,
      p_idmensagem: id,
      p_evento: evento,
    });
    if (error) throw error;
  }
}
