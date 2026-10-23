import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import request from "supertest";
import { cluster } from "./cluster-postgresql-descartavel.js";
import { criarAplicacaoHttpExpress } from "../../src/aplicacao-http-express.js";
import { carregarConfiguracoesAmbiente } from "../../src/config/configuracoes-ambiente.js";
import {
  gerarHashSenhaCompativel,
  gerarTokenAleatorioSeguro,
  calcularHashToken,
  descriptografarConteudoAutenticado,
  verificarSenhaHashPersistido,
} from "../../src/infrastructure/criptografia-senhas-tokens-links.js";
import {
  RepositorioConsultasNegocioPostgreSql,
  criarFiltroIgualdade,
} from "../../src/infrastructure/repositorio-consultas-postgresql.js";
import { RepositorioContasSessoesPostgreSql } from "../../src/infrastructure/repositorio-contas-sessoes-postgresql.js";
import type { HttpFetch } from "../../src/infrastructure/seguranca-requisicoes-https.js";
import type { Logger } from "pino";
import { pino } from "pino";

async function sqlFile(path: string): Promise<string> {
  let text = await readFile(path, "utf8");

  for (const linhaMigracao of [...text.matchAll(/^\\ir (.+)$/gm)]) {
    const included = await sqlFile(join(dirname(path), linhaMigracao[1]!.trim()));

    text = text.replace(linhaMigracao[0], () => included);
  }

  return text;
}

test(
  "PostgreSQL real, RLS, autenticação e fluxos HTTP completos",
  { timeout: 180000 },
  async (contextoTeste) => {
    const clusterPostgreSql = await cluster();

    const chaveAssinaturaJwt = randomBytes(64);

    const webhookSecret = randomBytes(32);

    let providerCalls = 0;

    let providerMode = "ok";

    let aiCalls = 0;

    const contextosPerguntasIA: { historicoPerguntas?: unknown[] }[] = [];

    const http: HttpFetch = async (urlSolicitada, init) => {
      if (String(urlSolicitada).includes("openai")) {
        aiCalls++;

        const body = JSON.parse(init!.body as string);

        const context = JSON.parse(body.input[0].content);

        if (!body.text) {
          contextosPerguntasIA.push(context);

          return new Response(
            JSON.stringify({
              status: "completed",
              usage: {
                input_tokens: 90,
                output_tokens: 30,
                input_tokens_details: { cached_tokens: 0 },
              },
              output: [
                {
                  type: "message",
                  content: [
                    { type: "output_text", text: "A alternativa B não atende ao enunciado." },
                  ],
                },
              ],
            }),
          );
        }

        const content = {
          resumo: "Resumo didático",
          respostaMarcada: "Alternativa B incorreta",
          respostaCorreta: "Alternativa A correta",
          alternativas: context.alternativas.map(
            (alternativaQuestao: { idAlternativa: string }) => ({
              idAlternativa: alternativaQuestao.idAlternativa,
              justificativa: "Justificativa didática",
            }),
          ),
          pontosRevisao: ["Revisar tema"],
          ressalvas: null,
        };

        return new Response(
          JSON.stringify({
            status: "completed",
            usage: {
              input_tokens: 128,
              output_tokens: 64,
              input_tokens_details: { cached_tokens: 0 },
            },
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: JSON.stringify(content) }],
              },
            ],
          }),
        );
      }

      if (String(urlSolicitada).includes("resend")) {
        providerCalls++;

        const body = JSON.parse(init!.body as string);

        assert.ok(body.html.includes("ConcursaAI"));

        assert.ok((init!.headers as Record<string, string>)["Idempotency-Key"]);

        return new Response(
          JSON.stringify(
            providerMode === "ok" ? { id: "message-" + providerCalls } : { error: "test" },
          ),
          { status: providerMode === "ok" ? 200 : 422 },
        );
      }

      throw new Error("Chamada externa não autorizada no teste: " + String(urlSolicitada));
    };

    const config = carregarConfiguracoesAmbiente({
      DATABASE_URL: clusterPostgreSql.url,
      AUTH_SIGNING_KEY: chaveAssinaturaJwt.toString("base64"),
      AUTH_CLIENT_URL: "http://localhost:5173",
      CORS_ORIGINS: "http://localhost:5173",
      RESEND_API_KEY: "test-only",
      RESEND_FROM: "sender@example.test",
      RESEND_WEBHOOK_SECRET: "whsec_" + webhookSecret.toString("base64"),
      OPENAI_API_KEY: "test-only",
      EMAIL_WORKER_ENABLED: "false",
      LOG_LEVEL: "silent",
    });

    const runtime = criarAplicacaoHttpExpress({ config, fetch: http });

    const accounts = runtime.auth.accounts;

    const logger = pino({ level: "silent" });

    const adminId = randomUUID();

    const studentId = randomUUID();

    const otherId = randomUUID();

    const password = "SenhaTeste-123";

    const hash = await gerarHashSenhaCompativel(password);

    const person = { nome_completo: "Pessoa de Teste" };

    let adminToken = "";

    let studentToken = "";

    let otherToken = "";

    let studentRefresh = "";

    let bankId = "";

    let examId = "";

    let questionId = "";

    let simulationId = "";

    let attemptId = "";

    let altA = "";

    let altB = "";

    const call = async (
      method: string,
      path: string,
      body: Record<string, unknown> = {},
      token = adminToken,
      expected = 200,
    ) => {
      const requisicaoHttp = request(runtime.app)
        [method as "get"]("/api/" + path)
        .set("Authorization", "Bearer " + token);

      const respostaHttp = await (method === "get" || method === "delete"
        ? requisicaoHttp.query(body)
        : requisicaoHttp.send(body));

      assert.equal(
        respostaHttp.status,
        expected,
        `${method} ${path}: ${JSON.stringify(respostaHttp.body)}`,
      );

      return respostaHttp.body;
    };

    try {
      await contextoTeste.test(
        "testes SQL originais: provas, cotas, revisão, IA, suporte e identidade",
        async () => {
          for (const filename of (await readdir("database/reference/tests"))
            .filter((registroAtual) => registroAtual.endsWith(".sql"))
            .sort()) {
            const client = await clusterPostgreSql.admin.connect();

            try {
              await client.query(await sqlFile(join("database/reference/tests", filename)));
            } catch (erroCapturado) {
              await client.query("ROLLBACK");

              throw new Error(
                "Teste SQL original falhou: " + filename + ": " + (erroCapturado as Error).message,
                { cause: erroCapturado },
              );
            } finally {
              client.release();
            }
          }
        },
      );

      await contextoTeste.test(
        "provisionamento de contas sem privilégios administrativos e login",
        async () => {
          for (const identificadorUsuario of [adminId, studentId, otherId]) {
            await accounts.criarContaUsuario(
              identificadorUsuario,
              identificadorUsuario + "@example.test",
              hash,
              new Date().toISOString(),
              person,
              true,
            );
          }

          assert.equal(
            (await accounts.buscarContaPorIdentificador("id", adminId))!.perfil.tipo,
            "estudante",
          );

          await clusterPostgreSql.admin.query(
            'update public.usuarios set tipo=$1 where "idUsuario"=$2',
            ["administrador", adminId],
          );

          const sessaoAdministrador = await call("post", "Autenticacao/entrar-administrador", {
            email: adminId + "@example.test",
            senha: password,
          });

          adminToken = sessaoAdministrador.data.accessToken;

          const sessaoEstudante = await call("post", "Autenticacao/entrar-estudante", {
            email: studentId + "@example.test",
            senha: password,
          });

          studentToken = sessaoEstudante.data.accessToken;

          studentRefresh = sessaoEstudante.data.refreshToken;

          const sessaoOutroEstudante = await call("post", "Autenticacao/entrar-estudante", {
            email: otherId + "@example.test",
            senha: password,
          });

          otherToken = sessaoOutroEstudante.data.accessToken;

          await call("get", "Questao/listar-questoes", {}, studentToken, 403);
        },
      );

      await contextoTeste.test(
        "RLS, pool concorrente e ausência de acesso a credenciais pelo papel de negócio",
        async () => {
          const repo = (identificadorUsuario: string) =>
            new RepositorioConsultasNegocioPostgreSql(runtime.db, {
              id: identificadorUsuario,
              sessionId: randomUUID(),
              token: "validado",
            });

          const result = await Promise.all(
            Array.from({ length: 12 }, async (_valorNaoUtilizado, indiceRequisicao) => {
              const identificadorUsuario = indiceRequisicao % 2 ? studentId : otherId;

              const paginaUsuarios = await repo(identificadorUsuario).consultarPaginaRegistros(
                "Usuario",
                "UsuarioResponseModel",
              );

              assert.equal(paginaUsuarios.total, 1);

              assert.equal(paginaUsuarios.itens[0]!.idUsuario, identificadorUsuario);
            }),
          );

          assert.equal(result.length, 12);

          await assert.rejects(
            runtime.db.executarComoUsuarioAutenticado(
              { id: studentId, sessionId: "", token: "validado" },
              (clienteTransacaoPostgreSql) =>
                clienteTransacaoPostgreSql.query("select * from identidade.contas"),
            ),
            { code: "42501" },
          );

          assert.equal(
            (
              await runtime.db.executarConsultaSqlParametrizada<{ current_user: string }>(
                "select current_user",
              )
            ).rows[0]!.current_user,
            "concursa_backend",
          );
        },
      );

      await contextoTeste.test(
        "cadastros administrativos, normalização, duplicidades e filtros literais",
        async () => {
          const bank = await call("post", "Banca/criar-banca", {
            nome: "  Banca Teste  ",
            sigla: "BT",
          });

          bankId = bank.data.idBanca;

          assert.equal(bank.data.nome, "Banca Teste");

          await call("post", "Banca/criar-banca", { nome: "banca teste" }, adminToken, 409);

          const percent = await call("get", "Banca/listar-bancas", {
            busca: "%",
          });

          assert.equal(percent.data.total, 0);

          await call("put", "Banca/atualizar-banca", {
            idBanca: bankId,
            nome: "Banca Teste Atualizada",
            sigla: "BTA",
          });

          const discipline = await call("post", "Disciplina/criar-disciplina", {
            nome: "Disciplina Teste",
            ativa: true,
          });

          const identificadorDisciplina = discipline.data.idDisciplina;

          const subject = await call("post", "Assunto/criar-assunto", {
            nome: "Assunto Teste",
            idDisciplina: identificadorDisciplina,
          });

          await call(
            "put",
            "Assunto/atualizar-assunto",
            {
              idAssunto: subject.data.idAssunto,
              idAssuntoPai: subject.data.idAssunto,
              idDisciplina: identificadorDisciplina,
              nome: "Assunto Teste",
            },
            adminToken,
            400,
          );

          await call("delete", "Assunto/excluir-assunto", {
            idAssunto: subject.data.idAssunto,
          });

          await call("patch", "Disciplina/desativar-disciplina", {
            idDisciplina: identificadorDisciplina,
          });

          await call(
            "post",
            "Concurso/criar-concurso",
            { nome: "Concurso Teste", ano: 2026, status: "ativo" },
            adminToken,
            400,
          );
        },
      );

      await contextoTeste.test(
        "prova, tema, questão, alternativas, gabarito e explicação",
        async () => {
          const exam = await call("post", "Prova/criar-prova", {
            ano: 2026,
            orgao: "Órgão Teste",
            idOrganizadora: bankId,
            cargo: "Dentista",
            composicaoConfirmada: false,
          });

          examId = exam.data.idProva;

          const themes = await call("get", "Prova/listar-temas", {}, studentToken);

          assert.equal(themes.data.itens.length, 25);

          const theme = themes.data.itens[0].idTema;

          altA = randomUUID();

          altB = randomUUID();

          const questaoCriada = await call("post", "Questao/criar-questao", {
            idProva: examId,
            idTema: theme,
            numero: 1,
            enunciado: "Qual alternativa está correta?",
            explicacao: "A alternativa A está correta.",
            status: "publicada",
            statusGabarito: "definitivo",
            idAlternativaCorreta: altA,
            alternativas: [
              { idAlternativa: altA, letra: "a", texto: "Alternativa A" },
              { idAlternativa: altB, letra: "b", texto: "Alternativa B" },
            ],
          });

          questionId = questaoCriada.data.idQuestao;

          assert.equal(questaoCriada.data.gabarito.idAlternativaCorreta, altA);

          assert.equal(questaoCriada.data.alternativas[0].letra, "A");

          assert.equal(questaoCriada.data.revisaoPendente, false);

          const listed = await call("get", "Questao/listar-questoes", {
            ano: 2026,
            orgao: "Órgão Teste",
          });

          assert.equal(listed.data.total, 1);

          assert.equal("gabarito" in listed.data.itens[0], false);

          assert.equal("explicacao" in listed.data.itens[0], false);

          await call("put", "Prova/atualizar-prova", {
            idProva: examId,
            ano: 2026,
            orgao: "Órgão Teste",
            idOrganizadora: bankId,
            cargo: "Dentista",
            composicaoConfirmada: true,
          });
        },
      );

      await contextoTeste.test(
        "simulado público, tentativa, resposta, finalização e correção protegida",
        async () => {
          const simuladoCriado = await call("post", "Simulado/criar-simulado", {
            nome: "Simulado Teste",
            idsQuestoes: [questionId],
            publico: true,
            status: "publicado",
            tipo: "padrao",
          });

          simulationId = simuladoCriado.data.idSimulado;

          const start = await call(
            "post",
            "Tentativa/iniciar-tentativa-simulado",
            { idSimulado: simulationId },
            studentToken,
          );

          attemptId = start.data.idTentativa;

          await call(
            "get",
            "Tentativa/obter-tentativa-simulado",
            { idTentativa: attemptId },
            otherToken,
            404,
          );

          const questions = await call(
            "get",
            "Tentativa/obter-questoes-tentativa",
            { idTentativa: attemptId },
            studentToken,
          );

          assert.equal(questions.data.itens.length, 1);

          assert.equal("explicacao" in questions.data.itens[0], false);

          await call(
            "get",
            "Tentativa/obter-resultado-tentativa",
            { idTentativa: attemptId },
            studentToken,
            409,
          );

          await call(
            "put",
            "Tentativa/responder-questao-simulado",
            {
              idTentativa: attemptId,
              idQuestao: questionId,
              idAlternativaSelecionada: altB,
            },
            studentToken,
          );

          const result = await call(
            "post",
            "Tentativa/finalizar-tentativa-simulado",
            { idTentativa: attemptId },
            studentToken,
          );

          assert.equal(result.data.tentativa.totalErros, 1);

          assert.equal(result.data.itens[0].idAlternativaCorreta, altA);

          assert.ok(result.data.itens[0].explicacao);

          await call(
            "put",
            "Tentativa/responder-questao-simulado",
            {
              idTentativa: attemptId,
              idQuestao: questionId,
              idAlternativaSelecionada: altA,
            },
            studentToken,
            409,
          );

          const history = await call("get", "Tentativa/listar-minhas-tentativas", {}, studentToken);

          assert.equal(history.data.total, 1);

          assert.equal(history.data.itens[0].nomeSimulado, "Simulado Teste");
        },
      );

      await contextoTeste.test(
        "Sistema de Honra: primeira resposta, revisão, administração, gabarito e anotações",
        async () => {
          const progressoInicial = await call(
            "get",
            "honra/estudante/meu-progresso",
            {},
            studentToken,
          );

          assert.equal(progressoInicial.data.pontosAcumulados, 12);
          assert.equal(progressoInicial.data.questoesIneditasPontuadas, 1);
          assert.equal(progressoInicial.data.diasConsecutivos, 1);
          assert.equal(progressoInicial.data.tituloAtual.nome, "Iniciante");

          const historico = await call(
            "get",
            "honra/estudante/historico-pontos",
            { pagina: 1, quantidadePorPagina: 20 },
            studentToken,
          );

          assert.equal(historico.data.total, 2);

          await call("get", "honra/administracao/painel-sistema-honra", {}, studentToken, 403);

          const segundaTentativa = await call(
            "post",
            "Tentativa/iniciar-tentativa-simulado",
            { idSimulado: simulationId },
            studentToken,
          );

          await call(
            "put",
            "Tentativa/responder-questao-simulado",
            {
              idTentativa: segundaTentativa.data.idTentativa,
              idQuestao: questionId,
              idAlternativaSelecionada: altA,
            },
            studentToken,
          );

          assert.equal(
            (await call("get", "honra/estudante/meu-progresso", {}, studentToken)).data
              .pontosAcumulados,
            12,
          );

          const painelDesempenho = await call(
            "get",
            "estudo/estudante/painel-desempenho",
            {},
            studentToken,
          );

          assert.equal(painelDesempenho.data.totalRespostas, 2);
          assert.equal(painelDesempenho.data.questoesUnicasResolvidas, 1);
          assert.equal(painelDesempenho.data.questoesRevisadas, 1);
          assert.equal(painelDesempenho.data.simuladosConcluidos, 1);

          await call(
            "put",
            `estudo/questoes/${questionId}/anotacao-pessoal`,
            { conteudo: "Rever o conceito desta questão." },
            studentToken,
          );

          const anotacao = await call(
            "get",
            `estudo/questoes/${questionId}/anotacao-pessoal`,
            {},
            studentToken,
          );

          assert.equal(anotacao.data.conteudo, "Rever o conceito desta questão.");
          assert.deepEqual(
            (await call("get", `estudo/questoes/${questionId}/anotacao-pessoal`, {}, otherToken))
              .data,
            { conteudo: "", atualizadaEm: null },
          );

          await clusterPostgreSql.admin.query(
            'update public.gabaritos set "idAlternativaCorreta"=$1 where "idQuestao"=$2',
            [altB, questionId],
          );

          assert.equal(
            (await call("get", "honra/estudante/meu-progresso", {}, studentToken)).data
              .pontosAcumulados,
            13,
          );

          await clusterPostgreSql.admin.query(
            'update public.gabaritos set status=$1, "idAlternativaCorreta"=null where "idQuestao"=$2',
            ["anulada", questionId],
          );

          assert.equal(
            (await call("get", "honra/estudante/meu-progresso", {}, studentToken)).data
              .pontosAcumulados,
            10,
          );

          await clusterPostgreSql.admin.query(
            'update public.gabaritos set status=$1, "idAlternativaCorreta"=$2 where "idQuestao"=$3',
            ["definitivo", altA, questionId],
          );

          assert.equal(
            (await call("get", "honra/estudante/meu-progresso", {}, studentToken)).data
              .pontosAcumulados,
            12,
          );

          const painel = await call("get", "honra/administracao/painel-sistema-honra");

          assert.equal(painel.data.titulos.length, 10);
          assert.equal(painel.data.regras.length, 7);
          assert.equal(painel.data.evolucaoParticipacao.length, 30);
          assert.equal(painel.data.evolucaoParticipacao.at(-1).estudantesAtivos >= 1, true);

          const tituloAprendiz = painel.data.titulos.find(
            (titulo: { nome: string }) => titulo.nome === "Aprendiz",
          );

          await call("post", "honra/administracao/titulos-honra", {
            ...tituloAprendiz,
            pontuacaoMinima: 10,
          });

          assert.equal(
            (await call("get", "honra/estudante/meu-progresso", {}, studentToken)).data.tituloAtual
              .nome,
            "Aprendiz",
          );

          await call("post", "honra/administracao/titulos-honra", tituloAprendiz);

          await call("put", "honra/administracao/regras-pontuacao/primeira_resolucao", {
            ...painel.data.regras.find(
              (regra: { codigo: string }) => regra.codigo === "primeira_resolucao",
            ),
            pontos: 4,
          });

          assert.equal(
            (await call("get", "honra/estudante/meu-progresso", {}, studentToken)).data
              .pontosAcumulados,
            12,
          );

          await call("post", `honra/administracao/estudantes/${studentId}/ajustes-pontos`, {
            pontos: 5,
            justificativa: "Correção administrativa validada em teste.",
          });

          assert.equal(
            (await call("get", "honra/estudante/meu-progresso", {}, studentToken)).data
              .pontosAcumulados,
            17,
          );

          await call("post", `honra/administracao/estudantes/${studentId}/ajustes-pontos`, {
            pontos: -16,
            justificativa: "Teste de estorno antes de uma retificação de gabarito.",
          });

          await clusterPostgreSql.admin.query(
            'update public.gabaritos set status=$1, "idAlternativaCorreta"=null where "idQuestao"=$2',
            ["anulada", questionId],
          );

          const progressoAposEstorno = await call(
            "get",
            "honra/estudante/meu-progresso",
            {},
            studentToken,
          );

          assert.equal(progressoAposEstorno.data.pontosAcumulados, -1);
          assert.equal(progressoAposEstorno.data.tituloAtual.nome, "Iniciante");
          assert.equal(progressoAposEstorno.data.percentualProgressoTitulo, 0);

          await clusterPostgreSql.admin.query(
            'update public.gabaritos set status=$1, "idAlternativaCorreta"=$2 where "idQuestao"=$3',
            ["definitivo", altA, questionId],
          );

          await call("post", `honra/administracao/estudantes/${studentId}/ajustes-pontos`, {
            pontos: 16,
            justificativa: "Reposição do estorno temporário do teste de retificação.",
          });

          await call(
            "get",
            `honra/administracao/estudantes/${studentId}/historico-pontos`,
            {},
            otherToken,
            403,
          );
        },
      );

      await contextoTeste.test(
        "IA: autorização, reserva real, conteúdo, persistência e cache sem nova cobrança",
        async () => {
          await call(
            "get",
            "AnaliseQuestao/consultar-analise-questao",
            { idTentativa: attemptId, idQuestao: questionId },
            otherToken,
            404,
          );

          const first = await call(
            "post",
            "AnaliseQuestao/solicitar-analise-questao",
            { idTentativa: attemptId, idQuestao: questionId },
            studentToken,
          );

          assert.equal(first.data.conteudo.alternativas.length, 2);

          assert.equal(aiCalls, 1);

          await call(
            "get",
            `ia/estudante/questoes/${questionId}/historico-perguntas`,
            { idTentativa: attemptId },
            otherToken,
            400,
          );

          const primeiraPergunta = await call(
            "post",
            `ia/estudante/questoes/${questionId}/perguntas-contextuais`,
            { idTentativa: attemptId, pergunta: "Por que B está incorreta?" },
            studentToken,
          );

          assert.match(primeiraPergunta.data.resposta, /alternativa B/);

          const segundaPergunta = await call(
            "post",
            `ia/estudante/questoes/${questionId}/perguntas-contextuais`,
            { idTentativa: attemptId, pergunta: "Pode explicar de outra forma?" },
            studentToken,
          );

          assert.ok(segundaPergunta.data.idSolicitacao);
          assert.equal(contextosPerguntasIA[1]?.historicoPerguntas?.length, 1);

          const historicoPerguntas = await call(
            "get",
            `ia/estudante/questoes/${questionId}/historico-perguntas`,
            { idTentativa: attemptId },
            studentToken,
          );

          assert.equal(historicoPerguntas.data.length, 2);
          assert.equal(aiCalls, 3);

          const consumoAnalise = await clusterPostgreSql.admin.query<{
            tokens_entrada: number;
            tokens_saida: number;
          }>(
            "select tokens_entrada, tokens_saida from public.ia_consumo_analises where id_questao=$1",
            [questionId],
          );

          assert.equal(consumoAnalise.rows[0]?.tokens_entrada, 128);
          assert.equal(consumoAnalise.rows[0]?.tokens_saida, 64);

          const second = await call(
            "post",
            "AnaliseQuestao/solicitar-analise-questao",
            { idTentativa: attemptId, idQuestao: questionId },
            studentToken,
          );

          assert.deepEqual(second.data.conteudo, first.data.conteudo);

          assert.equal(aiCalls, 3);

          const tentativaOutroEstudante = await call(
            "post",
            "Tentativa/iniciar-tentativa-simulado",
            { idSimulado: simulationId },
            otherToken,
          );

          await call(
            "put",
            "Tentativa/responder-questao-simulado",
            {
              idTentativa: tentativaOutroEstudante.data.idTentativa,
              idQuestao: questionId,
              idAlternativaSelecionada: altB,
            },
            otherToken,
          );

          await call(
            "post",
            "Tentativa/finalizar-tentativa-simulado",
            { idTentativa: tentativaOutroEstudante.data.idTentativa },
            otherToken,
          );

          const analiseReutilizada = await call(
            "post",
            "AnaliseQuestao/solicitar-analise-questao",
            { idTentativa: tentativaOutroEstudante.data.idTentativa, idQuestao: questionId },
            otherToken,
          );

          assert.deepEqual(analiseReutilizada.data.conteudo, first.data.conteudo);
          assert.equal(aiCalls, 3);
          assert.equal(
            (await clusterPostgreSql.admin.query("select count(*) from public.ia_consumo_analises"))
              .rows[0]?.count,
            "1",
          );
        },
      );

      await contextoTeste.test(
        "revisão, recomendação, estatísticas, meta e prova integral",
        async () => {
          for (const route of [
            "obter-resumo-revisao",
            "listar-questoes-revisao",
            "obter-estatisticas-assuntos",
            "obter-meta-semanal",
          ]) {
            await call("get", "Estudo/" + route, {}, studentToken);
          }

          const goal = await call(
            "put",
            "Estudo/salvar-meta-semanal",
            { quantidadeSemanal: 80 },
            studentToken,
          );

          assert.equal(goal.data.meta, 80);

          await call(
            "put",
            "Estudo/salvar-meta-semanal",
            { quantidadeSemanal: 2001 },
            studentToken,
            400,
          );

          await call("post", "Prova/iniciar-prova", { idProva: examId }, studentToken);

          await call(
            "post",
            "Simulado/criar-simulado-filtrado",
            { nome: "Filtrado Teste", quantidade: 1, cotasTemas: [] },
            studentToken,
          );
        },
      );

      await contextoTeste.test(
        "suporte: propriedade, resposta administrativa e encerramento",
        async () => {
          const open = await call(
            "post",
            "Suporte/abrir-chamado",
            {
              assunto: "Dúvida de teste",
              categoria: "simulados",
              mensagem: "Descrição completa de teste.",
            },
            studentToken,
          );

          const identificadorChamado = open.data.idChamado;

          await call(
            "get",
            "Suporte/obter-chamado",
            { idChamado: identificadorChamado },
            otherToken,
            404,
          );

          await call("post", "Suporte/responder-chamado", {
            idChamado: identificadorChamado,
            mensagem: "Resposta administrativa.",
          });

          const done = await call("post", "Suporte/finalizar-chamado", {
            idChamado: identificadorChamado,
            resolucao: "Atendimento resolvido no teste.",
          });

          assert.equal(done.data.status, "finalizado");

          await call(
            "post",
            "Suporte/responder-chamado",
            { idChamado: identificadorChamado, mensagem: "Não permitido" },
            studentToken,
            409,
          );
        },
      );

      await contextoTeste.test("preferências, workflows e histórico de emails", async () => {
        await call(
          "put",
          "PreferenciaComunicacao/atualizar-minha-preferencia",
          { receberInatividade: true },
          studentToken,
        );

        assert.equal(
          (await call("get", "PreferenciaComunicacao/obter-minha-preferencia", {}, studentToken))
            .data.receberInatividade,
          true,
        );

        const workflows = await call("get", "EmailsTransacionais/listar-fluxos");

        assert.equal(workflows.data.fluxos.length, 4);

        await call("put", "EmailsTransacionais/atualizar-fluxo", {
          tipoEvento: "USER_INACTIVE",
          habilitado: false,
        });

        await call("get", "EmailsTransacionais/listar-historico");

        await call("get", "EmailsTransacionais/obter-metricas");

        await call("get", "EmailsTransacionais/listar-historico", {}, studentToken, 403);
      });

      await contextoTeste.test(
        "tokens de email, fila atômica, templates, worker e webhook idempotente",
        async () => {
          const identificadorEvento = randomUUID();

          await accounts.criarContaUsuario(
            identificadorEvento,
            identificadorEvento + "@example.test",
            hash,
            null,
            person,
            true,
          );

          const account = (await accounts.buscarContaPorIdentificador("id", identificadorEvento))!;

          const tokenEmailOriginal = gerarTokenAleatorioSeguro();

          const link =
            config.auth.clientUrl +
            "/autenticacao/confirmar-email#tipo=confirmacao&token=" +
            tokenEmailOriginal;

          const pending = runtime.emails.prepararMensagemEmail(
            identificadorEvento,
            identificadorEvento + "@example.test",
            "Nome <script>",
            "confirmacao",
            link,
          );

          assert.equal(
            await accounts.registrarTokenEmail(
              identificadorEvento,
              "confirmacao",
              calcularHashToken(tokenEmailOriginal),
              new Date(Date.now() + 60000),
              pending,
            ),
            true,
          );

          assert.equal(
            await accounts.registrarTokenEmail(
              identificadorEvento,
              "confirmacao",
              calcularHashToken(gerarTokenAleatorioSeguro()),
              new Date(Date.now() + 60000),
            ),
            false,
          );

          const reserved = await runtime.emails.reservarLoteEmails();

          assert.ok(reserved.length >= 1);

          const item = reserved.find(
            (erroCapturado) => erroCapturado.idEmailTransacional === pending.id,
          )!;

          assert.ok(item);

          assert.equal(await runtime.emails.podeEnviarEmail(item), true);

          assert.ok(runtime.emails.renderizarConteudoEmail(item).html.includes("&lt;script&gt;"));

          await runtime.emails.processarEmailReservado(item, logger, new AbortController().signal);

          assert.equal(providerCalls, 1);

          const body = JSON.stringify({
            type: "email.delivered",
            data: { email_id: "message-1" },
          });

          const timestamp = String(Math.floor(Date.now() / 1000));

          const webhook = "webhook-1";

          const signature =
            "v1," +
            createHmac("sha256", webhookSecret)
              .update(webhook + "." + timestamp + "." + body)
              .digest("base64");

          for (let indiceTentativa = 0; indiceTentativa < 2; indiceTentativa++) {
            const respostaHttp = await request(runtime.app)
              .post("/api/ResendWebhook/registrar-evento-entrega")
              .set("svix-id", webhook)
              .set("svix-timestamp", timestamp)
              .set("svix-signature", signature)
              .set("Content-Type", "application/json")
              .send(body);

            assert.equal(respostaHttp.status, 200);
          }

          assert.equal(
            (
              await clusterPostgreSql.admin.query(
                'select status from comunicacao.emails_transacionais where "idEmailTransacional"=$1',
                [pending.id],
              )
            ).rows[0].status,
            "entregue",
          );

          assert.equal(
            await accounts.consumirTokenEmail(
              calcularHashToken(tokenEmailOriginal),
              "confirmacao",
              null,
              true,
            ),
            true,
          );

          assert.equal(
            await accounts.consumirTokenEmail(
              calcularHashToken(tokenEmailOriginal),
              "confirmacao",
              null,
            ),
            false,
          );

          await runtime.emails.executarCicloWorker(logger, new AbortController().signal, true);

          assert.ok(providerCalls >= 2);

          const reset = gerarTokenAleatorioSeguro();

          assert.equal(
            await accounts.registrarTokenEmail(
              identificadorEvento,
              "recuperacao",
              calcularHashToken(reset),
              new Date(Date.now() + 60000),
            ),
            true,
          );

          assert.equal(
            await accounts.consumirTokenEmail(
              calcularHashToken(reset),
              "recuperacao",
              await gerarHashSenhaCompativel("NovaSenha-456"),
            ),
            true,
          );

          assert.equal(
            (
              await verificarSenhaHashPersistido(
                (await accounts.buscarContaPorIdentificador("id", identificadorEvento))!.senha_hash,
                "aspnet",
                "NovaSenha-456",
              )
            ).valid,
            true,
          );
        },
      );

      await contextoTeste.test(
        "cookies HttpOnly, renovação e proteção CSRF no navegador",
        async () => {
          const agent = request.agent(runtime.app);

          const headers = {
            Origin: "http://localhost:5173",
            "X-Concursa-Client": "web",
          };

          const login = await agent
            .post("/api/Navegador/entrar-estudante")
            .set(headers)
            .send({ email: otherId + "@example.test", senha: password });

          assert.equal(login.status, 200);

          assert.equal("accessToken" in login.body.data, false);

          assert.ok(String(login.headers["set-cookie"]).includes("HttpOnly"));

          assert.equal((await agent.get("/api/Usuario/obter-meu-usuario")).status, 200);

          assert.equal(
            (
              await agent
                .put("/api/PreferenciaComunicacao/atualizar-minha-preferencia")
                .send({ receberInatividade: false })
            ).status,
            403,
          );

          assert.equal(
            (await agent.post("/api/Navegador/renovar-sessao").set(headers).send({})).status,
            200,
          );

          assert.equal(
            (await agent.post("/api/Navegador/sair-sessao").set(headers).send({})).status,
            200,
          );

          assert.equal((await agent.get("/api/Usuario/obter-meu-usuario")).status, 401);
        },
      );

      await contextoTeste.test(
        "falha permanente Resend e reprocessamento seguro sem duplicação",
        async () => {
          const identificadorUsuario = randomUUID();

          await clusterPostgreSql.admin.query(
            `insert into comunicacao.emails_transacionais("idEmailTransacional",tipo_evento,"idUsuario",email_destinatario,assunto,dados_template,maximo_tentativas,chave_idempotencia,agendado_em) values($1,'WELCOME_EMAIL',$2,'failure@example.test','Teste','{}',5,$3,now())`,
            [identificadorUsuario, otherId, "WELCOME_EMAIL/" + identificadorUsuario],
          );

          const item = (await runtime.emails.reservarLoteEmails()).find(
            (erroCapturado) => erroCapturado.idEmailTransacional === identificadorUsuario,
          )!;

          assert.ok(item);

          providerMode = "fail";

          await runtime.emails.processarEmailReservado(item, logger, new AbortController().signal);

          providerMode = "ok";

          const failed = (
            await clusterPostgreSql.admin.query(
              'select status,mensagem_erro from comunicacao.emails_transacionais where "idEmailTransacional"=$1',
              [identificadorUsuario],
            )
          ).rows[0];

          assert.equal(failed.status, "falha");

          assert.equal(failed.mensagem_erro, "resend_http_422");

          assert.equal(await runtime.emails.reprocessarEmailComFalha(identificadorUsuario), true);

          assert.equal(await runtime.emails.reprocessarEmailComFalha(identificadorUsuario), false);

          await runtime.emails.executarCicloWorker(logger, new AbortController().signal, false);

          assert.equal(
            (
              await clusterPostgreSql.admin.query(
                'select status from comunicacao.emails_transacionais where "idEmailTransacional"=$1',
                [identificadorUsuario],
              )
            ).rows[0].status,
            "aceito",
          );
        },
      );

      await contextoTeste.test(
        "cadastro, confirmação, login e recuperação por HTTP com persistência real",
        async () => {
          const aplicacaoExpress = criarAplicacaoHttpExpress({
            config,
            database: runtime.db,
            fetch: http,
          }).app;

          const email = "cadastro-" + randomUUID() + "@example.test";

          const data = {
            email,
            senha: "SenhaCadastro-123",
            pessoa: {
              nomeCompleto: "Pessoa Cadastro",
              dataNascimento: "1995-01-02",
              cpf: "52998224725",
              cep: "01001000",
              logradouro: "Rua",
              numero: "1",
              complemento: null,
              bairro: "Centro",
              cidade: "São Paulo",
              uf: "SP",
            },
          };

          const registered = await request(aplicacaoExpress)
            .post("/api/Autenticacao/cadastrar-estudante")
            .send(data);

          assert.equal(registered.status, 200);

          const identificadorUsuario = registered.body.data.idUsuario;

          assert.equal(registered.body.data.confirmacaoEmailNecessaria, true);

          const pending = (
            await clusterPostgreSql.admin.query(
              `select link_protegido from comunicacao.emails_transacionais where "idUsuario"=$1 and tipo_evento='EMAIL_VERIFICATION'`,
              [identificadorUsuario],
            )
          ).rows[0];

          const confirmation = new URLSearchParams(
            new URL(
              descriptografarConteudoAutenticado(pending.link_protegido, chaveAssinaturaJwt),
            ).hash.slice(1),
          ).get("token");

          assert.equal(
            (
              await request(aplicacaoExpress)
                .post("/api/Autenticacao/confirmar-email")
                .send({ token: confirmation })
            ).status,
            200,
          );

          const login = await request(aplicacaoExpress)
            .post("/api/Autenticacao/entrar-estudante")
            .send({ email, senha: data.senha });

          assert.equal(login.status, 200);

          assert.equal(
            (
              await request(aplicacaoExpress)
                .post("/api/Autenticacao/solicitar-recuperacao-senha")
                .send({ email })
            ).status,
            200,
          );

          const recovery = (
            await clusterPostgreSql.admin.query(
              `select link_protegido from comunicacao.emails_transacionais where "idUsuario"=$1 and tipo_evento='PASSWORD_RESET'`,
              [identificadorUsuario],
            )
          ).rows[0];

          const reset = new URLSearchParams(
            new URL(
              descriptografarConteudoAutenticado(recovery.link_protegido, chaveAssinaturaJwt),
            ).hash.slice(1),
          ).get("token");

          assert.equal(
            (
              await request(aplicacaoExpress)
                .post("/api/Autenticacao/redefinir-senha")
                .send({ token: reset, senha: "SenhaAlterada-456" })
            ).status,
            200,
          );

          assert.equal(
            (
              await request(aplicacaoExpress)
                .get("/api/Usuario/obter-meu-usuario")
                .set("Authorization", "Bearer " + login.body.data.accessToken)
            ).status,
            401,
          );

          assert.equal(
            (
              await request(aplicacaoExpress)
                .post("/api/Autenticacao/entrar-estudante")
                .send({ email, senha: "SenhaAlterada-456" })
            ).status,
            200,
          );
        },
      );

      await contextoTeste.test(
        "identidade Google vinculada por sujeito não pode mudar de proprietário",
        async () => {
          const subject = "google-test-" + randomUUID();

          await accounts.vincularIdentidadeGoogle(otherId, subject, "google@example.test");

          assert.equal(
            (await accounts.buscarContaPorIdentificador("google", subject))!.idUsuario,
            otherId,
          );

          assert.equal(await accounts.possuiVinculoGoogle(otherId), true);

          await assert.rejects(
            accounts.vincularIdentidadeGoogle(studentId, subject, "google@example.test"),
          );
        },
      );

      await contextoTeste.test(
        "inatividade opt-in, seleção idempotente e cancelamento por preferência",
        async () => {
          await runtime.emails.atualizarFluxoEmail("USER_INACTIVE", true);

          await runtime.emails.atualizarPreferenciaEmail(otherId, true);

          await clusterPostgreSql.admin.query(
            `update public.usuarios set ultimo_acesso_em=now()-interval '31 days' where "idUsuario"=$1`,
            [otherId],
          );

          const params = { dias: [7, 15, 30], maximo: 5, limite: 100 };

          await runtime.emails.executarConsultaEmail("enfileirarEmailsUsuariosInativos", params);

          await runtime.emails.executarConsultaEmail("enfileirarEmailsUsuariosInativos", params);

          const rows = (
            await clusterPostgreSql.admin.query(
              `select "idEmailTransacional" from comunicacao.emails_transacionais where "idUsuario"=$1 and tipo_evento='USER_INACTIVE'`,
              [otherId],
            )
          ).rows;

          assert.equal(rows.length, 1);

          await runtime.emails.atualizarPreferenciaEmail(otherId, false);

          assert.equal(
            (
              await clusterPostgreSql.admin.query(
                'select status from comunicacao.emails_transacionais where "idEmailTransacional"=$1',
                [rows[0].idEmailTransacional],
              )
            ).rows[0].status,
            "cancelado",
          );

          await runtime.emails.atualizarFluxoEmail("USER_INACTIVE", false);
        },
      );

      await contextoTeste.test(
        "Honra: conclusão elegível, repetição sem bônus e sequência de sete dias",
        async () => {
          const tema = (await call("get", "Prova/listar-temas", {}, studentToken)).data.itens[0]
            .idTema;
          const novasQuestoes: { idQuestao: string; idAlternativaCorreta: string }[] = [];
          const provaHonra = await call("post", "Prova/criar-prova", {
            ano: 2026,
            orgao: "Órgão Honra",
            idOrganizadora: bankId,
            cargo: "Dentista",
            composicaoConfirmada: false,
          });
          const identificadorProvaHonra = provaHonra.data.idProva;

          for (let numeroQuestao = 2; numeroQuestao <= 6; numeroQuestao++) {
            const identificadorAlternativaCorreta = randomUUID();
            const identificadorAlternativaIncorreta = randomUUID();
            const questaoCriada = await call("post", "Questao/criar-questao", {
              idProva: identificadorProvaHonra,
              idTema: tema,
              numero: numeroQuestao,
              enunciado: `Questão inédita de Honra ${numeroQuestao}?`,
              explicacao: "A primeira alternativa está correta.",
              status: "publicada",
              statusGabarito: "definitivo",
              idAlternativaCorreta: identificadorAlternativaCorreta,
              alternativas: [
                { idAlternativa: identificadorAlternativaCorreta, letra: "A", texto: "Correta" },
                {
                  idAlternativa: identificadorAlternativaIncorreta,
                  letra: "B",
                  texto: "Incorreta",
                },
              ],
            });

            novasQuestoes.push({
              idQuestao: questaoCriada.data.idQuestao,
              idAlternativaCorreta: identificadorAlternativaCorreta,
            });
          }

          const simuladoElegivel = await call("post", "Simulado/criar-simulado", {
            nome: "Simulado elegível para Honra",
            idsQuestoes: novasQuestoes.map((questao) => questao.idQuestao),
            publico: true,
            status: "publicado",
            tipo: "padrao",
          });

          const tentativaElegivel = await call(
            "post",
            "Tentativa/iniciar-tentativa-simulado",
            { idSimulado: simuladoElegivel.data.idSimulado },
            studentToken,
          );

          for (const questao of novasQuestoes) {
            const resposta = {
              idTentativa: tentativaElegivel.data.idTentativa,
              idQuestao: questao.idQuestao,
              idAlternativaSelecionada: questao.idAlternativaCorreta,
            };

            await Promise.all([
              call("put", "Tentativa/responder-questao-simulado", resposta, studentToken),
              call("put", "Tentativa/responder-questao-simulado", resposta, studentToken),
            ]);
          }

          await call(
            "post",
            "Tentativa/finalizar-tentativa-simulado",
            { idTentativa: tentativaElegivel.data.idTentativa },
            studentToken,
          );

          const progressoAposConclusao = await call(
            "get",
            "honra/estudante/meu-progresso",
            {},
            studentToken,
          );

          assert.equal(progressoAposConclusao.data.pontosAcumulados, 57);
          assert.equal(progressoAposConclusao.data.questoesIneditasPontuadas, 6);

          const tentativaRepetida = await call(
            "post",
            "Tentativa/iniciar-tentativa-simulado",
            { idSimulado: simuladoElegivel.data.idSimulado },
            studentToken,
          );

          for (const questao of novasQuestoes) {
            await call(
              "put",
              "Tentativa/responder-questao-simulado",
              {
                idTentativa: tentativaRepetida.data.idTentativa,
                idQuestao: questao.idQuestao,
                idAlternativaSelecionada: questao.idAlternativaCorreta,
              },
              studentToken,
            );
          }

          await call(
            "post",
            "Tentativa/finalizar-tentativa-simulado",
            { idTentativa: tentativaRepetida.data.idTentativa },
            studentToken,
          );

          assert.equal(
            (await call("get", "honra/estudante/meu-progresso", {}, studentToken)).data
              .pontosAcumulados,
            57,
          );

          for (let diasAtras = 6; diasAtras >= 1; diasAtras--) {
            await clusterPostgreSql.admin.query(
              `insert into public.honra_dias_estudo(id_pessoa, dia, dias_consecutivos)
              values($1, (now() at time zone 'America/Sao_Paulo')::date - $2::integer, $3)`,
              [otherId, diasAtras, 7 - diasAtras],
            );
          }

          await clusterPostgreSql.admin.query(
            `delete from public.honra_dias_estudo where id_pessoa=$1
              and dia=(now() at time zone 'America/Sao_Paulo')::date`,
            [otherId],
          );

          const pontosAntesSequencia = (
            await call("get", "honra/estudante/meu-progresso", {}, otherToken)
          ).data.pontosAcumulados;

          const bonusDiarioConcedidoAnteriormente =
            Number(
              (
                await clusterPostgreSql.admin.query<{ total: string }>(
                  `select count(*)::text as total from public.honra_movimentacoes
                  where id_pessoa=$1 and codigo_regra='primeiro_estudo_diario'
                    and criado_em::date=current_date`,
                  [otherId],
                )
              ).rows[0]?.total ?? "0",
            ) > 0;

          const tentativaSequencia = await call(
            "post",
            "Tentativa/iniciar-tentativa-simulado",
            { idSimulado: simuladoElegivel.data.idSimulado },
            otherToken,
          );

          await call(
            "put",
            "Tentativa/responder-questao-simulado",
            {
              idTentativa: tentativaSequencia.data.idTentativa,
              idQuestao: novasQuestoes[0]!.idQuestao,
              idAlternativaSelecionada: novasQuestoes[0]!.idAlternativaCorreta,
            },
            otherToken,
          );

          const progressoSequencia = await call(
            "get",
            "honra/estudante/meu-progresso",
            {},
            otherToken,
          );

          assert.equal(progressoSequencia.data.diasConsecutivos, 7);
          assert.equal(
            progressoSequencia.data.pontosAcumulados - pontosAntesSequencia,
            bonusDiarioConcedidoAnteriormente ? 55 : 65,
          );

          await call("put", "Prova/atualizar-prova", {
            idProva: identificadorProvaHonra,
            ano: 2026,
            orgao: "Órgão Honra",
            idOrganizadora: bankId,
            cargo: "Dentista",
            composicaoConfirmada: true,
          });

          const pontosAntesProva = progressoSequencia.data.pontosAcumulados;

          const tentativaProva = await call(
            "post",
            "Prova/iniciar-prova",
            { idProva: identificadorProvaHonra },
            otherToken,
          );

          for (const questao of novasQuestoes.slice(1)) {
            await call(
              "put",
              "Tentativa/responder-questao-simulado",
              {
                idTentativa: tentativaProva.data.idTentativa,
                idQuestao: questao.idQuestao,
                idAlternativaSelecionada: questao.idAlternativaCorreta,
              },
              otherToken,
            );
          }

          await call(
            "post",
            "Tentativa/finalizar-tentativa-simulado",
            {
              idTentativa: tentativaProva.data.idTentativa,
            },
            otherToken,
          );

          assert.equal(
            (await call("get", "honra/estudante/meu-progresso", {}, otherToken)).data
              .pontosAcumulados - pontosAntesProva,
            40,
          );
        },
      );

      await contextoTeste.test(
        "refresh rotaciona, reutilização revoga família e JWT deixa de autenticar",
        async () => {
          const refreshed = await call("post", "Autenticacao/renovar-sessao", {
            refreshToken: studentRefresh,
          });

          assert.ok(refreshed.data.accessToken);

          await call(
            "post",
            "Autenticacao/renovar-sessao",
            { refreshToken: studentRefresh },
            adminToken,
            401,
          );

          await call("get", "Usuario/obter-meu-usuario", {}, refreshed.data.accessToken, 401);
        },
      );

      await contextoTeste.test(
        "schema e privilégios reais disponíveis sem migrations no runtime",
        async () => {
          assert.equal(
            (
              await clusterPostgreSql.admin.query(
                "select rolbypassrls from pg_roles where rolname='concursa_backend'",
              )
            ).rows[0].rolbypassrls,
            false,
          );

          assert.equal(
            (
              await clusterPostgreSql.admin.query(
                "select has_table_privilege('anon','public.questoes','select') as allowed",
              )
            ).rows[0].allowed,
            false,
          );
        },
      );
    } finally {
      await runtime.db.encerrarPoolConexoes();

      await clusterPostgreSql.stop();
    }
  },
);
