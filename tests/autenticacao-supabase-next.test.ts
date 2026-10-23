import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { atenderAutenticacaoSupabaseNext } from "../src/http/autenticacao-supabase-next.js";

const idUsuario = "c709e284-fafa-47c7-981f-bf122621b0c8";

function clienteFalso(
  tipo = "estudante",
  sucesso = true,
  erroPerfil: { code: string } | null = null,
  estadoCadastro = "ativo",
) {
  let saiu = false;
  const perfil = {
    idUsuario,
    idPessoa: idUsuario,
    nome_completo: "Aluno Exemplo",
    email: "aluno@exemplo.invalid",
    tipo,
    estado_cadastro: estadoCadastro,
    cadastro_completo: true,
    criado_em: "2026-01-01T00:00:00Z",
    ultimo_acesso_em: null,
  };
  const cliente = {
    auth: {
      signInWithPassword: async () => ({
        error: sucesso ? null : new Error("credenciais incorretas"),
        data: {
          user: sucesso ? { id: idUsuario } : null,
          session: sucesso ? { expires_in: 3600 } : null,
        },
      }),
      signOut: async () => {
        saiu = true;
        return { error: null };
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: erroPerfil ? null : perfil, error: erroPerfil }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  return { cliente, saiu: () => saiu };
}

test("login Supabase preserva o contrato público do aluno", async () => {
  const { cliente } = clienteFalso();
  const resposta = await atenderAutenticacaoSupabaseNext(
    "POST",
    "/api/Navegador/entrar-estudante",
    cliente,
    async () => ({ email: "aluno@exemplo.invalid", senha: "senha-de-teste" }),
  );

  assert.equal(resposta.data?.usuario?.idUsuario, idUsuario);
  assert.equal(resposta.data?.usuario?.tipo, "estudante");
  assert.equal(resposta.data?.expiresIn, 3600);
  assert.equal("accessToken" in (resposta.data ?? {}), false);
});

test("login administrativo recusa outro tipo e encerra a sessão criada", async () => {
  const falso = clienteFalso();
  await assert.rejects(
    atenderAutenticacaoSupabaseNext(
      "POST",
      "/api/Navegador/entrar-administrador",
      falso.cliente,
      async () => ({ email: "aluno@exemplo.invalid", senha: "senha-de-teste" }),
    ),
    { status: 401, message: "E-mail ou senha incorretos. Confira seus dados e tente novamente." },
  );
  assert.equal(falso.saiu(), true);
});

test("erro do provedor não revela se a conta existe", async () => {
  const { cliente } = clienteFalso("estudante", false);
  await assert.rejects(
    atenderAutenticacaoSupabaseNext(
      "POST",
      "/api/Navegador/entrar-estudante",
      cliente,
      async () => ({ email: "aluno@exemplo.invalid", senha: "senha-errada" }),
    ),
    { status: 401, message: "E-mail ou senha incorretos. Confira seus dados e tente novamente." },
  );
});

test("perfil sem permissão encerra a sessão e sinaliza configuração indisponível", async () => {
  const falso = clienteFalso("estudante", true, { code: "42501" });
  await assert.rejects(
    atenderAutenticacaoSupabaseNext(
      "POST",
      "/api/Navegador/entrar-estudante",
      falso.cliente,
      async () => ({ email: "aluno@exemplo.invalid", senha: "senha-de-teste" }),
    ),
    { status: 503 },
  );
  assert.equal(falso.saiu(), true);
});

test("conta inativa não recebe sessão", async () => {
  const falso = clienteFalso("estudante", true, null, "bloqueado");
  await assert.rejects(
    atenderAutenticacaoSupabaseNext(
      "POST",
      "/api/Navegador/entrar-estudante",
      falso.cliente,
      async () => ({ email: "aluno@exemplo.invalid", senha: "senha-de-teste" }),
    ),
    { status: 401 },
  );
  assert.equal(falso.saiu(), true);
});
