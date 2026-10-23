import type { PoolClient } from "pg";
import type {
  MovimentacaoHonra,
  PainelDesempenhoEstudante,
  PainelAdministrativoHonra,
  ProgressoHonraEstudante,
  RegraPontuacaoHonra,
  TituloHonra,
} from "../contracts/modelos/sistema-honra.js";
import { ErroRegraNegocioHttp } from "../domain/erros-validacoes-respostas-api.js";
import type {
  ConexaoTransacoesPostgreSql,
  IdentidadeUsuarioAutenticado,
} from "../infrastructure/conexao-transacoes-postgresql.js";
import { RepositorioConsultasNegocioPostgreSql } from "../infrastructure/repositorio-consultas-postgresql.js";
import { ServicoAutorizacaoUsuarioAutenticado } from "./autorizacao-usuario-autenticado.js";

const consultaTitulos = `
  select id, nivel, nome, descricao, pontuacao_minima as "pontuacaoMinima",
    icone, cor, ativo, criado_em as "criadoEm", atualizado_em as "atualizadoEm"
  from public.honra_titulos order by nivel
`;

const consultaRegras = `
  select codigo, descricao, pontos, minimo_questoes as "minimoQuestoes",
    minimo_questoes_ineditas as "minimoQuestoesIneditas",
    percentual_minimo_respostas as "percentualMinimoRespostas",
    limite_diario as "limiteDiario", ativo, atualizado_em as "atualizadoEm"
  from public.honra_regras order by codigo
`;

const consultaMovimentacoes = `
  select id::integer, id_pessoa as "idPessoa", codigo_regra as "codigoRegra",
    tipo_origem as "tipoOrigem", id_origem as "idOrigem", pontos, descricao,
    justificativa, criado_em as "criadoEm"
  from public.honra_movimentacoes
`;

export class ServicoSistemaHonraEstudantesAdministracao {
  private readonly autorizacao: ServicoAutorizacaoUsuarioAutenticado;

  constructor(
    private readonly conexaoPostgreSql: ConexaoTransacoesPostgreSql,
    private readonly usuario: IdentidadeUsuarioAutenticado,
  ) {
    this.autorizacao = new ServicoAutorizacaoUsuarioAutenticado(
      new RepositorioConsultasNegocioPostgreSql(conexaoPostgreSql, usuario),
    );
  }

  private executarComoUsuario<T>(operacao: (cliente: PoolClient) => Promise<T>): Promise<T> {
    return this.conexaoPostgreSql.executarComoUsuarioAutenticado(this.usuario, operacao);
  }

  async consultarProgressoEstudante(): Promise<ProgressoHonraEstudante> {
    const estudante = await this.autorizacao.exigirEstudanteComCadastroCompleto();

    return this.executarComoUsuario(async (cliente) => {
      const titulos = (await cliente.query<TituloHonra>(consultaTitulos)).rows.filter(
        (titulo) => titulo.ativo,
      );

      if (!titulos.length || titulos[0]?.pontuacaoMinima !== 0) {
        throw new ErroRegraNegocioHttp("Os Títulos de Honra ainda não foram configurados.", 503);
      }

      const indicadores = (
        await cliente.query<{
          pontosAcumulados: number;
          pontosSemana: number;
          pontosMes: number;
          diasConsecutivos: number;
          questoesIneditasPontuadas: number;
        }>(
          `select
            coalesce((select pontos_acumulados from public.honra_progresso where id_pessoa = $1), 0)::integer as "pontosAcumulados",
            coalesce((select sum(pontos) from public.honra_movimentacoes where id_pessoa = $1
              and criado_em >= date_trunc('week', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'), 0)::integer as "pontosSemana",
            coalesce((select sum(pontos) from public.honra_movimentacoes where id_pessoa = $1
              and criado_em >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'), 0)::integer as "pontosMes",
            coalesce((select dias_consecutivos from public.honra_dias_estudo where id_pessoa = $1
              and dia >= (now() at time zone 'America/Sao_Paulo')::date - 1
              order by dia desc limit 1), 0)::integer as "diasConsecutivos",
            (select count(*)::integer from public.honra_questoes_pontuadas where id_pessoa = $1) as "questoesIneditasPontuadas"`,
          [estudante.idPessoa],
        )
      ).rows[0]!;

      const tituloAtual =
        [...titulos]
          .reverse()
          .find((titulo) => titulo.pontuacaoMinima <= indicadores.pontosAcumulados) ?? titulos[0]!;

      const proximoTitulo = titulos.find((titulo) => titulo.nivel > tituloAtual.nivel) ?? null;

      const intervalo = proximoTitulo
        ? proximoTitulo.pontuacaoMinima - tituloAtual.pontuacaoMinima
        : 0;

      return {
        ...indicadores,
        tituloAtual,
        proximoTitulo,
        pontosParaProximoTitulo: proximoTitulo
          ? proximoTitulo.pontuacaoMinima - indicadores.pontosAcumulados
          : 0,
        percentualProgressoTitulo:
          intervalo > 0
            ? Math.max(
                0,
                Math.min(
                  100,
                  Math.round(
                    ((indicadores.pontosAcumulados - tituloAtual.pontuacaoMinima) / intervalo) *
                      100,
                  ),
                ),
              )
            : 100,
        titulos,
      };
    });
  }

  async consultarPainelDesempenhoEstudante(): Promise<PainelDesempenhoEstudante> {
    const estudante = await this.autorizacao.exigirEstudanteComCadastroCompleto();

    return this.executarComoUsuario(async (cliente) => {
      const indicadores = (
        await cliente.query<{
          totalRespostas: number;
          questoesUnicasResolvidas: number;
          acertosTentativas: number;
          errosTentativas: number;
          respostasEmBrancoTentativas: number;
          provasConcluidas: number;
          simuladosConcluidos: number;
          atividadesEmAndamento: number;
          tempoEstudoMinutos: number;
          pontosHonra: number;
        }>(
          `with tentativas as (
            select t."idTentativa", t.status, t.total_acertos, t.total_erros,
              t.total_nao_respondidas, t.tempo_gasto_segundos, s.tipo as tipo_simulado
            from public.tentativas_simulado t
            join public.simulados s on s."idSimulado" = t."idSimulado"
            where t."idPessoa" = $1
          ), respostas as (
            select r."idQuestao" from public.respostas_simulado r
            join tentativas t on t."idTentativa" = r."idTentativa"
            where r."idAlternativaSelecionada" is not null
          )
          select
            (select count(*)::integer from respostas) as "totalRespostas",
            (select count(distinct "idQuestao")::integer from respostas) as "questoesUnicasResolvidas",
            coalesce(sum(total_acertos) filter(where status = 'finalizada'), 0)::integer as "acertosTentativas",
            coalesce(sum(total_erros) filter(where status = 'finalizada'), 0)::integer as "errosTentativas",
            coalesce(sum(total_nao_respondidas) filter(where status = 'finalizada'), 0)::integer as "respostasEmBrancoTentativas",
            count(*) filter(where status = 'finalizada' and tipo_simulado = 'prova')::integer as "provasConcluidas",
            count(*) filter(where status = 'finalizada' and tipo_simulado <> 'prova')::integer as "simuladosConcluidos",
            count(*) filter(where status = 'em_andamento')::integer as "atividadesEmAndamento",
            coalesce(round(sum(tempo_gasto_segundos) filter(where status = 'finalizada') / 60.0), 0)::integer as "tempoEstudoMinutos",
            coalesce((select pontos_acumulados from public.honra_progresso where id_pessoa = $1), 0)::integer as "pontosHonra"
          from tentativas`,
          [estudante.idPessoa],
        )
      ).rows[0]!;

      const desempenhoPorTema = (
        await cliente.query<{
          idTema: string;
          nomeTema: string;
          avaliadas: number;
          acertos: number;
          erros: number;
          percentualAcertos: number;
        }>(
          `select te."idTema", te.nome as "nomeTema",
            count(*)::integer as avaliadas,
            count(*) filter(where (item->>'acertou')::boolean)::integer as acertos,
            count(*) filter(where not (item->>'acertou')::boolean and item->>'idAlternativaSelecionada' is not null)::integer as erros,
            round(100 * count(*) filter(where (item->>'acertou')::boolean) / nullif(count(*), 0))::integer as "percentualAcertos"
          from public.tentativas_simulado t
          cross join lateral jsonb_array_elements(public.obter_resultado_tentativa(t."idTentativa")->'itens') item
          join public.questoes q on q."idQuestao" = (item->>'idQuestao')::uuid
          join public.temas te on te."idTema" = q."idTema"
          where t."idPessoa" = $1 and t.status = 'finalizada'
            and not coalesce((item->>'anulada')::boolean, false)
            and not coalesce((item->>'semGabarito')::boolean, false)
          group by te."idTema", te.nome order by "percentualAcertos", avaliadas desc`,
          [estudante.idPessoa],
        )
      ).rows;

      const evolucaoDiaria = (
        await cliente.query<{
          dia: string;
          tentativasConcluidas: number;
          respostas: number;
          acertos: number;
          percentualAcertos: number;
        }>(
          `select (finalizada_em at time zone 'America/Sao_Paulo')::date::text as dia,
            count(*)::integer as "tentativasConcluidas",
            sum(total_acertos + total_erros)::integer as respostas,
            sum(total_acertos)::integer as acertos,
            round(100 * sum(total_acertos) / nullif(sum(total_acertos + total_erros), 0))::integer as "percentualAcertos"
          from public.tentativas_simulado
          where "idPessoa" = $1 and status = 'finalizada'
            and finalizada_em >= now() - interval '30 days'
          group by (finalizada_em at time zone 'America/Sao_Paulo')::date
          order by dia`,
          [estudante.idPessoa],
        )
      ).rows;

      const totalQuestoesRespondidas = indicadores.totalRespostas;
      const totalRespostasAvaliadas = indicadores.acertosTentativas + indicadores.errosTentativas;

      return {
        ...indicadores,
        questoesRevisadas: Math.max(
          0,
          totalQuestoesRespondidas - indicadores.questoesUnicasResolvidas,
        ),
        percentualAcertos: totalRespostasAvaliadas
          ? Math.round((indicadores.acertosTentativas / totalRespostasAvaliadas) * 100)
          : 0,
        desempenhoPorTema,
        evolucaoDiaria,
      };
    });
  }

  async consultarHistoricoEstudante(pagina: number, quantidadePorPagina: number) {
    const estudante = await this.autorizacao.exigirEstudanteComCadastroCompleto();

    return this.consultarHistoricoPessoa(estudante.idPessoa, pagina, quantidadePorPagina);
  }

  async consultarHistoricoAdministrativo(
    identificadorPessoa: string,
    pagina: number,
    quantidadePorPagina: number,
  ) {
    await this.autorizacao.exigirAdministradorAtivo();

    return this.consultarHistoricoPessoa(identificadorPessoa, pagina, quantidadePorPagina);
  }

  private async consultarHistoricoPessoa(
    identificadorPessoa: string,
    pagina: number,
    quantidadePorPagina: number,
  ) {
    if (pagina < 1 || quantidadePorPagina < 1 || quantidadePorPagina > 50) {
      throw new ErroRegraNegocioHttp("Paginação inválida.");
    }

    return this.executarComoUsuario(async (cliente) => {
      const [movimentacoes, contagem] = await Promise.all([
        cliente.query<MovimentacaoHonra>(
          `${consultaMovimentacoes} where id_pessoa = $1 order by criado_em desc, id desc limit $2 offset $3`,
          [identificadorPessoa, quantidadePorPagina, (pagina - 1) * quantidadePorPagina],
        ),
        cliente.query<{ total: number }>(
          `select count(*)::integer as total from public.honra_movimentacoes where id_pessoa = $1`,
          [identificadorPessoa],
        ),
      ]);

      return {
        itens: movimentacoes.rows,
        total: contagem.rows[0]!.total,
        pagina,
        quantidadePorPagina,
      };
    });
  }

  async consultarPainelAdministrativo(): Promise<PainelAdministrativoHonra> {
    await this.autorizacao.exigirAdministradorAtivo();

    return this.executarComoUsuario(async (cliente) => {
      const titulos = (await cliente.query<TituloHonra>(consultaTitulos)).rows;
      const regras = (await cliente.query<RegraPontuacaoHonra>(consultaRegras)).rows;
      const indicadores = (
        await cliente.query<{ participantes: number; pontos: number }>(
          `select count(*)::integer as participantes,
            coalesce(sum(pontos_acumulados), 0)::integer as pontos from public.honra_progresso`,
        )
      ).rows[0]!;

      const distribuicao = (
        await cliente.query<{ titulo: string; estudantes: number }>(
          `select coalesce(t.nome, 'Iniciante') as titulo, count(*)::integer as estudantes
          from public.honra_progresso p left join lateral (
            select nome from public.honra_titulos where ativo and pontuacao_minima <= p.pontos_acumulados
            order by pontuacao_minima desc limit 1
          ) t on true group by t.nome order by estudantes desc`,
        )
      ).rows;

      const atividades = (
        await cliente.query<{ atividade: string; pontos: number }>(
          `select tipo_origem as atividade, sum(pontos)::integer as pontos
          from public.honra_movimentacoes group by tipo_origem order by pontos desc`,
        )
      ).rows;

      const evolucaoParticipacao = (
        await cliente.query<{
          dia: string;
          estudantesAtivos: number;
          novosParticipantes: number;
        }>(
          `with dias as (
            select generate_series(
              (now() at time zone 'America/Sao_Paulo')::date - 29,
              (now() at time zone 'America/Sao_Paulo')::date,
              interval '1 day'
            )::date as dia
          ), participacao as (
            select id_pessoa,
              (criado_em at time zone 'America/Sao_Paulo')::date as dia
            from public.honra_movimentacoes
          ), primeira_participacao as (
            select id_pessoa, min(dia) as dia from participacao group by id_pessoa
          )
          select dias.dia::text as dia,
            count(distinct participacao.id_pessoa)::integer as "estudantesAtivos",
            count(distinct primeira_participacao.id_pessoa)::integer as "novosParticipantes"
          from dias
          left join participacao on participacao.dia = dias.dia
          left join primeira_participacao on primeira_participacao.dia = dias.dia
          group by dias.dia order by dias.dia`,
        )
      ).rows;

      const recentes = (
        await cliente.query<MovimentacaoHonra & { idPessoa: string }>(
          `${consultaMovimentacoes} order by criado_em desc, id desc limit 20`,
        )
      ).rows;

      return {
        titulos,
        regras,
        totalEstudantesParticipantes: indicadores.participantes,
        totalPontosConcedidos: indicadores.pontos,
        distribuicaoTitulos: distribuicao,
        pontosPorAtividade: atividades,
        evolucaoParticipacao,
        movimentacoesRecentes: recentes,
      };
    });
  }

  async salvarTitulo(dados: {
    id?: string;
    nivel: number;
    nome: string;
    descricao: string;
    pontuacaoMinima: number;
    icone: string;
    cor: string;
    ativo: boolean;
  }) {
    await this.autorizacao.exigirAdministradorAtivo();

    return this.executarComoUsuario(async (cliente) => {
      const resultado = await cliente.query<{ id: string }>(
        `select honra_privado.salvar_titulo($1::jsonb) as id`,
        [JSON.stringify(dados)],
      );

      return resultado.rows[0]!.id;
    });
  }

  async salvarRegra(
    codigo: string,
    dados: {
      pontos: number;
      minimoQuestoes: number;
      minimoQuestoesIneditas: number;
      percentualMinimoRespostas: number;
      limiteDiario: number;
      ativo: boolean;
    },
  ) {
    await this.autorizacao.exigirAdministradorAtivo();

    await this.executarComoUsuario(async (cliente) => {
      await cliente.query(`select honra_privado.salvar_regra($1, $2::jsonb)`, [
        codigo,
        JSON.stringify(dados),
      ]);
    });
  }

  async ajustarPontos(identificadorPessoa: string, pontos: number, justificativa: string) {
    await this.autorizacao.exigirAdministradorAtivo();

    await this.executarComoUsuario(async (cliente) => {
      await cliente.query(`select honra_privado.ajustar_saldo($1::uuid, $2::integer, $3)`, [
        identificadorPessoa,
        pontos,
        justificativa,
      ]);
    });
  }

  async consultarAnotacaoQuestao(identificadorQuestao: string) {
    const estudante = await this.autorizacao.exigirEstudanteComCadastroCompleto();

    return this.executarComoUsuario(async (cliente) => {
      const consulta = await cliente.query<{ conteudo: string; atualizadaEm: string }>(
        `select conteudo, atualizada_em as "atualizadaEm" from public.anotacoes_pessoais_questoes
          where id_pessoa = $1 and id_questao = $2`,
        [estudante.idPessoa, identificadorQuestao],
      );

      return consulta.rows[0] ?? { conteudo: "", atualizadaEm: null };
    });
  }

  async salvarAnotacaoQuestao(identificadorQuestao: string, conteudo: string) {
    await this.autorizacao.exigirEstudanteComCadastroCompleto();

    await this.executarComoUsuario(async (cliente) => {
      await cliente.query(`select honra_privado.salvar_anotacao($1::uuid, $2)`, [
        identificadorQuestao,
        conteudo,
      ]);
    });

    return this.consultarAnotacaoQuestao(identificadorQuestao);
  }
}
