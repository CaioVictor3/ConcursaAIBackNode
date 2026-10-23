// Contratos de Cadastro / Disciplina preservados da API .NET.

export interface AtualizarDisciplinaRequestModel extends CriarDisciplinaRequestModel {
  idDisciplina: string;
}

export interface CriarDisciplinaRequestModel {
  nome: string;
  descricao: string;
  ativa: boolean;
  area: string | null;
}

export interface DesativarDisciplinaRequestModel {
  idDisciplina: string;
}

export interface DisciplinaResponseModel {
  idDisciplina: string;
  nome: string;
  descricao: string;
  ativa: boolean;
  dataHoraCadastro: string;
  area: string | null;
}

export interface ListarDisciplinasRequestModel {
  busca: string | null;
  pagina: number;
  quantidadePorPagina: number;
}

export interface ListarDisciplinasResponseModel {
  itens: DisciplinaResponseModel[];
  total: number;
  pagina: number;
  quantidadePorPagina: number;
}

export interface ObterDisciplinaRequestModel {
  idDisciplina: string;
}
