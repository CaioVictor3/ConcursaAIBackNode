// Contratos de Simulados preservados da API .NET.

import type { QuestaoPublicaResponseModel } from "./questoes-alternativas-gabaritos.js";

export interface AtualizarSimuladoRequestModel extends CriarSimuladoRequestModel {
  idSimulado: string;
}

export interface ComposicaoSimuladoResponseModel {
  idSimulado: string;
  idQuestao: string;
  ordem: number;
}

export interface CorrecaoBancoResponseModel {
  itens: ItemCorrecaoBancoResponseModel[];
}

export interface CotaAssuntoRequestModel {
  idAssunto: string;
  quantidade: number;
}

export interface CotaTemaRequestModel {
  idTema: string;
  quantidade: number;
}

export interface CriarSimuladoFiltradoRequestModel {
  nome: string;
  quantidade: number;
  idTema: string | null;
  cotasTemas: CotaTemaRequestModel[];
  ano: number | null;
  orgao: string | null;
  organizadora: string | null;
  cargo: string | null;
}

export interface CriarSimuladoRequestModel {
  nome: string;
  descricao: string;
  idConcurso: string | null;
  duracaoMinutos: number | null;
  tipo: string;
  publico: boolean;
  status: string;
  idsQuestoes: string[];
}

export interface DisponibilidadeAssuntoResponseModel {
  idAssunto: string;
  assunto: string;
  idDisciplina: string;
  disciplina: string;
  quantidade: number;
}

export interface DisponibilidadeAssuntosResponseModel {
  itens: DisponibilidadeAssuntoResponseModel[];
  totalQuestoes: number;
}

export interface FinalizarTentativaSimuladoRequestModel {
  idTentativa: string;
}

export interface GerarSimuladoPersonalizadoRequestModel {
  quantidade: number;
  cotasAssuntos: CotaAssuntoRequestModel[];
}

export interface GerarSimuladoResponseModel {
  idTentativa: string;
  idSimulado: string;
}

export interface IniciarTentativaSimuladoRequestModel {
  idSimulado: string;
}

export interface ItemCorrecaoBancoResponseModel {
  idQuestao: string;
  idAlternativaSelecionada: string | null;
  idAlternativaCorreta: string | null;
  semGabarito: boolean;
  anulada: boolean;
  acertou: boolean;
  explicacao: string;
}

export interface ItemResultadoTentativaResponseModel {
  questao: QuestaoPublicaResponseModel;
  idAlternativaSelecionada: string | null;
  idAlternativaCorreta: string | null;
  semGabarito: boolean;
  anulada: boolean;
  acertou: boolean;
  explicacao: string;
}

export interface ListarMinhasTentativasRequestModel {
  pagina: number;
  quantidadePorPagina: number;
}

export interface ListarSimuladosRequestModel {
  somentePublicos: boolean;
  pagina: number;
  quantidadePorPagina: number;
}

export interface ListarSimuladosResponseModel {
  itens: SimuladoResponseModel[];
  total: number;
  pagina: number;
  quantidadePorPagina: number;
}

export interface ListarTentativasResponseModel {
  itens: TentativaSimuladoResponseModel[];
  total: number;
  pagina: number;
  quantidadePorPagina: number;
}

export interface ObterDisponibilidadeAssuntosRequestModel {}

export interface ObterQuestoesTentativaRequestModel {
  idTentativa: string;
}

export interface ObterResultadoTentativaRequestModel {
  idTentativa: string;
}

export interface ObterSimuladoRequestModel {
  idSimulado: string;
}

export interface ObterTentativaSimuladoRequestModel {
  idTentativa: string;
}

export interface QuestoesTentativaResponseModel {
  itens: QuestaoPublicaResponseModel[];
}

export interface ResponderQuestaoSimuladoRequestModel {
  idTentativa: string;
  idQuestao: string;
  idAlternativaSelecionada: string | null;
}

export interface RespostaTentativaResponseModel {
  idQuestao: string;
  idAlternativaSelecionada: string | null;
  dataHoraResposta: string | null;
}

export interface RespostaTentativaVinculadaResponseModel {
  idTentativa: string;
  idQuestao: string;
  idAlternativaSelecionada: string | null;
  dataHoraResposta: string | null;
}

export interface ResultadoTentativaResponseModel {
  tentativa: TentativaSimuladoResponseModel;
  simulado: SimuladoResponseModel;
  itens: ItemResultadoTentativaResponseModel[];
}

export interface SimuladoResponseModel {
  idSimulado: string;
  nome: string;
  descricao: string;
  idConcurso: string | null;
  duracaoMinutos: number | null;
  tipo: string;
  publico: boolean;
  status: string;
  dataHoraCadastro: string;
  idsQuestoes: string[];
}

export interface TentativaSimuladoResponseModel {
  nomeSimulado: string;
  tipoOrigem: string;
  idProva: string | null;
  idTentativa: string;
  idSimulado: string;
  idPessoa: string;
  status: string;
  dataHoraInicio: string;
  dataHoraFinalizacao: string | null;
  pontuacao: number | null;
  totalAnuladas: number;
  totalSemGabarito: number;
  totalAcertos: number;
  totalErros: number;
  totalNaoRespondidas: number;
  tempoGastoSegundos: number;
  respostas: RespostaTentativaResponseModel[];
}
