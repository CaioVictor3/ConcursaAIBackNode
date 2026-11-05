export type StatusPagamento =
  "pendente" | "processando" | "aprovado" | "rejeitado" | "cancelado" | "estornado" | "contestado";

export interface PlanoComercial {
  id: string;
  codigo: string;
  nome: string;
  descricao: string;
  valor: string;
  moeda: "BRL";
  duracao_meses: number;
  beneficios: string[];
  ordem: number;
  ativo: boolean;
  destaque: boolean;
}
export interface PedidoPagamento {
  id: string;
  id_pessoa: string;
  id_plano: string;
  plano_nome: string;
  duracao_meses: number;
  beneficios: string[];
  valor: string;
  moeda: "BRL";
  status: StatusPagamento;
  chave_idempotencia: string;
  referencia_externa: string;
  id_order_mp: string | null;
  checkout_url: string | null;
  criado_em: string;
  expira_em: string;
  ambiente: "teste" | "producao";
}

// Money crosses the provider boundary as a decimal string. No floating-point arithmetic.
export function centavos(valor: unknown): bigint {
  if (typeof valor !== "string" || !/^\d{1,10}(\.\d{1,2})?$/.test(valor))
    throw new Error("Valor monetário inválido.");
  const [inteiros, fracao = ""] = valor.split(".");
  return BigInt(inteiros!) * 100n + BigInt(fracao.padEnd(2, "0"));
}
export function decimalMonetario(valor: unknown): string {
  const numero = centavos(valor);
  return `${numero / 100n}.${(numero % 100n).toString().padStart(2, "0")}`;
}
export function statusOrder(status: string): StatusPagamento {
  switch (status) {
    case "created":
      return "pendente";
    case "processing":
    case "action_required":
      return "processando";
    case "processed":
      return "aprovado";
    case "failed":
      return "rejeitado";
    case "canceled":
      return "cancelado";
    case "refunded":
      return "estornado";
    case "charged_back":
      return "contestado";
    default:
      throw new Error("Status de order não reconhecido; conciliação necessária.");
  }
}
