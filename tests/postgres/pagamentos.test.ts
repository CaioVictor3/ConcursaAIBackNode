import { ServicoPagamentosAssinaturas } from "../../src/application/pagamentos-assinaturas.service.js";
import { RepositorioPagamentosSupabase } from "../../src/infrastructure/repositorio-pagamentos-supabase.js";
import {
  ClienteMercadoPago,
  type OrderMercadoPago,
} from "../../src/infrastructure/cliente-mercado-pago.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cluster } from "./cluster-postgresql-descartavel.js";
import type { PedidoPagamento } from "../../src/domain/pagamentos-assinaturas.js";

test(
  "pagamentos: transações PostgreSQL, concorrência, renovação, estorno, RLS e workers",
  { timeout: 180000 },
  async (t) => {
    const c = await cluster();
    try {
      const aluno = randomUUID(),
        outro = randomUUID(),
        admin = randomUUID();
      for (const id of [aluno, outro, admin]) {
        await c.admin.query(
          "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
          [id, `${id}@example.invalid`],
        );
        await c.admin.query(
          'update public.usuarios set cadastro_completo=true where "idUsuario"=$1',
          [id],
        );
      }
      await c.admin.query(
        "update public.usuarios set tipo='administrador' where \"idUsuario\"=$1",
        [admin],
      );
      const planos = (
        await c.admin.query("select * from public.planos_comerciais order by duracao_meses")
      ).rows;
      assert.deepEqual(
        planos.map((p) => p.valor),
        ["19.90", "101.40", "166.80"],
      );
      const rpc = async <T = any>(operacao: string, dados: Record<string, unknown> = {}) =>
        (
          await c.admin.query("select public.operar_financeiro_backend($1,$2::jsonb) valor", [
            operacao,
            JSON.stringify(dados),
          ])
        ).rows[0].valor as T;
      const criar = (plano = planos[0].id, chave = randomUUID()) =>
        rpc<PedidoPagamento>("criar_pedido", { pessoa: aluno, plano, chave, ambiente: "teste" });
      let contador = 0;
      async function checkout(p: PedidoPagamento) {
        const r = await rpc("reservar_checkout", { id: p.id, payload: { total_amount: p.valor } });
        assert.ok(r);
        return rpc<PedidoPagamento>("salvar_checkout", {
          id: p.id,
          reserva: r.reserva,
          order: "ORDTST" + String(++contador).padStart(26, "0"),
          url: "https://www.mercadopago.com.br/checkout/v1/redirect?order_id=teste",
        });
      }
      const aplicar = (
        p: PedidoPagamento,
        status = "aprovado",
        versao = new Date().toISOString(),
        webhook = true,
        extra: Record<string, unknown> = {},
      ) =>
        rpc<PedidoPagamento>("aplicar_order", {
          id: p.id,
          order: p.id_order_mp,
          status,
          versao,
          valor: p.valor,
          moeda: "BRL",
          detalhe: "accredited",
          pagamento: "PAY" + p.id,
          metodo: "pix",
          parcelas: 1,
          estornado: "0.00",
          webhook,
          ...extra,
        });
      const temPremium = async (id = aluno) => {
        const client = await c.admin.connect();
        try {
          await client.query("begin");
          await client.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
          await client.query("set local role authenticated");
          const v = (await client.query("select public.tem_acesso_premium() v")).rows[0].v;
          await client.query("rollback");
          return v;
        } finally {
          client.release();
        }
      };
      await t.test(
        "repetição de criação e concorrência reutilizam o pedido e snapshot",
        async () => {
          const chave = randomUUID();
          const pedidos = await Promise.all([
            criar(planos[0].id, chave),
            criar(planos[0].id, chave),
            criar(),
          ]);
          assert.equal(new Set(pedidos.map((p) => p.id)).size, 1);
          assert.equal(pedidos[0]!.valor, "19.90");
          assert.equal(await temPremium(), false);
          await assert.rejects(() =>
            rpc("criar_pedido", { pessoa: outro, plano: planos[0].id, chave, ambiente: "teste" }),
          );
          await rpc("salvar_plano", {
            administrador: admin,
            id: planos[0].id,
            codigo: "mensal",
            nome: "Mensal",
            descricao: "Novo preço",
            valor: "25.00",
            duracao_meses: 1,
            beneficios: planos[0].beneficios,
            ativo: true,
            destaque: false,
            ordem: 1,
          });
          assert.equal(
            (await rpc<PedidoPagamento>("pedido", { id: pedidos[0]!.id })).valor,
            "19.90",
          );
        },
      );
      let p1 = await criar();
      p1 = await checkout(p1);
      const versao = new Date().toISOString();
      await t.test(
        "redirect e consulta não ativam; webhook confirmado ativa uma única vez",
        async () => {
          await aplicar(p1, "aprovado", versao, false);
          assert.equal(await temPremium(), false);
          await Promise.all([aplicar(p1, "aprovado", versao), aplicar(p1, "aprovado", versao)]);
          assert.equal(await temPremium(), true);
          assert.equal(
            (
              await c.admin.query(
                "select count(*) n from public.assinaturas where id_pessoa=$1 and status='ativa'",
                [aluno],
              )
            ).rows[0].n,
            "1",
          );
        },
      );
      let p2: PedidoPagamento;
      await t.test(
        "renovação antecipada e mudança de plano acrescentam meses de calendário",
        async () => {
          await c.admin.query(
            "update public.assinaturas set inicio_em='2026-10-01T12:00:00Z',fim_em='2027-01-31T12:00:00Z' where id_pedido=$1",
            [p1.id],
          );
          p2 = await checkout(await criar());
          await aplicar(p2);
          const a = (
            await c.admin.query("select * from public.assinaturas where id_pedido=$1", [p2.id])
          ).rows[0];
          assert.equal(a.inicio_em.toISOString(), "2027-01-31T12:00:00.000Z");
          assert.equal(a.fim_em.toISOString(), "2027-02-28T12:00:00.000Z");
          const anual = await checkout(await criar(planos[2].id));
          await aplicar(anual);
          const a2 = (
            await c.admin.query("select * from public.assinaturas where id_pedido=$1", [anual.id])
          ).rows[0];
          assert.equal(a2.inicio_em.toISOString(), a.fim_em.toISOString());
          assert.equal(a2.fim_em.toISOString(), "2028-02-28T12:00:00.000Z");
        },
      );
      await t.test(
        "eventos fora de ordem e duplicados não revertem estorno nem alteram outro período",
        async () => {
          const antes = (
            await c.admin.query("select fim_em from public.assinaturas where id_pedido=$1", [
              p2!.id,
            ])
          ).rows[0].fim_em;
          const agora = new Date(Date.now() + 1000).toISOString();
          await aplicar(p1, "estornado", agora, true, { estornado: p1.valor });
          await aplicar(p1, "aprovado", versao);
          await aplicar(p1, "aprovado", new Date(Date.now() + 2000).toISOString());
          assert.equal((await rpc<PedidoPagamento>("pedido", { id: p1.id })).status, "estornado");
          assert.equal(
            (
              await c.admin.query("select fim_em from public.assinaturas where id_pedido=$1", [
                p2!.id,
              ])
            ).rows[0].fim_em.toISOString(),
            antes.toISOString(),
          );
          assert.equal(await temPremium(), false); // Only a future grant remains; access is not pulled forward.
        },
      );
      await t.test(
        "expiração não depende do worker e renovação após vencimento começa agora",
        async () => {
          await c.admin.query(
            "update public.assinaturas set inicio_em=now()-interval '2 months',fim_em=now()-interval '1 second' where id_pessoa=$1 and status='ativa'",
            [aluno],
          );
          assert.equal(await temPremium(), false);
          await rpc("manutencao");
          const novo = await checkout(await criar(planos[1].id));
          await aplicar(novo);
          assert.equal(await temPremium(), true);
          const a = (
            await c.admin.query("select inicio_em from public.assinaturas where id_pedido=$1", [
              novo.id,
            ])
          ).rows[0];
          assert.ok(Math.abs(Date.now() - a.inicio_em.getTime()) < 5000);
          await aplicar(novo, "contestado", new Date(Date.now() + 1000).toISOString());
          assert.equal(await temPremium(), false);
        },
      );
      await t.test(
        "valores divergentes e operações administrativas sem autorização são recusados",
        async () => {
          await assert.rejects(() =>
            aplicar(p1, "aprovado", new Date().toISOString(), true, { valor: "0.01" }),
          );
          await assert.rejects(() =>
            rpc("salvar_plano", { administrador: outro, nome: "Inválido" }),
          );
          const painel = await rpc("painel", { administrador: admin, pagina: 1 });
          assert.ok(painel.indicadores);
          assert.ok(painel.assinaturas.length > 0);
        },
      );
      await t.test(
        "RLS isola histórico; aluno não altera dados financeiros nem chama RPC de backend",
        async () => {
          const client = await c.admin.connect();
          try {
            await client.query("begin");
            await client.query("select set_config('request.jwt.claim.sub',$1,true)", [outro]);
            await client.query("set local role authenticated");
            assert.equal(
              (await client.query("select count(*) n from public.pagamentos")).rows[0].n,
              "0",
            );
            await assert.rejects(() =>
              client.query("select public.operar_financeiro_backend('manutencao','{}')"),
            );
            await client.query("rollback");
            await client.query("begin");
            await client.query("set local role authenticated");
            await assert.rejects(() =>
              client.query("update public.pagamentos set status='aprovado'"),
            );
            await client.query("rollback");
          } finally {
            client.release();
          }
          for (const consulta of [
            "select public.quantidade_questoes_odonto()",
            "select * from public.estatisticas_assuntos()",
            "select public.obter_resultado_tentativa('00000000-0000-4000-8000-000000000000'::uuid)",
          ]) {
            const negado = await c.admin.connect();
            try {
              await negado.query("begin");
              await negado.query("select set_config('request.jwt.claim.sub',$1,true)", [outro]);
              await negado.query("set local role authenticated");
              await assert.rejects(
                () => negado.query(consulta),
                (e: any) => e.code === "42501",
              );
              await negado.query("rollback");
            } finally {
              negado.release();
            }
          }
          assert.equal(await temPremium(admin), true);
        },
      );
      await t.test(
        "fila de webhooks deduplica e reserva com exclusão mútua; falhas são recuperáveis",
        async () => {
          await rpc("receber_webhook", { chave: "evento-unico", order: p1.id_order_mp });
          await rpc("receber_webhook", { chave: "evento-unico", order: p1.id_order_mp });
          const reservas = await Promise.all([
            rpc<any[]>("reservar_eventos", { limite: 5 }),
            rpc<any[]>("reservar_eventos", { limite: 5 }),
          ]);
          assert.equal(reservas.flat().length, 1);
          const e = reservas.flat()[0];
          await rpc("concluir_evento", { chave: e.chave, reserva: e.reserva, erro: "falha_teste" });
          assert.equal(
            (
              await c.admin.query("select status from financeiro.webhooks where chave=$1", [
                e.chave,
              ])
            ).rows[0].status,
            "pendente",
          );
          await c.admin.query(
            "update financeiro.webhooks set proxima_tentativa_em=now() where chave=$1",
            [e.chave],
          );
          const novamente = (await rpc<any[]>("reservar_eventos", { limite: 5 }))[0];
          await rpc("concluir_evento", {
            chave: novamente.chave,
            reserva: novamente.reserva,
            erro: null,
          });
          assert.equal(
            (
              await c.admin.query("select status from financeiro.webhooks where chave=$1", [
                e.chave,
              ])
            ).rows[0].status,
            "processado",
          );
        },
      );
      await t.test(
        "avisos e emails não duplicam; cancelamento solicitado preserva acesso e histórico",
        async () => {
          const novo = await checkout(await criar(planos[2].id));
          await aplicar(novo);
          await c.admin.query(
            "update public.assinaturas set fim_em=now()+interval '7 days' where id_pedido=$1",
            [novo.id],
          );
          await rpc("manutencao");
          await rpc("manutencao");
          assert.equal(
            (
              await c.admin.query(
                "select count(*) n from public.avisos_assinatura where id_pessoa=$1 and dias=7",
                [aluno],
              )
            ).rows[0].n,
            "1",
          );
          assert.equal(
            (
              await c.admin.query(
                "select count(*) n from comunicacao.emails_transacionais where \"idUsuario\"=$1 and tipo_evento='SUBSCRIPTION_EXPIRING' and chave_idempotencia like '%:7:%'",
                [aluno],
              )
            ).rows[0].n,
            "1",
          );
          const assinatura = (
            await c.admin.query("select id from public.assinaturas where id_pedido=$1", [novo.id])
          ).rows[0].id;
          await rpc("solicitar_cancelamento", {
            pessoa: aluno,
            id: assinatura,
            justificativa: "Solicito análise do meu pedido",
          });
          assert.equal(await temPremium(), true);
        },
      );
      await t.test(
        "planos inexistentes/inativos, rejeição/cancelamento e quotas persistentes",
        async () => {
          await assert.rejects(() => criar(randomUUID()));
          await c.admin.query("update public.planos_comerciais set ativo=false where id=$1", [
            planos[1].id,
          ]);
          await assert.rejects(() => criar(planos[1].id));
          await c.admin.query("update public.planos_comerciais set ativo=true where id=$1", [
            planos[1].id,
          ]);
          for (const status of ["pendente", "rejeitado", "cancelado"]) {
            const p = await checkout(await criar(planos[1].id));
            await aplicar(p, status);
            if (status === "pendente")
              await aplicar(p, "cancelado", new Date(Date.now() + 1000).toISOString());
            const a = (
              await c.admin.query("select inicio_em from public.assinaturas where id_pedido=$1", [
                p.id,
              ])
            ).rows[0];
            assert.equal(a.inicio_em, null);
          }
          await rpc("limitar_requisicao", { chave: "teste-quota", limite: 1 });
          await assert.rejects(
            () => rpc("limitar_requisicao", { chave: "teste-quota", limite: 1 }),
            (e: any) => e.code === "P0429",
          );
          await c.admin.query("update financeiro.configuracao set ambiente='producao'");
          assert.equal(await temPremium(), false);
          await assert.rejects(() => criar());
          await c.admin.query("update financeiro.configuracao set ambiente='teste'");
          assert.equal(await temPremium(), true);
        },
      );
      await t.test(
        "serviço completo: checkout HTTP simulado, falha recuperável, webhook e ativação atômica",
        async () => {
          const repo = {
            executar: rpc,
            obterPedido: (id: string) => rpc<PedidoPagamento>("pedido", { id }),
          } as unknown as RepositorioPagamentosSupabase;
          let estado: OrderMercadoPago;
          let falharConsulta = false;
          let criacoes = 0;
          const mp = new ClienteMercadoPago(
            {
              ambiente: "teste",
              accessToken: "APP_USR-unitario-nao-real",
              webhookSecret: "segredo-unitario-123456",
              sellerId: "1234",
              applicationId: "5678",
              retornoUrl: "https://app.example.test/pagamento/retorno",
              maxParcelas: 1,
              timeoutMs: 1000,
            },
            async (url, init) => {
              if (String(url).endsWith("/users/me"))
                return Response.json({ id: "1234", site_id: "MLB", tags: ["test_user"] });
              if (init?.method === "POST") {
                criacoes++;
                const body = JSON.parse(String(init.body));
                estado = {
                  id: "ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9",
                  type: "online",
                  processing_mode: "manual",
                  status: "created",
                  status_detail: "created",
                  external_reference: body.external_reference,
                  total_amount: body.total_amount,
                  total_paid_amount: "0.00",
                  currency: "BRL",
                  user_id: "1234",
                  integration_data: { application_id: "5678" },
                  created_date: new Date().toISOString(),
                  last_updated_date: new Date().toISOString(),
                  checkout_url:
                    "https://www.mercadopago.com.br/checkout/v1/redirect?order_id=teste",
                };
              } else if (falharConsulta) throw new Error("timeout simulado");
              return Response.json(estado);
            },
          );
          const servico = new ServicoPagamentosAssinaturas(repo, mp);
          const chave = randomUUID();
          const p = await servico.iniciarCheckout(outro, planos[0].id, chave);
          assert.ok(p.checkout_url);
          assert.equal(await temPremium(outro), false);
          await servico.iniciarCheckout(outro, planos[0].id, chave);
          assert.equal(criacoes, 1);
          estado!.status = "processed";
          estado!.status_detail = "accredited";
          estado!.total_paid_amount = p.valor;
          estado!.last_updated_date = new Date(Date.now() + 1000).toISOString();
          estado!.transactions = {
            payments: [
              {
                id: "PAY-Servico-Local",
                amount: p.valor,
                paid_amount: p.valor,
                status: "processed",
                status_detail: "accredited",
                payment_method: { id: "pix", type: "bank_transfer", installments: 1 },
              },
            ],
          };
          await rpc("receber_webhook", { chave: "servico-evento", order: p.id_order_mp });
          falharConsulta = true;
          assert.equal((await servico.processarFila()).falhas, 1);
          assert.equal(await temPremium(outro), false);
          await c.admin.query(
            "update financeiro.webhooks set proxima_tentativa_em=now() where chave='servico-evento'",
          );
          falharConsulta = false;
          assert.equal((await servico.processarFila()).processados, 1);
          assert.equal(await temPremium(outro), true);
          assert.equal((await servico.processarFila()).processados, 0);
        },
      );
    } finally {
      await c.stop();
    }
  },
);
