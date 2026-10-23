// Contratos de Integracoes preservados da API .NET.

export interface ConsultarCepRequestModel {
  cep: string;
}

export interface ConsultarCepResponseModel {
  cep: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
}
