import type * as ContratosApi from "../contracts/modelos-requisicoes-respostas-api.js";
import { criarRespostaSucesso } from "../domain/erros-validacoes-respostas-api.js";
import { ClienteAnaliseQuestoesOpenAI } from "../infrastructure/cliente-analise-questoes-openai.js";
import { consultarEnderecoViaCep } from "../infrastructure/cliente-enderecos-viacep.js";
import type {
  ConexaoTransacoesPostgreSql,
  IdentidadeUsuarioAutenticado,
} from "../infrastructure/conexao-transacoes-postgresql.js";
import { RepositorioConsultasNegocioPostgreSql } from "../infrastructure/repositorio-consultas-postgresql.js";
import { operacoesAdministracaoEmailsTransacionais } from "./administracao-emails-transacionais.service.js";
import { operacoesAnaliseQuestoesInteligenciaArtificial } from "./analise-questoes-inteligencia-artificial.service.js";
import { ServicoAutenticacaoContasSessoes } from "./autenticacao-contas-sessoes.service.js";
import { ServicoAutorizacaoUsuarioAutenticado } from "./autorizacao-usuario-autenticado.js";
import { operacoesCadastroAssuntos } from "./cadastro-assuntos.service.js";
import { operacoesCadastroBancas } from "./cadastro-bancas.service.js";
import { operacoesCadastroConcursos } from "./cadastro-concursos.service.js";
import { operacoesCadastroDisciplinas } from "./cadastro-disciplinas.service.js";
import { operacoesCadastroQuestoes } from "./cadastro-questoes-alternativas-gabaritos.service.js";
import { operacoesChamadosSuporte } from "./chamados-suporte.service.js";
import { operacoesConsultaCadastroProvas } from "./consulta-cadastro-provas.service.js";
import { operacoesDadosContaUsuarios } from "./dados-conta-usuarios-administracao.service.js";
import { operacoesGeracaoCadastroSimulados } from "./geracao-cadastro-simulados.service.js";
import { operacoesPreferenciasComunicacao } from "./preferencias-comunicacao.service.js";
import { operacoesResolucaoCorrecaoTentativas } from "./resolucao-correcao-tentativas.service.js";
import { operacoesRevisaoQuestoesMetasEstudo } from "./revisao-questoes-metas-estudo.service.js";

export function criarServicosAplicacaoApi(
  conexaoPostgreSql: ConexaoTransacoesPostgreSql,
  servicoAutenticacao: ServicoAutenticacaoContasSessoes,
  clienteOpenAI: ClienteAnaliseQuestoesOpenAI,
  user: IdentidadeUsuarioAutenticado,
  sinalCancelamento?: AbortSignal,
) {
  const contextoAutorizacao = new ServicoAutorizacaoUsuarioAutenticado(
    new RepositorioConsultasNegocioPostgreSql(conexaoPostgreSql, user),
  );

  const operacoesSimulado = operacoesGeracaoCadastroSimulados(contextoAutorizacao);

  const operacoesTentativa = operacoesResolucaoCorrecaoTentativas(
    contextoAutorizacao,
    operacoesSimulado,
  );

  return {
    ...operacoesCadastroBancas(contextoAutorizacao),
    ...operacoesCadastroDisciplinas(contextoAutorizacao),
    ...operacoesCadastroAssuntos(contextoAutorizacao),
    ...operacoesCadastroConcursos(contextoAutorizacao),
    ...operacoesConsultaCadastroProvas(
      contextoAutorizacao,
      operacoesTentativa.obterTentativaSimulado,
    ),
    ...operacoesCadastroQuestoes(contextoAutorizacao),
    ...operacoesSimulado,
    ...operacoesTentativa,
    ...operacoesRevisaoQuestoesMetasEstudo(contextoAutorizacao, operacoesSimulado),
    ...operacoesDadosContaUsuarios(contextoAutorizacao),
    ...operacoesChamadosSuporte(contextoAutorizacao),
    ...operacoesPreferenciasComunicacao(
      contextoAutorizacao,
      servicoAutenticacao.servicoEmailsTransacionais,
    ),
    ...operacoesAdministracaoEmailsTransacionais(
      contextoAutorizacao,
      servicoAutenticacao.servicoEmailsTransacionais,
    ),
    ...operacoesAnaliseQuestoesInteligenciaArtificial(
      contextoAutorizacao,
      operacoesTentativa,
      clienteOpenAI,
      sinalCancelamento,
    ),
    ...servicoAutenticacao.criarOperacoesAutenticacaoUsuario(user, sinalCancelamento),
    consultarCep: async (solicitacaoConsultarCep: ContratosApi.ConsultarCepRequestModel) =>
      criarRespostaSucesso(
        await consultarEnderecoViaCep(
          solicitacaoConsultarCep.cep,
          conexaoPostgreSql.config.viaCepUrl,
          clienteOpenAI.clienteHttp,
          sinalCancelamento,
        ),
        "CEP consultado.",
      ),
    verificarSistema: async (
      solicitacaoVerificarSistemaNaoUtilizada: ContratosApi.VerificarSistemaRequestModel,
    ) =>
      criarRespostaSucesso(
        {
          aplicacao: "ConcursaAI",
          versaoDotNet: process.versions.node,
          bancoConfigurado: conexaoPostgreSql.estaConfigurada,
        },
        "API em execução. A presença de configuração não representa um teste de conectividade com o PostgreSQL.",
      ),
  };
}

export type Services = ReturnType<typeof criarServicosAplicacaoApi>;
