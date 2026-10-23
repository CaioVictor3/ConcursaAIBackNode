// Contratos de InteligenciaArtificial preservados da API .NET.

export interface AnaliseQuestaoResponseModel {
  conteudo: ConteudoAnaliseQuestaoResponseModel;
  modelo: string;
  geradaEm: string;
  demonstracao: boolean;
}

export interface ConsultarAnaliseQuestaoRequestModel {
  idTentativa: string;
  idQuestao: string;
}

export interface ConsultarAnaliseQuestaoResponseModel {
  disponivel: boolean;
  analise: AnaliseQuestaoResponseModel | null;
}

export interface ConteudoAnaliseQuestaoResponseModel {
  resumo: string;
  respostaMarcada: string;
  respostaCorreta: string;
  alternativas: JustificativaAlternativaResponseModel[];
  pontosRevisao: string[];
  ressalvas: string | null;
}

export interface JustificativaAlternativaResponseModel {
  idAlternativa: string;
  justificativa: string;
}

export interface SolicitarAnaliseQuestaoRequestModel {
  idTentativa: string;
  idQuestao: string;
}

export interface ValidarAnaliseQuestaoRequestModel {
  idQuestao: string;
  analise: AnaliseQuestaoResponseModel;
}
