import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { RepositorioConsultasNegocioSupabase } from "../src/infrastructure/repositorio-consultas-supabase.js";

function repositorio(resposta: unknown) {
  const chamadas: { url: URL; body: unknown }[] = [];
  const cliente = createClient("https://projeto.supabase.co", "chave-publicavel-teste", {
    auth: { persistSession: false },
    global: {
      fetch: async (entrada, opcoes) => {
        chamadas.push({
          url: new URL(String(entrada)),
          body: opcoes?.body ? JSON.parse(String(opcoes.body)) : undefined,
        });
        return new Response(JSON.stringify(resposta), {
          headers: { "Content-Type": "application/json", "Content-Range": "0-0/3" },
        });
      },
    },
  });
  return {
    repo: new RepositorioConsultasNegocioSupabase(cliente, {
      id: "usuario",
      sessionId: "",
      token: "sessao",
    }),
    chamadas,
  };
}

test("repositório Supabase preserva paginação, filtros e projeção do contrato", async () => {
  const { repo, chamadas } = repositorio([
    { idBanca: "banca", nome: "Banca Exemplo", sigla: "BE", criado_em: "2026-10-23T10:00:00Z" },
  ]);
  const resultado = await repo.consultarPaginaRegistros("Banca", "BancaResponseModel", {
    filters: [{ column: "nome", op: "contains", value: "100%_" }],
    limit: 2,
    offset: 4,
    order: [["nome"]],
  });
  assert.equal(resultado.total, 3);
  assert.equal(resultado.itens[0]?.nome, "Banca Exemplo");
  assert.equal(chamadas[0]?.url.searchParams.get("nome"), "ilike.%100\\%\\_%");
  assert.equal(chamadas[0]?.url.searchParams.get("offset"), "4");
  assert.equal(chamadas[0]?.url.searchParams.get("limit"), "2");
});

test("RPC recebe jsonb como objeto, preservando textos comuns", async () => {
  const { repo, chamadas } = repositorio("identificador");
  await repo.executarFuncaoPostgreSql("criar_simulado_filtrado", {
    p_cotas_temas: JSON.stringify([{ idTema: "tema", quantidade: 2 }]),
    p_nome: "Teste",
  });
  assert.deepEqual(chamadas[0]?.body, {
    p_cotas_temas: [{ idTema: "tema", quantidade: 2 }],
    p_nome: "Teste",
  });
});

test("mutações diretas ficam restritas aos cadastros autorizados", async () => {
  const { repo, chamadas } = repositorio([]);
  await assert.rejects(
    repo.executarMutacaoRegistro("Usuario", "update", "usuario", { tipo: "administrador" }),
    /funções autorizadas/,
  );
  assert.equal(chamadas.length, 0);
});
