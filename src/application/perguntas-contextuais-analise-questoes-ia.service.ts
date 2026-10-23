import { ErroRegraNegocioHttp } from "../domain/erros-validacoes-respostas-api.js";
import type {
  ConexaoTransacoesPostgreSql,
  IdentidadeUsuarioAutenticado,
} from "../infrastructure/conexao-transacoes-postgresql.js";
import { ClienteAnaliseQuestoesOpenAI } from "../infrastructure/cliente-analise-questoes-openai.js";
import { RepositorioConsultasNegocioPostgreSql } from "../infrastructure/repositorio-consultas-postgresql.js";
import type { RepositorioConsultasNegocio } from "../infrastructure/repositorio-consultas-postgresql.js";
import { ServicoAutorizacaoUsuarioAutenticado } from "./autorizacao-usuario-autenticado.js";

export interface InteracaoContextualQuestaoIA {
  idSolicitacao: string;
  pergunta: string;
  resposta: string;
  criadaEm: string;
}

interface ReservaPerguntaContextual {
  idSolicitacao: string;
  contexto: Record<string, unknown>;
  analise: Record<string, unknown>;
  historico: InteracaoContextualQuestaoIA[];
}

export class ServicoPerguntasContextuaisAnaliseQuestoesIA {
  private readonly autorizacao: ServicoAutorizacaoUsuarioAutenticado;

  constructor(
    conexaoPostgreSql: ConexaoTransacoesPostgreSql,
    usuarioAutenticado: IdentidadeUsuarioAutenticado,
    private readonly clienteOpenAI: ClienteAnaliseQuestoesOpenAI,
    repositorio?: RepositorioConsultasNegocio,
  ) {
    this.autorizacao = new ServicoAutorizacaoUsuarioAutenticado(
      repositorio ??
        new RepositorioConsultasNegocioPostgreSql(conexaoPostgreSql, usuarioAutenticado),
    );
  }

  async consultarHistorico(
    identificadorTentativa: string,
    identificadorQuestao: string,
  ): Promise<InteracaoContextualQuestaoIA[]> {
    await this.autorizacao.exigirEstudanteComCadastroCompleto();

    return this.autorizacao.repo.executarFuncaoPostgreSql<InteracaoContextualQuestaoIA[]>(
      "consultar_historico_perguntas_contextuais_ia",
      { p_idtentativa: identificadorTentativa, p_idquestao: identificadorQuestao },
    );
  }

  async responderPergunta(
    identificadorTentativa: string,
    identificadorQuestao: string,
    pergunta: string,
  ): Promise<InteracaoContextualQuestaoIA> {
    await this.autorizacao.exigirEstudanteComCadastroCompleto();
    this.clienteOpenAI.exigirConfiguracaoOpenAI();

    const reserva = await this.autorizacao.repo.executarFuncaoPostgreSql<ReservaPerguntaContextual>(
      "reservar_pergunta_contextual_ia",
      {
        p_idtentativa: identificadorTentativa,
        p_idquestao: identificadorQuestao,
        p_pergunta: pergunta,
      },
    );

    const salvarResultado = (
      falhou: boolean,
      resposta: string | null,
      usoTokens: { tokensEntrada: number; tokensSaida: number; tokensEntradaCache: number } | null,
    ) =>
      this.autorizacao.repo.executarFuncaoPostgreSql<boolean>("salvar_pergunta_contextual_ia", {
        p_id_solicitacao: reserva.idSolicitacao,
        p_resposta: resposta,
        p_modelo: this.clienteOpenAI.config.openai.model,
        p_falhou: falhou,
        p_tokens_entrada: usoTokens?.tokensEntrada ?? null,
        p_tokens_saida: usoTokens?.tokensSaida ?? null,
        p_tokens_entrada_cache: usoTokens?.tokensEntradaCache ?? null,
        p_custo_estimado_usd: this.clienteOpenAI.calcularCustoEstimadoUsd(usoTokens),
      });

    try {
      const respostaOpenAI = await this.clienteOpenAI.responderPerguntaContextual(
        reserva.contexto,
        reserva.analise,
        reserva.historico,
        pergunta,
      );

      if (!(await salvarResultado(false, respostaOpenAI.resposta, respostaOpenAI.usoTokens))) {
        throw new ErroRegraNegocioHttp("Não foi possível salvar a resposta contextual.", 409);
      }

      return {
        idSolicitacao: reserva.idSolicitacao,
        pergunta: pergunta.trim(),
        resposta: respostaOpenAI.resposta,
        criadaEm: new Date().toISOString(),
      };
    } catch (erroCapturado) {
      await salvarResultado(true, null, null).catch(() => undefined);
      throw erroCapturado;
    }
  }
}
