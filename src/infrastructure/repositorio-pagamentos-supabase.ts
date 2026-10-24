import type { SupabaseClient } from "@supabase/supabase-js";
import type { PedidoPagamento } from "../domain/pagamentos-assinaturas.js";

export class RepositorioPagamentosSupabase {
  constructor(private readonly cliente: SupabaseClient) {}
  async executar<T>(operacao: string, dados: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.cliente.rpc("operar_financeiro_backend", {
      p_operacao: operacao,
      p_dados: dados,
    });
    if (error) throw error;
    return data as T;
  }
  obterPedido(id: string) {
    return this.executar<PedidoPagamento>("pedido", { id });
  }
}
