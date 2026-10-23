// Contratos de Autenticacao preservados da API .NET.

import type { DadosPessoaRequestModel, UsuarioResponseModel } from "./identidade-usuarios.js";

export interface AtualizarSenhaRequestModel {
  senha: string;
}

export interface CadastrarEstudanteRequestModel {
  email: string;
  senha: string;
  pessoa: DadosPessoaRequestModel;
}

export interface CadastroEstudanteResponseModel {
  idUsuario: string;
  confirmacaoEmailNecessaria: boolean;
}

export interface ConcluirGoogleRequestModel {
  codigo: string;
  estado: string;
}

export interface ConfiguracaoAcessoResponseModel {
  googleDisponivel: boolean;
  envioEmailDisponivel: boolean;
}

export interface ConfirmarEmailAutenticacaoRequestModel {
  token: string;
}

export interface EntrarAdministradorRequestModel {
  email: string;
  senha: string;
}

export interface EntrarContaRequestModel {
  email: string;
  senha: string;
  tipoExigido: string;
}

export interface EntrarEstudanteRequestModel {
  email: string;
  senha: string;
}

export interface FluxoGoogleResponseModel {
  url: string;
  estado: string;
  verificador: string;
  nonce: string;
  redirectUri: string;
  idUsuarioVinculo: string | null;
}

export interface IniciarGoogleRequestModel {
  origemFrontend: string | null;
}

export interface IniciarVinculoGoogleRequestModel {
  origemFrontend: string | null;
}

export interface MensagemAutenticacaoResponseModel {
  mensagem: string;
}

export interface ObterConfiguracaoAcessoRequestModel {}

export interface ObterVinculoGoogleRequestModel {}

export interface RedefinirSenhaRequestModel {
  token: string;
  senha: string;
}

export interface ReenviarConfirmacaoRequestModel {
  email: string;
}

export interface RenovarSessaoNavegadorRequestModel {}

export interface RenovarSessaoRequestModel {
  refreshToken: string;
}

export interface SairSessaoRequestModel {}

export interface SessaoNavegadorResponseModel {
  usuario: UsuarioResponseModel;
  expiresIn: number;
}

export interface SessaoResponseModel {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  usuario: UsuarioResponseModel | null;
}

export interface SolicitarRecuperacaoSenhaRequestModel {
  email: string;
}

export interface TrocarCodigoGoogleRequestModel {
  codigo: string;
  verificador: string;
  nonce: string;
  redirectUri: string;
  idUsuarioVinculo: string | null;
}

export interface UrlGoogleResponseModel {
  url: string;
}

export interface VinculoGoogleResponseModel {
  vinculado: boolean;
}
