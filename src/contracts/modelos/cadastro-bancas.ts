// Contratos de Cadastro / Banca preservados da API .NET.

export interface AtualizarBancaRequestModel extends CriarBancaRequestModel {
  idBanca: string;
}

export interface BancaResponseModel {
  idBanca: string;
  nome: string;
  sigla: string;
  dataHoraCadastro: string;
}

export interface CriarBancaRequestModel {
  nome: string;
  sigla: string;
}

export interface ExcluirBancaRequestModel {
  idBanca: string;
}

export interface ListarBancasRequestModel {
  busca: string | null;
  pagina: number;
  quantidadePorPagina: number;
}

export interface ListarBancasResponseModel {
  itens: BancaResponseModel[];
  total: number;
  pagina: number;
  quantidadePorPagina: number;
}

export interface ObterBancaRequestModel {
  idBanca: string;
}
