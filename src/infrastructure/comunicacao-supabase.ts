import type { SupabaseClient } from "@supabase/supabase-js";
import type * as Contratos from "../contracts/modelos-requisicoes-respostas-api.js";

export class ServicoComunicacaoSupabase {
  constructor(private readonly cliente: SupabaseClient) {}
  private async executar<T>(operacao: string, dados: unknown = {}): Promise<T> {
    const { data, error } = await this.cliente.rpc("operar_comunicacao", {
      p_operacao: operacao,
      p_dados: dados,
    });
    if (error) throw error;
    return data as T;
  }
  obterPreferenciaEmail(_id: string) {
    return this.executar<boolean>("obter_preferencia");
  }
  async atualizarPreferenciaEmail(_id: string, receber: boolean) {
    await this.executar("salvar_preferencia", { receber });
  }
  listarHistoricoEmails(dados: Contratos.ListarEmailsTransacionaisRequestModel) {
    return this.executar<{
      itens: Contratos.EmailTransacionalResponseModel[];
      total: number;
      pagina: number;
    }>("historico", dados);
  }
  obterMetricasEmails() {
    return this.executar<Contratos.MetricasEmailsResponseModel>("metricas");
  }
  reprocessarEmailComFalha(id: string) {
    return this.executar<boolean>("reprocessar", { id });
  }
  listarFluxosEmail() {
    return this.executar<Contratos.FluxoEmailResponseModel[]>("fluxos");
  }
  atualizarFluxoEmail(tipo: string, habilitado: boolean) {
    return this.executar<Contratos.FluxoEmailResponseModel>("salvar_fluxo", { tipo, habilitado });
  }
}
