// Contratos de Provas preservados da API .NET.

export interface AtualizarProvaRequestModel extends CriarProvaRequestModel {
  idProva: string;
}

export interface CriarProvaRequestModel {
  ano: number;
  orgao: string;
  idOrganizadora: string;
  cargo: string | null;
  composicaoConfirmada: boolean;
}

export interface IniciarProvaRequestModel {
  idProva: string;
}

export interface ListarPendenciasProvasRequestModel {
  pagina: number;
  quantidadePorPagina: number;
}

export interface ListarPendenciasProvasResponseModel {
  itens: PendenciaProvaResponseModel[];
  total: number;
  pagina: number;
  quantidadePorPagina: number;
}

export interface ListarProvasRequestModel {
  ano: number | null;
  orgao: string | null;
  organizadora: string | null;
  cargo: string | null;
  pagina: number;
  quantidadePorPagina: number;
}

export interface ListarProvasResponseModel {
  itens: ProvaResponseModel[];
  total: number;
  pagina: number;
  quantidadePorPagina: number;
}

export interface ListarTemasRequestModel {}

export interface ListarTemasResponseModel {
  itens: TemaResponseModel[];
}

export interface ObterProvaRequestModel {
  idProva: string;
}

export interface PendenciaProvaResponseModel {
  entidade: string;
  id: string;
  motivo: string;
}

export interface ProvaResponseModel {
  idProva: string;
  ano: number;
  orgao: string;
  idOrganizadora: string | null;
  organizadora: string | null;
  cargo: string | null;
  composicaoConfirmada: boolean;
  revisaoPendente: boolean;
}

export interface TemaResponseModel {
  idTema: string;
  nome: string;
}
