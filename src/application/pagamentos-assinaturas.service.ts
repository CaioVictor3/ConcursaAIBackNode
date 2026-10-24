import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { ErroRegraNegocioHttp } from "../domain/erros-validacoes-respostas-api.js";
import { centavos, type PedidoPagamento } from "../domain/pagamentos-assinaturas.js";
import { ClienteMercadoPago, validarUrlCheckout } from "../infrastructure/cliente-mercado-pago.js";
import { RepositorioPagamentosSupabase } from "../infrastructure/repositorio-pagamentos-supabase.js";

export class ServicoPagamentosAssinaturas {
  constructor(
    readonly repo: RepositorioPagamentosSupabase,
    readonly mercadoPago: ClienteMercadoPago,
  ) {}
  async iniciarCheckout(pessoa: string, plano: string, chave: string) {
    const pedido = await this.repo.executar<PedidoPagamento>("criar_pedido", {
      pessoa,
      plano,
      chave,
      ambiente: this.mercadoPago.config.ambiente,
    });
    if (pedido.status !== "pendente" && pedido.status !== "processando") return pedido;
    return this.completarCheckout(pedido);
  }
  async completarCheckout(pedido: PedidoPagamento) {
    if (pedido.checkout_url) return pedido;
    const reserva = await this.repo.executar<{ reserva: string; payload: unknown } | null>(
      "reservar_checkout",
      { id: pedido.id, payload: this.mercadoPago.montarCheckout(pedido) },
    );
    if (!reserva)
      throw new ErroRegraNegocioHttp(
        "O checkout deste pedido está sendo preparado. Aguarde alguns segundos e consulte Minha Assinatura.",
        409,
      );
    try {
      const order = await this.mercadoPago.criarCheckout(pedido, reserva.payload);
      this.mercadoPago.validarOrder(order, pedido);
      const url = validarUrlCheckout(order.checkout_url);
      return await this.repo.executar<PedidoPagamento>("salvar_checkout", {
        id: pedido.id,
        order: order.id,
        url,
        reserva: reserva.reserva,
      });
    } finally {
      await this.repo.executar("liberar_checkout", { id: pedido.id, reserva: reserva.reserva });
    }
  }
  async sincronizar(pedido: PedidoPagamento, webhook = false) {
    if (!pedido.id_order_mp) return pedido;
    const order = await this.mercadoPago.obterOrder(pedido.id_order_mp);
    let status = this.mercadoPago.validarOrder(order, pedido);
    if ((order.transactions?.chargebacks?.length ?? 0) > 0) status = "contestado";
    const pagamento =
      order.transactions?.payments?.find(
        (p) => p.status === "processed" || p.status === "charged_back" || p.status === "refunded",
      ) ?? order.transactions?.payments?.at(-1);
    const somaEstornos = (order.transactions?.refunds ?? [])
      .filter((r) => r.status === "processed")
      .reduce((s, r) => s + centavos(r.amount), 0n);
    const estornado =
      status === "estornado"
        ? centavos(pedido.valor)
        : somaEstornos > centavos(pedido.valor)
          ? centavos(pedido.valor)
          : somaEstornos;
    const resultado = await this.repo.executar<PedidoPagamento>("aplicar_order", {
      id: pedido.id,
      order: order.id,
      status,
      versao: order.last_updated_date,
      valor: order.total_amount,
      moeda: order.currency,
      detalhe: order.status_detail,
      pagamento: pagamento?.id ?? null,
      referencia_pagamento: pagamento?.reference?.id ?? null,
      metodo: pagamento?.payment_method?.id ?? null,
      parcelas: pagamento?.payment_method?.installments ?? null,
      estornado: `${estornado / 100n}.${String(estornado % 100n).padStart(2, "0")}`,
      webhook,
    });
    return resultado;
  }
  async processarFila(limite = 5) {
    const eventos = await this.repo.executar<{ chave: string; recurso: string; reserva: string }[]>(
      "reservar_eventos",
      { limite },
    );
    let processados = 0;
    for (const evento of eventos) {
      let erro: string | null = null;
      try {
        const pedido = await this.repo.executar<PedidoPagamento | null>("pedido_order", {
          order: evento.recurso,
        });
        if (!pedido) throw new Error("Order ainda não vinculada.");
        await this.sincronizar(pedido, true);
        processados++;
      } catch {
        // Stable code, never payloads, bearer tokens, signatures or payer details.
        erro = "falha_consulta_ou_validacao_order";
      }
      await this.repo.executar("concluir_evento", {
        chave: evento.chave,
        reserva: evento.reserva,
        erro,
      });
    }
    return { recebidos: eventos.length, processados, falhas: eventos.length - processados };
  }
  async executarManutencao() {
    const inicio = Date.now();
    await this.repo.executar("manutencao");
    const fila = await this.processarFila(3);
    const pedidos = await this.repo.executar<PedidoPagamento[]>("conciliar", { limite: 3 });
    let conciliados = 0;
    let consultados = 0;
    for (const pedido of pedidos) {
      // Leave time for the current operation and response on bounded serverless invocations.
      if (Date.now() - inicio > 60_000) break;
      consultados++;
      try {
        if (pedido.id_order_mp) await this.sincronizar(pedido);
        else await this.completarCheckout(pedido);
        conciliados++;
      } catch {
        /* Durable inbox and the next scheduled reconciliation recover failures. */
      } finally {
        await this.repo.executar("marcar_consulta", { id: pedido.id });
      }
    }
    return { ...fila, conciliados, consultados };
  }
  async operacaoAdministrativa(
    id: string,
    administrador: string,
    acao: "cancelar" | "estornar",
    justificativa: string,
  ) {
    if (
      process.env.MP_OPERACOES_FINANCEIRAS_HABILITADAS !== "true" ||
      (this.mercadoPago.config.ambiente === "producao" &&
        process.env.MP_OPERACOES_PRODUCAO_AUTORIZADAS !== "true")
    )
      throw new ErroRegraNegocioHttp(
        "Operações financeiras precisam ser habilitadas pelo responsável pela conta.",
        403,
      );
    // Deterministic UUID per order + operation, persisted in the audit before contacting the provider.
    const pedido = await this.repo.obterPedido(id);
    if (!pedido.id_order_mp) throw new ErroRegraNegocioHttp("Pedido sem checkout.");
    await this.sincronizar(pedido);
    const hash = createHash("sha256").update(`${acao}:${pedido.id}`).digest("hex");
    const chave = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    await this.repo.executar("operacao_financeira", {
      id,
      administrador,
      acao,
      justificativa,
      chave,
    });
    if (acao === "cancelar") await this.mercadoPago.cancelarOrder(pedido.id_order_mp, chave);
    else await this.mercadoPago.estornarOrder(pedido.id_order_mp, chave);
    return this.sincronizar(await this.repo.obterPedido(id));
  }
}

export async function consultarMinhaAssinatura(cliente: SupabaseClient) {
  const resultados = await Promise.all([
    cliente.rpc("tem_acesso_premium"),
    cliente.from("assinaturas").select("*").order("criado_em", { ascending: false }).limit(100),
    cliente
      .from("pedidos_pagamento")
      .select(
        "id,id_plano,plano_nome,valor,moeda,status,id_order_mp,checkout_url,criado_em,expira_em,duracao_meses",
      )
      .order("criado_em", { ascending: false })
      .limit(100),
    cliente.from("pagamentos").select("*").order("criado_em", { ascending: false }).limit(100),
    cliente
      .from("historico_assinaturas")
      .select("*")
      .order("criado_em", { ascending: false })
      .limit(100),
    cliente
      .from("avisos_assinatura")
      .select("*")
      .order("criado_em", { ascending: false })
      .limit(10),
  ]);
  for (const r of resultados) if (r.error) throw r.error;
  const monetarios = (registros: Record<string, unknown>[] | null) =>
    registros?.map((r) => ({
      ...r,
      ...(r.valor === undefined ? {} : { valor: String(r.valor) }),
      ...(r.valor_estornado === undefined ? {} : { valor_estornado: String(r.valor_estornado) }),
    })) ?? [];
  return {
    premium: resultados[0]!.data === true,
    assinaturas: monetarios(resultados[1]!.data),
    pedidos: monetarios(resultados[2]!.data),
    pagamentos: monetarios(resultados[3]!.data),
    historico: resultados[4]!.data,
    avisos: resultados[5]!.data,
    renovacaoAutomatica: false,
  };
}
