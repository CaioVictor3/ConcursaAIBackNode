// Contratos de Questoes preservados da API .NET.

export interface AlternativaQuestaoRequestModel {
  idAlternativa: string;
  letra: string;
  texto: string;
  ordem: number;
}

export interface AlternativaQuestaoResponseModel {
  idAlternativa: string;
  letra: string;
  texto: string;
  ordem: number;
}

export interface AlternativaVinculadaResponseModel {
  idQuestao: string;
  idAlternativa: string;
  letra: string;
  texto: string;
  ordem: number;
}

export interface ArquivarQuestaoRequestModel {
  idQuestao: string;
}

export interface AtualizarQuestaoRequestModel extends CriarQuestaoRequestModel {
  idQuestao: string;
}

export interface CriarQuestaoRequestModel {
  idProva: string;
  idTema: string;
  numero: number;
  enunciado: string;
  dificuldade: string;
  fonte: string;
  imagemUrl: string | null;
  status: string;
  explicacao: string;
  statusGabarito: string;
  idAlternativaCorreta: string | null;
  alternativas: AlternativaQuestaoRequestModel[];
}

export interface GabaritoQuestaoResponseModel {
  idAlternativaCorreta: string | null;
  status: string;
  explicacao: string;
}

export interface ListarQuestoesRequestModel {
  idProva: string | null;
  idTema: string | null;
  orgao: string | null;
  organizadora: string | null;
  cargo: string | null;
  busca: string | null;
  ano: number | null;
  dificuldade: string | null;
  status: string | null;
  pagina: number;
  quantidadePorPagina: number;
}

export interface ListarQuestoesResponseModel {
  itens: QuestaoPublicaResponseModel[];
  total: number;
  pagina: number;
  quantidadePorPagina: number;
}

export interface ObterQuestaoRequestModel {
  idQuestao: string;
}

export interface QuestaoPublicaResponseModel {
  idQuestao: string;
  idProva: string | null;
  idTema: string | null;
  numero: number | null;
  nomeTema: string | null;
  enunciado: string;
  tipo: string;
  dificuldade: string;
  fonte: string;
  imagemUrl: string | null;
  status: string;
  dataHoraCadastro: string;
  dataHoraAtualizacao: string;
  alternativas: AlternativaQuestaoResponseModel[];
  revisaoPendente: boolean;
}

export interface QuestaoResponseModel extends QuestaoPublicaResponseModel {
  explicacao: string;
  gabarito: GabaritoQuestaoResponseModel | null;
}
