import { config } from "dotenv";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { criarClienteSupabaseAdministrativo } from "../src/utils/supabase/admin.js";

config({ path: ".env.local" });
const base = process.env.CONCURSA_TEST_API_URL ?? "http://127.0.0.1:5173";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("Execute a verificação contra a API local.");
const banco = criarClienteSupabaseAdministrativo();
const usuarios: string[] = [];
const idBanca = randomUUID(),
  idProva = randomUUID(),
  idTema = randomUUID(),
  idQuestao = randomUUID(),
  idCorreta = randomUUID(),
  idIncorreta = randomUUID();
const resultados: string[] = [];

async function inserir(tabela: string, dados: unknown) {
  const { error } = await banco.from(tabela).insert(dados);
  if (error) throw error;
}
async function remover(tabela: string, coluna: string, valor: string) {
  const { error } = await banco.from(tabela).delete().eq(coluna, valor);
  if (error) throw error;
}
async function criarConta(tipo: "estudante" | "administrador") {
  const email = `integracao-${randomUUID()}@example.invalid`,
    senha = randomBytes(24).toString("base64url");
  const { data, error } = await banco.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { tipo: "administrador" },
  });
  if (error || !data.user) throw error ?? new Error("Conta temporária indisponível");
  const id = data.user.id;
  usuarios.push(id);
  const inicial = await banco.from("usuarios").select("tipo").eq("idUsuario", id).single();
  assert.equal(
    inicial.data?.tipo,
    "estudante",
    "Metadata não pode conceder acesso administrativo.",
  );
  const perfil = await banco
    .from("usuarios")
    .update({
      nome_completo: "Teste Integração API",
      tipo,
      estado_cadastro: "ativo",
      cadastro_completo: true,
    })
    .eq("idUsuario", id)
    .select("idUsuario")
    .single();
  if (perfil.error) throw perfil.error;
  const cookies = new Map<string, string>();
  async function api<T = Record<string, unknown>>(
    rota: string,
    metodo = "GET",
    dados?: unknown,
    status = 200,
  ): Promise<T> {
    const r = await fetch(base + "/api/" + rota, {
      method: metodo,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Concursa-Client": "web",
        Origin: base,
        Cookie: [...cookies].map(([k, v]) => k + "=" + v).join("; "),
      },
      body: dados === undefined ? undefined : JSON.stringify(dados),
      signal: AbortSignal.timeout(30000),
    });
    for (const cookie of r.headers.getSetCookie()) {
      const par = cookie.split(";")[0]!;
      const indice = par.indexOf("=");
      cookies.set(par.slice(0, indice), par.slice(indice + 1));
    }
    const j = (await r.json()) as { success: boolean; message: string; data: T };
    assert.equal(r.status, status, `${metodo} ${rota}: ${j.message}`);
    return j.data;
  }
  await api(
    `Navegador/entrar-${tipo === "administrador" ? "administrador" : "estudante"}`,
    "POST",
    { email, senha },
  );
  if (tipo === "administrador") {
    const sessao = await api<{ accessToken: string }>("Autenticacao/entrar-administrador", "POST", {
      email,
      senha,
    });
    const resposta = await fetch(base + "/api/Usuario/obter-meu-usuario", {
      headers: { Authorization: "Bearer " + sessao.accessToken },
    });
    assert.equal(resposta.status, 200, "Cliente Bearer deve acessar a mesma API autenticada.");
  }
  return { id, api };
}

try {
  const aluno = await criarConta("estudante"),
    outro = await criarConta("estudante"),
    admin = await criarConta("administrador");
  resultados.push("Login de aluno e administrador via proxy do frontend");
  await inserir("bancas", { idBanca, nome: "Teste de integração API", sigla: "QA" });
  await inserir("concursos", {
    idConcurso: idProva,
    nome: "Teste de integração API",
    orgao: "Teste API",
    cargo: "Odontologia",
    ano: 2026,
    idOrganizadora: idBanca,
    composicao_confirmada: true,
  });
  await inserir("temas", { idTema, nome: "Teste Integração " + idTema });
  await inserir("questoes", {
    idQuestao,
    idConcurso: idProva,
    idTema,
    numero: 1,
    enunciado: "Questão temporária de integração. Qual alternativa é correta?",
    status: "publicada",
    dificuldade: "media",
  });
  await inserir("alternativas", [
    {
      idAlternativa: idCorreta,
      idQuestao,
      letra: "A",
      texto: "Alternativa correta de teste",
      ordem: 1,
    },
    {
      idAlternativa: idIncorreta,
      idQuestao,
      letra: "B",
      texto: "Alternativa incorreta de teste",
      ordem: 2,
    },
  ]);
  await inserir("gabaritos", {
    idQuestao,
    idAlternativaCorreta: idCorreta,
    status: "definitivo",
    explicacao: "Justificativa temporária para validar a integração.",
  });

  await aluno.api("Simulado/obter-disponibilidade-assuntos");
  await aluno.api("Estudo/obter-resumo-revisao");
  await aluno.api("Estudo/obter-meta-semanal");
  const simulado = await aluno.api<{ idSimulado: string; idTentativa: string }>(
    "Simulado/criar-simulado-filtrado",
    "POST",
    { nome: "Teste integração API", quantidade: 1, idTema, cotasTemas: [] },
  );
  assert.ok(simulado.idSimulado);
  assert.ok(simulado.idTentativa);
  await outro.api(
    "Tentativa/obter-tentativa-simulado?idTentativa=" + simulado.idTentativa,
    "GET",
    undefined,
    404,
  );
  resultados.push("Sorteio do simulado e isolamento entre estudantes");
  await aluno.api("Tentativa/obter-questoes-tentativa?idTentativa=" + simulado.idTentativa);
  await aluno.api("Tentativa/responder-questao-simulado", "PUT", {
    idTentativa: simulado.idTentativa,
    idQuestao,
    idAlternativaSelecionada: idCorreta,
  });
  await aluno.api("Tentativa/finalizar-tentativa-simulado", "POST", {
    idTentativa: simulado.idTentativa,
  });
  await aluno.api("Tentativa/obter-resultado-tentativa?idTentativa=" + simulado.idTentativa);
  await aluno.api("honra/estudante/meu-progresso");
  await aluno.api("estudo/estudante/painel-desempenho");
  await aluno.api("honra/estudante/historico-pontos");
  await aluno.api("PreferenciaComunicacao/obter-minha-preferencia");
  await aluno.api("Suporte/listar-chamados");
  resultados.push("Resposta, correção, honra, desempenho, preferências e suporte");
  for (const rota of [
    "Administracao/obter-metricas-sistema",
    "EmailsTransacionais/listar-historico",
    "EmailsTransacionais/obter-metricas",
    "EmailsTransacionais/listar-fluxos",
    "honra/administracao/painel-sistema-honra",
  ])
    await admin.api(rota);
  resultados.push("Métricas administrativas, e-mails e honra");
  await aluno.api("Navegador/sair-sessao", "POST", {});
  await aluno.api("Usuario/obter-meu-usuario", "GET", undefined, 401);
  resultados.push("Logout e recusa de sessão encerrada");
  console.log(JSON.stringify({ sucesso: true, verificacoes: resultados }, null, 2));
} finally {
  const falhas: string[] = [];
  for (const id of usuarios) {
    try {
      await remover("honra_questoes_pontuadas", "id_pessoa", id);
      await remover("tentativas_simulado", "idPessoa", id);
      await remover("simulados", "idPessoaCriadora", id);
      await remover("pessoas", "idPessoa", id);
      const { error } = await banco.auth.admin.deleteUser(id);
      if (error) throw error;
    } catch {
      falhas.push(id);
    }
  }
  for (const [tabela, coluna, id] of [
    ["questoes", "idQuestao", idQuestao],
    ["concursos", "idConcurso", idProva],
    ["temas", "idTema", idTema],
    ["bancas", "idBanca", idBanca],
  ]) {
    try {
      await remover(tabela!, coluna!, id!);
    } catch {
      falhas.push(tabela!);
    }
  }
  if (falhas.length) throw new Error("Falha ao limpar dados temporários: " + falhas.join(", "));
  console.log("Dados temporários removidos.");
}
