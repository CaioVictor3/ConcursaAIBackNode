// Contratos de Identidade preservados da API .NET.

export interface AtualizarMinhaContaRequestModel extends DadosPessoaRequestModel {}

export interface DadosPessoaRequestModel {
  nomeCompleto: string;
  dataNascimento: string | null;
  cpf: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: string;
}

export interface ListarUsuariosRequestModel {
  tipo: string | null;
  busca: string | null;
  pagina: number;
  quantidadePorPagina: number;
}

export interface ListarUsuariosResponseModel {
  itens: UsuarioResponseModel[];
  total: number;
  pagina: number;
  quantidadePorPagina: number;
}

export interface MinhaContaResponseModel {
  usuario: UsuarioResponseModel;
  pessoa: PessoaResponseModel | null;
}

export interface ObterMeuUsuarioRequestModel {}

export interface ObterMinhaContaRequestModel {}

export interface ObterUsuarioRequestModel {
  idUsuario: string;
}

export interface PessoaResponseModel {
  idPessoa: string;
  nomeCompleto: string;
  dataNascimento: string | null;
  cpf: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
}

export interface UsuarioResponseModel {
  idUsuario: string;
  idPessoa: string;
  nomeCompleto: string;
  email: string;
  tipo: string;
  estadoCadastro: string;
  cadastroCompleto: boolean;
  dataHoraCadastro: string;
  dataHoraUltimoAcesso: string | null;
}
