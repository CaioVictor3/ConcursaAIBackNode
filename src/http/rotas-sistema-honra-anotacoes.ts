import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import type { ServicoAutenticacaoContasSessoes } from "../application/autenticacao-contas-sessoes.service.js";
import { ServicoSistemaHonraEstudantesAdministracao } from "../application/sistema-honra-estudantes-administracao.service.js";
import {
  criarRespostaSucesso,
  ErroRegraNegocioHttp,
} from "../domain/erros-validacoes-respostas-api.js";
import type { ConexaoTransacoesPostgreSql } from "../infrastructure/conexao-transacoes-postgresql.js";
import type { GerenciadorCookiesSessaoNavegador } from "./cookies-sessao-navegador.js";
import { autenticarUsuarioRequisicaoHttp } from "./autenticacao-requisicao-http.js";

const expressaoIdentificadorUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function lerObjetoRequisicao(valor: unknown): Record<string, unknown> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    throw new ErroRegraNegocioHttp("Envie um objeto JSON válido.");
  }

  return valor as Record<string, unknown>;
}

function lerTextoObrigatorio(valor: unknown, nomeCampo: string, tamanhoMaximo: number): string {
  if (typeof valor !== "string" || !valor.trim() || valor.length > tamanhoMaximo) {
    throw new ErroRegraNegocioHttp(`Informe ${nomeCampo} válido.`);
  }

  return valor.trim();
}

function lerTextoOpcional(valor: unknown, nomeCampo: string, tamanhoMaximo: number): string {
  if (valor === undefined || valor === null) {
    return "";
  }

  if (typeof valor !== "string" || valor.length > tamanhoMaximo) {
    throw new ErroRegraNegocioHttp(`Informe ${nomeCampo} válido.`);
  }

  return valor.trim();
}

function lerInteiro(valor: unknown, nomeCampo: string, minimo: number, maximo: number): number {
  const numero = typeof valor === "string" && valor.trim() ? Number(valor) : valor;

  if (
    typeof numero !== "number" ||
    !Number.isInteger(numero) ||
    numero < minimo ||
    numero > maximo
  ) {
    throw new ErroRegraNegocioHttp(`Informe ${nomeCampo} válido.`);
  }

  return numero;
}

function lerBooleano(valor: unknown, nomeCampo: string): boolean {
  if (typeof valor !== "boolean") {
    throw new ErroRegraNegocioHttp(`Informe ${nomeCampo} válido.`);
  }

  return valor;
}

function lerIdentificadorUuid(valor: unknown, nomeCampo: string): string {
  const identificador = lerTextoObrigatorio(valor, nomeCampo, 36);

  if (!expressaoIdentificadorUuid.test(identificador)) {
    throw new ErroRegraNegocioHttp(`Informe ${nomeCampo} válido.`);
  }

  return identificador;
}

function lerParametroRota(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

export function criarRotasSistemaHonraAnotacoes(
  conexaoPostgreSql: ConexaoTransacoesPostgreSql,
  servicoAutenticacao: ServicoAutenticacaoContasSessoes,
  gerenciadorCookiesNavegador: GerenciadorCookiesSessaoNavegador,
) {
  const rotas = Router();

  rotas.use(
    rateLimit({
      windowMs: 60_000,
      limit: 90,
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

    return new ServicoSistemaHonraEstudantesAdministracao(conexaoPostgreSql, usuario);
  }

  rotas.get("/api/honra/estudante/meu-progresso", async (requisicao, resposta) => {
    const servico = await obterServicoAutenticado(requisicao);
    resposta.json(
      criarRespostaSucesso(
        await servico.consultarProgressoEstudante(),
        "Progresso de Honra consultado.",
      ),
    );
  });

  rotas.get("/api/estudo/estudante/painel-desempenho", async (requisicao, resposta) => {
    const servico = await obterServicoAutenticado(requisicao);
    resposta.json(
      criarRespostaSucesso(
        await servico.consultarPainelDesempenhoEstudante(),
        "Painel de desempenho consultado.",
      ),
    );
  });

  rotas.get("/api/honra/estudante/historico-pontos", async (requisicao, resposta) => {
    const servico = await obterServicoAutenticado(requisicao);
    const pagina = lerInteiro(requisicao.query.pagina ?? 1, "página", 1, 100_000);
    const quantidadePorPagina = lerInteiro(
      requisicao.query.quantidadePorPagina ?? 20,
      "quantidade por página",
      1,
      50,
    );

    resposta.json(
      criarRespostaSucesso(
        await servico.consultarHistoricoEstudante(pagina, quantidadePorPagina),
        "Histórico de Pontos de Honra consultado.",
      ),
    );
  });

  rotas.get("/api/honra/administracao/painel-sistema-honra", async (requisicao, resposta) => {
    const servico = await obterServicoAutenticado(requisicao);
    resposta.json(
      criarRespostaSucesso(
        await servico.consultarPainelAdministrativo(),
        "Painel de Honra consultado.",
      ),
    );
  });

  rotas.get(
    "/api/honra/administracao/estudantes/:idPessoa/historico-pontos",
    async (requisicao, resposta) => {
      const servico = await obterServicoAutenticado(requisicao);
      const identificadorPessoa = lerIdentificadorUuid(
        lerParametroRota(requisicao.params.idPessoa),
        "identificador do estudante",
      );
      const pagina = lerInteiro(requisicao.query.pagina ?? 1, "página", 1, 100_000);
      const quantidadePorPagina = lerInteiro(
        requisicao.query.quantidadePorPagina ?? 20,
        "quantidade por página",
        1,
        50,
      );

      resposta.json(
        criarRespostaSucesso(
          await servico.consultarHistoricoAdministrativo(
            identificadorPessoa,
            pagina,
            quantidadePorPagina,
          ),
          "Histórico do estudante consultado.",
        ),
      );
    },
  );

  rotas.post("/api/honra/administracao/titulos-honra", async (requisicao, resposta) => {
    const servico = await obterServicoAutenticado(requisicao);
    const dados = lerObjetoRequisicao(requisicao.body);
    const identificador =
      dados.id === undefined
        ? undefined
        : lerIdentificadorUuid(dados.id, "identificador do título");

    const titulo = {
      ...(identificador ? { id: identificador } : {}),
      nivel: lerInteiro(dados.nivel, "nível", 1, 1000),
      nome: lerTextoObrigatorio(dados.nome, "nome do título", 100),
      descricao: lerTextoOpcional(dados.descricao, "descrição do título", 1000),
      pontuacaoMinima: lerInteiro(dados.pontuacaoMinima, "pontuação mínima", 0, 10_000_000),
      icone: lerTextoObrigatorio(dados.icone, "ícone do título", 50),
      cor: lerTextoObrigatorio(dados.cor, "cor do título", 7),
      ativo: lerBooleano(dados.ativo, "status do título"),
    };

    const id = await servico.salvarTitulo(titulo);
    resposta.json(criarRespostaSucesso({ id }, "Título de Honra salvo."));
  });

  rotas.put(
    "/api/honra/administracao/regras-pontuacao/:codigoRegra",
    async (requisicao, resposta) => {
      const servico = await obterServicoAutenticado(requisicao);
      const dados = lerObjetoRequisicao(requisicao.body);
      const codigo = lerTextoObrigatorio(
        lerParametroRota(requisicao.params.codigoRegra),
        "código da regra",
        100,
      );

      await servico.salvarRegra(codigo, {
        pontos: lerInteiro(dados.pontos, "pontos", 0, 10_000),
        minimoQuestoes: lerInteiro(dados.minimoQuestoes, "mínimo de questões", 0, 100_000),
        minimoQuestoesIneditas: lerInteiro(
          dados.minimoQuestoesIneditas,
          "mínimo de questões inéditas",
          0,
          100_000,
        ),
        percentualMinimoRespostas: lerInteiro(
          dados.percentualMinimoRespostas,
          "percentual mínimo de respostas",
          0,
          100,
        ),
        limiteDiario: lerInteiro(dados.limiteDiario, "limite diário", 0, 1000),
        ativo: lerBooleano(dados.ativo, "status da regra"),
      });

      resposta.json(criarRespostaSucesso({ codigo }, "Regra de pontuação salva."));
    },
  );

  rotas.post(
    "/api/honra/administracao/estudantes/:idPessoa/ajustes-pontos",
    async (requisicao, resposta) => {
      const servico = await obterServicoAutenticado(requisicao);
      const dados = lerObjetoRequisicao(requisicao.body);
      const identificadorPessoa = lerIdentificadorUuid(
        lerParametroRota(requisicao.params.idPessoa),
        "identificador do estudante",
      );
      const pontos = lerInteiro(dados.pontos, "pontos do ajuste", -10_000, 10_000);
      const justificativa = lerTextoObrigatorio(dados.justificativa, "justificativa", 1000);

      await servico.ajustarPontos(identificadorPessoa, pontos, justificativa);
      resposta.json(
        criarRespostaSucesso({ ajustado: true }, "Ajuste de Pontos de Honra registrado."),
      );
    },
  );

  rotas.get("/api/estudo/questoes/:idQuestao/anotacao-pessoal", async (requisicao, resposta) => {
    const servico = await obterServicoAutenticado(requisicao);
    const identificadorQuestao = lerIdentificadorUuid(
      lerParametroRota(requisicao.params.idQuestao),
      "identificador da questão",
    );
    resposta.json(
      criarRespostaSucesso(
        await servico.consultarAnotacaoQuestao(identificadorQuestao),
        "Anotação consultada.",
      ),
    );
  });

  rotas.put("/api/estudo/questoes/:idQuestao/anotacao-pessoal", async (requisicao, resposta) => {
    const servico = await obterServicoAutenticado(requisicao);
    const identificadorQuestao = lerIdentificadorUuid(
      lerParametroRota(requisicao.params.idQuestao),
      "identificador da questão",
    );
    const dados = lerObjetoRequisicao(requisicao.body);
    const conteudo = lerTextoOpcional(dados.conteudo, "conteúdo da anotação", 10_000);

    resposta.json(
      criarRespostaSucesso(
        await servico.salvarAnotacaoQuestao(identificadorQuestao, conteudo),
        conteudo ? "Anotação salva." : "Anotação excluída.",
      ),
    );
  });

  return rotas;
}
