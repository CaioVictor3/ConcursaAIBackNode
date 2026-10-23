// Contratos de Sistema preservados da API .NET.

export interface VerificarSistemaRequestModel {}

export interface VerificarSistemaResponseModel {
  aplicacao: string;
  versaoDotNet: string;
  bancoConfigurado: boolean;
}
