// Contratos de Suporte preservados da API .NET.

export interface AbrirChamadoRequestModel {
  assunto: string;
  categoria: string;
  mensagem: string;
}

export interface ChamadoSuporteResponseModel {
  idChamado: string;
  idPessoa: string;
  nomeEstudante: string;
  assunto: string;
  categoria: string;
  status: string;
  idAdministradorResponsavel: string | null;
  idAdministradorFinalizador: string | null;
  dataHoraCadastro: string;
  dataHoraAtualizacao: string;
  dataHoraFinalizacao: string | null;
  resolucao: string | null;
  mensagens: MensagemChamadoResponseModel[];
}

export interface FinalizarChamadoRequestModel {
  idChamado: string;
  resolucao: string;
}

export interface ListarChamadosRequestModel {
  status: string | null;
  pagina: number;
  quantidadePorPagina: number;
}

export interface ListarChamadosResponseModel {
  itens: ChamadoSuporteResponseModel[];
  total: number;
  pagina: number;
  quantidadePorPagina: number;
}

export interface MensagemChamadoResponseModel {
  idMensagem: string;
  idPessoaAutor: string;
  nomeAutor: string;
  tipoUsuarioAutor: string;
  conteudo: string;
  tipo: string;
  dataHoraCadastro: string;
}

export interface ObterChamadoRequestModel {
  idChamado: string;
}

export interface ResponderChamadoRequestModel {
  idChamado: string;
  mensagem: string;
}
