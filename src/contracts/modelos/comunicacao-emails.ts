// Contratos de Comunicacao preservados da API .NET.

export interface AtualizarFluxoEmailRequestModel {
  tipoEvento: string;
  habilitado: boolean | null;
}

export interface EmailTransacionalResponseModel {
  idEmailTransacional: string;
  idUsuario: string | null;
  tipoEvento: string;
  emailDestinatario: string;
  status: string;
  quantidadeTentativas: number;
  maximoTentativas: number;
  dataHoraCriacao: string;
  dataHoraEnvio: string | null;
  dataHoraEntrega: string | null;
  codigoErro: string | null;
}

export interface FluxoEmailResponseModel {
  tipoEvento: string;
  habilitado: boolean;
  dataHoraAtualizacao: string | null;
}

export interface ListarEmailsTransacionaisRequestModel {
  idUsuario: string | null;
  tipoEvento: string | null;
  status: string | null;
  de: string | null;
  ate: string | null;
  pagina: number;
  quantidade: number;
}

export interface ListarEmailsTransacionaisResponseModel {
  itens: EmailTransacionalResponseModel[];
  total: number;
  pagina: number;
}

export interface ListarFluxosEmailRequestModel {}

export interface ListarFluxosEmailResponseModel {
  fluxos: FluxoEmailResponseModel[];
}

export interface MetricasEmailsResponseModel {
  pendentes: number;
  processando: number;
  aceitos: number;
  entregues: number;
  falhas: number;
  bounces: number;
}

export interface ObterMetricasEmailsRequestModel {}

export interface ObterPreferenciaComunicacaoRequestModel {}

export interface PreferenciaComunicacaoRequestModel {
  receberInatividade: boolean;
}

export interface PreferenciaComunicacaoResponseModel {
  receberInatividade: boolean;
}

export interface RegistrarEventoEntregaRequestModel {}

export interface RegistrarEventoEntregaResponseModel {
  recebido: boolean;
}

export interface ReprocessarEmailRequestModel {
  idEmailTransacional: string;
}

export interface ReprocessarEmailResponseModel {
  reprocessamentoSolicitado: boolean;
}
