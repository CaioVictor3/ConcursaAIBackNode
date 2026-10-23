import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import type { ServicoAutenticacaoContasSessoes } from "../application/autenticacao-contas-sessoes.service.js";
import { ServicoPerguntasContextuaisAnaliseQuestoesIA } from "../application/perguntas-contextuais-analise-questoes-ia.service.js";
import {
  criarRespostaSucesso,
  ErroRegraNegocioHttp,
} from "../domain/erros-validacoes-respostas-api.js";
import type { ClienteAnaliseQuestoesOpenAI } from "../infrastructure/cliente-analise-questoes-openai.js";
import type { ConexaoTransacoesPostgreSql } from "../infrastructure/conexao-transacoes-postgresql.js";
import { autenticarUsuarioRequisicaoHttp } from "./autenticacao-requisicao-http.js";
import type { GerenciadorCookiesSessaoNavegador } from "./cookies-sessao-navegador.js";

const padraoIdentificadorUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function exigirIdentificadorUuid(valor: unknown, nomeCampo: string): string {
  if (typeof valor !== "string" || !padraoIdentificadorUuid.test(valor)) {
    throw new ErroRegraNegocioHttp(`Informe ${nomeCampo} válido.`);
  }

  return valor;
}

export function criarRotasPerguntasContextuaisAnaliseIA(
  conexaoPostgreSql: ConexaoTransacoesPostgreSql,
  servicoAutenticacao: ServicoAutenticacaoContasSessoes,
  gerenciadorCookiesNavegador: GerenciadorCookiesSessaoNavegador,
  clienteOpenAI: ClienteAnaliseQuestoesOpenAI,
) {
  const rotas = Router();

  rotas.use(
    rateLimit({
      windowMs: 60_000,
      limit: 30,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );

  async function obterServicoAutenticado(requisicao: Request) {
    const usuario = await autenticarUsuarioRequisicaoHttp(
      requisicao,
      servicoAutenticacao,
      gerenciadorCookiesNavegador,
    );

    return new ServicoPerguntasContextuaisAnaliseQuestoesIA(
      conexaoPostgreSql,
      usuario,
      clienteOpenAI,
    );
  }

  rotas.get(
    "/api/ia/estudante/questoes/:idQuestao/historico-perguntas",
    async (requisicao, resposta) => {
      const identificadorQuestao = exigirIdentificadorUuid(
        requisicao.params.idQuestao,
        "a questão",
      );
      const identificadorTentativa = exigirIdentificadorUuid(
        requisicao.query.idTentativa,
        "a tentativa",
      );
      const servico = await obterServicoAutenticado(requisicao);

      resposta.json(
        criarRespostaSucesso(
          await servico.consultarHistorico(identificadorTentativa, identificadorQuestao),
          "Histórico de perguntas consultado.",
        ),
      );
    },
  );

  rotas.post(
    "/api/ia/estudante/questoes/:idQuestao/perguntas-contextuais",
    async (requisicao, resposta) => {
      const identificadorQuestao = exigirIdentificadorUuid(
        requisicao.params.idQuestao,
        "a questão",
      );

      if (
        !requisicao.body ||
        typeof requisicao.body !== "object" ||
        Array.isArray(requisicao.body)
      ) {
        throw new ErroRegraNegocioHttp("Envie a pergunta em um objeto JSON válido.");
      }

      const dadosRequisicao = requisicao.body as Record<string, unknown>;
      const identificadorTentativa = exigirIdentificadorUuid(
        dadosRequisicao.idTentativa,
        "a tentativa",
      );
      const pergunta = dadosRequisicao.pergunta;

      if (typeof pergunta !== "string" || pergunta.trim().length < 5 || pergunta.length > 1000) {
        throw new ErroRegraNegocioHttp("A pergunta deve ter entre 5 e 1000 caracteres.");
      }

      const servico = await obterServicoAutenticado(requisicao);

      resposta.json(
        criarRespostaSucesso(
          await servico.responderPergunta(
            identificadorTentativa,
            identificadorQuestao,
            pergunta.trim(),
          ),
          "Pergunta respondida e salva.",
        ),
      );
    },
  );

  return rotas;
}
