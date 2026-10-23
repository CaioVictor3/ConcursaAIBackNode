// Contratos de Cadastro / Concurso preservados da API .NET.

export interface AtualizarConcursoRequestModel extends CriarConcursoRequestModel {
  idConcurso: string;
}

export interface ConcursoResponseModel {
  idConcurso: string;
  nome: string;
  orgao: string;
  cargo: string;
  estado: string;
  ano: number;
  descricao: string | null;
  status: string;
  dataHoraCadastro: string;
}

export interface CriarConcursoRequestModel {
  nome: string;
  orgao: string;
  cargo: string;
  estado: string;
  ano: number;
  descricao: string | null;
  status: string;
}

export interface ExcluirConcursoRequestModel {
  idConcurso: string;
}

export interface ListarConcursosRequestModel {
  busca: string | null;
  pagina: number;
  quantidadePorPagina: number;
}

export interface ListarConcursosResponseModel {
  itens: ConcursoResponseModel[];
  total: number;
  pagina: number;
  quantidadePorPagina: number;
}

export interface ObterConcursoRequestModel {
  idConcurso: string;
}
