import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  TituloHonra,
  ProgressoHonraEstudante,
  PainelDesempenhoEstudante,
  PainelAdministrativoHonra,
  MovimentacaoHonra,
} from "../contracts/modelos/sistema-honra.js";
import { ErroRegraNegocioHttp } from "../domain/erros-validacoes-respostas-api.js";
import { RepositorioConsultasNegocioSupabase } from "../infrastructure/repositorio-consultas-supabase.js";
import { ServicoAutorizacaoUsuarioAutenticado } from "./autorizacao-usuario-autenticado.js";
import type { ServicoSistemaHonraEstudantesAdministracao } from "./sistema-honra-estudantes-administracao.service.js";

export class ServicoSistemaHonraSupabase {
  private readonly autorizacao: ServicoAutorizacaoUsuarioAutenticado;
  constructor(
    private readonly cliente: SupabaseClient,
    private readonly repo: RepositorioConsultasNegocioSupabase,
  ) {
    this.autorizacao = new ServicoAutorizacaoUsuarioAutenticado(repo);
  }
  private async rpc<T>(nome: string, dados: Record<string, unknown> = {}): Promise<T> {
    return this.repo.executarFuncaoPostgreSql<T>(nome, dados);
  }
  async consultarProgressoEstudante(): Promise<ProgressoHonraEstudante> {
    await this.autorizacao.exigirEstudanteComCadastroCompleto();
    const dados = await this.rpc<{
      titulos: TituloHonra[];
      indicadores: Pick<
        ProgressoHonraEstudante,
        | "pontosAcumulados"
        | "pontosSemana"
        | "pontosMes"
        | "diasConsecutivos"
        | "questoesIneditasPontuadas"
      >;
    }>("consultar_indicadores_honra");
    const titulos = dados.titulos.filter((x) => x.ativo);
    if (!titulos.length || titulos[0]?.pontuacaoMinima !== 0)
      throw new ErroRegraNegocioHttp("Os Títulos de Honra ainda não foram configurados.", 503);
    const tituloAtual =
      [...titulos].reverse().find((x) => x.pontuacaoMinima <= dados.indicadores.pontosAcumulados) ??
      titulos[0]!;
    const proximoTitulo = titulos.find((x) => x.nivel > tituloAtual.nivel) ?? null;
    const intervalo = proximoTitulo
      ? proximoTitulo.pontuacaoMinima - tituloAtual.pontuacaoMinima
      : 0;
    return {
      ...dados.indicadores,
      titulos,
      tituloAtual,
      proximoTitulo,
      pontosParaProximoTitulo: proximoTitulo
        ? proximoTitulo.pontuacaoMinima - dados.indicadores.pontosAcumulados
        : 0,
      percentualProgressoTitulo:
        intervalo > 0
          ? Math.max(
              0,
              Math.min(
                100,
                Math.round(
                  ((dados.indicadores.pontosAcumulados - tituloAtual.pontuacaoMinima) / intervalo) *
                    100,
                ),
              ),
            )
          : 100,
    };
  }
  async consultarPainelDesempenhoEstudante(): Promise<PainelDesempenhoEstudante> {
    await this.autorizacao.exigirEstudanteComCadastroCompleto();
    const dados = await this.rpc<{
      indicadores: Omit<
        PainelDesempenhoEstudante,
        "questoesRevisadas" | "percentualAcertos" | "desempenhoPorTema" | "evolucaoDiaria"
      >;
      desempenhoPorTema: PainelDesempenhoEstudante["desempenhoPorTema"];
      evolucaoDiaria: PainelDesempenhoEstudante["evolucaoDiaria"];
    }>("consultar_painel_desempenho");
    const total = dados.indicadores.acertosTentativas + dados.indicadores.errosTentativas;
    return {
      ...dados.indicadores,
      desempenhoPorTema: dados.desempenhoPorTema,
      evolucaoDiaria: dados.evolucaoDiaria,
      questoesRevisadas: Math.max(
        0,
        dados.indicadores.totalRespostas - dados.indicadores.questoesUnicasResolvidas,
      ),
      percentualAcertos: total
        ? Math.round((dados.indicadores.acertosTentativas / total) * 100)
        : 0,
    };
  }
  async consultarHistoricoEstudante(pagina: number, quantidade: number) {
    const aluno = await this.autorizacao.exigirEstudanteComCadastroCompleto();
    return this.historico(aluno.idPessoa, pagina, quantidade);
  }
  async consultarHistoricoAdministrativo(id: string, pagina: number, quantidade: number) {
    await this.autorizacao.exigirAdministradorAtivo();
    return this.historico(id, pagina, quantidade);
  }
  private historico(id: string, pagina: number, quantidade: number) {
    return this.rpc<{
      itens: MovimentacaoHonra[];
      total: number;
      pagina: number;
      quantidadePorPagina: number;
    }>("consultar_historico_honra", { p_idpessoa: id, p_pagina: pagina, p_quantidade: quantidade });
  }
  async consultarPainelAdministrativo(): Promise<PainelAdministrativoHonra> {
    await this.autorizacao.exigirAdministradorAtivo();
    const { indicadores, ...dados } = await this.rpc<
      Omit<PainelAdministrativoHonra, "totalEstudantesParticipantes" | "totalPontosConcedidos"> & {
        indicadores: { participantes: number; pontos: number };
      }
    >("consultar_painel_administrativo_honra");
    return {
      ...dados,
      totalEstudantesParticipantes: indicadores.participantes,
      totalPontosConcedidos: indicadores.pontos,
    };
  }
  async salvarTitulo(
    dados: Parameters<ServicoSistemaHonraEstudantesAdministracao["salvarTitulo"]>[0],
  ) {
    await this.autorizacao.exigirAdministradorAtivo();
    return this.rpc<string>("salvar_titulo_honra", { p_dados: dados });
  }
  async salvarRegra(
    codigo: string,
    dados: Parameters<ServicoSistemaHonraEstudantesAdministracao["salvarRegra"]>[1],
  ) {
    await this.autorizacao.exigirAdministradorAtivo();
    await this.rpc("salvar_regra_honra", { p_codigo: codigo, p_dados: dados });
  }
  async ajustarPontos(id: string, pontos: number, justificativa: string) {
    await this.autorizacao.exigirAdministradorAtivo();
    await this.rpc("ajustar_pontos_honra", {
      p_idpessoa: id,
      p_pontos: pontos,
      p_justificativa: justificativa,
    });
  }
  async consultarAnotacaoQuestao(id: string) {
    const aluno = await this.autorizacao.exigirEstudanteComCadastroCompleto();
    const { data, error } = await this.cliente
      .from("anotacoes_pessoais_questoes")
      .select("conteudo,atualizadaEm:atualizada_em")
      .eq("id_pessoa", aluno.idPessoa)
      .eq("id_questao", id)
      .maybeSingle<{ conteudo: string; atualizadaEm: string }>();
    if (error) throw error;
    return data ?? { conteudo: "", atualizadaEm: null };
  }
  async salvarAnotacaoQuestao(id: string, conteudo: string) {
    await this.autorizacao.exigirEstudanteComCadastroCompleto();
    await this.rpc("salvar_anotacao_pessoal", { p_idquestao: id, p_conteudo: conteudo });
    return this.consultarAnotacaoQuestao(id);
  }
}
