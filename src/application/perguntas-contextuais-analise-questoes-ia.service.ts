import type { PoolClient } from "pg";
import { ErroRegraNegocioHttp } from "../domain/erros-validacoes-respostas-api.js";
import type {
  ConexaoTransacoesPostgreSql,
  IdentidadeUsuarioAutenticado,
} from "../infrastructure/conexao-transacoes-postgresql.js";
import { ClienteAnaliseQuestoesOpenAI } from "../infrastructure/cliente-analise-questoes-openai.js";
import { RepositorioConsultasNegocioPostgreSql } from "../infrastructure/repositorio-consultas-postgresql.js";
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
    private readonly conexaoPostgreSql: ConexaoTransacoesPostgreSql,
    private readonly usuarioAutenticado: IdentidadeUsuarioAutenticado,
    private readonly clienteOpenAI: ClienteAnaliseQuestoesOpenAI,
  ) {
    this.autorizacao = new ServicoAutorizacaoUsuarioAutenticado(
      new RepositorioConsultasNegocioPostgreSql(conexaoPostgreSql, usuarioAutenticado),
    );
  }

  private executarComoUsuario<T>(operacao: (cliente: PoolClient) => Promise<T>): Promise<T> {
    return this.conexaoPostgreSql.executarComoUsuarioAutenticado(this.usuarioAutenticado, operacao);
  }

  async consultarHistorico(
    identificadorTentativa: string,
    identificadorQuestao: string,
  ): Promise<InteracaoContextualQuestaoIA[]> {
    await this.autorizacao.exigirEstudanteComCadastroCompleto();

    return this.executarComoUsuario(async (cliente) => {
      const resultadoConsulta = await cliente.query<{ historico: InteracaoContextualQuestaoIA[] }>(
        `select public.consultar_historico_perguntas_contextuais_ia($1::uuid, $2::uuid) as historico`,
        [identificadorTentativa, identificadorQuestao],
      );

      return resultadoConsulta.rows[0]?.historico ?? [];
    });
  }

  async responderPergunta(
    identificadorTentativa: string,
    identificadorQuestao: string,
    pergunta: string,
  ): Promise<InteracaoContextualQuestaoIA> {
    await this.autorizacao.exigirEstudanteComCadastroCompleto();
    this.clienteOpenAI.exigirConfiguracaoOpenAI();

    const reserva = await this.executarComoUsuario(async (cliente) => {
      const resultadoReserva = await cliente.query<{ reserva: ReservaPerguntaContextual }>(
        `select public.reservar_pergunta_contextual_ia($1::uuid, $2::uuid, $3) as reserva`,
        [identificadorTentativa, identificadorQuestao, pergunta],
      );

      return resultadoReserva.rows[0]!.reserva;
    });

    const salvarResultado = (
      falhou: boolean,
      resposta: string | null,
      usoTokens: { tokensEntrada: number; tokensSaida: number; tokensEntradaCache: number } | null,
    ) =>
      this.executarComoUsuario(async (cliente) => {
        const resultadoSalvamento = await cliente.query<{ salvou: boolean }>(
          `select public.salvar_pergunta_contextual_ia(
            $1::uuid, $2, $3, $4::boolean, $5::integer, $6::integer,
            $7::integer, $8::numeric
          ) as salvou`,
          [
            reserva.idSolicitacao,
            resposta,
            this.clienteOpenAI.config.openai.model,
            falhou,
            usoTokens?.tokensEntrada ?? null,
            usoTokens?.tokensSaida ?? null,
            usoTokens?.tokensEntradaCache ?? null,
            this.clienteOpenAI.calcularCustoEstimadoUsd(usoTokens),
          ],
        );

        return resultadoSalvamento.rows[0]?.salvou ?? false;
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
