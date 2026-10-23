// Contratos de Estudo preservados da API .NET.

import type { DisponibilidadeAssuntoResponseModel } from "./simulados-tentativas-correcao.js";

export interface EstatisticaAssuntoResponseModel {
  idAssunto: string;
  assunto: string;
  idDisciplina: string;
  disciplina: string;
  avaliadas: number;
  acertos: number;
  erros: number;
  emBranco: number;
}

export interface EstatisticasAssuntosResponseModel {
  itens: EstatisticaAssuntoResponseModel[];
}

export interface GerarTreinoRecomendadoRequestModel {
  quantidade: number;
}

export interface GerarTreinoRevisaoRequestModel {
  quantidade: number;
}

export interface ListarQuestoesRevisaoRequestModel {
  pagina: number;
}

export interface ListarQuestoesRevisaoResponseModel {
  itens: QuestaoRevisaoResponseModel[];
  total: number;
  pagina: number;
  porPagina: number;
}

export interface MetaSemanalResponseModel {
  meta: number | null;
  respondidas: number;
  simulados: number;
  inicioSemana: string;
  fimSemana: string;
  dias: ProgressoDiaResponseModel[];
}

export interface ObterEstatisticasAssuntosRequestModel {}

export interface ObterMetaSemanalRequestModel {}

export interface ObterResumoRevisaoRequestModel {}

export interface PrepararTreinoRequestModel {
  quantidade: number;
  modo: string;
}

export interface ProgressoDiaResponseModel {
  data: string;
  questoes: number;
}

export interface QuestaoRevisaoResponseModel {
  idTentativa: string;
  idQuestao: string;
  enunciado: string;
  finalizadaEm: string;
  assunto: string;
  disciplina: string;
}

export interface ResumoRevisaoResponseModel {
  pendentes: number;
  recuperadas: number;
  assuntos: DisponibilidadeAssuntoResponseModel[];
}

export interface SalvarMetaSemanalRequestModel {
  quantidadeSemanal: number;
}
