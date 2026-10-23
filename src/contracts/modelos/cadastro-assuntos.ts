// Contratos de Cadastro / Assunto preservados da API .NET.

export interface AssuntoResponseModel {
  idAssunto: string;
  idDisciplina: string;
  idAssuntoPai: string | null;
  nome: string;
  descricao: string | null;
  dataHoraCadastro: string;
}

export interface AtualizarAssuntoRequestModel extends CriarAssuntoRequestModel {
  idAssunto: string;
}

export interface CriarAssuntoRequestModel {
  idDisciplina: string;
  idAssuntoPai: string | null;
  nome: string;
  descricao: string | null;
}

export interface ExcluirAssuntoRequestModel {
  idAssunto: string;
}

export interface ListarAssuntosRequestModel {
  busca: string | null;
  pagina: number;
  quantidadePorPagina: number;
  idDisciplina: string | null;
}

export interface ListarAssuntosResponseModel {
  itens: AssuntoResponseModel[];
  total: number;
  pagina: number;
  quantidadePorPagina: number;
}

export interface ObterAssuntoRequestModel {
  idAssunto: string;
}
