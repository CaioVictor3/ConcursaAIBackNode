// Extracted from the original .NET DTOs; see scripts/inventory.py.
export interface ApiResponse<T> {
  success: boolean;
  message: string;
  statusCode: number;
  data: T | null;
}
export interface MetricasSistemaResponseModel {
  alunos: number;
  administradores: number;
  alunosAtivos: number;
  acessos30Dias: number;
  questoesPublicadas: number;
  simuladosGerados: number;
  tentativasFinalizadas: number;
  chamadosPendentes: number;
  chamadosFinalizados: number;
}
export interface ObterMetricasSistemaRequestModel {}
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
export interface AssuntoResponseModel {
  idAssunto: string;
  idDisciplina: string;
  idAssuntoPai: string | null;
  nome: string;
  descricao: string | null;
  dataHoraCadastro: string;
}
export interface AtualizarAssuntoRequestModel extends CriarAssuntoRequestModel {
  idAssunto: string;
}
export interface CriarAssuntoRequestModel {
  idDisciplina: string;
  idAssuntoPai: string | null;
  nome: string;
  descricao: string | null;
}
export interface ExcluirAssuntoRequestModel {
  idAssunto: string;
}
export interface ListarAssuntosRequestModel {
  busca: string | null;
  pagina: number;
  quantidadePorPagina: number;
  idDisciplina: string | null;
}
export interface ListarAssuntosResponseModel {
  itens: AssuntoResponseModel[];
  total: number;
  pagina: number;
  quantidadePorPagina: number;
}
export interface ObterAssuntoRequestModel {
  idAssunto: string;
}
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
export interface EstatisticaAssuntoResponseModel {
  idAssunto: string;
  assunto: string;
  idDisciplina: string;
  disciplina: string;
  avaliadas: number;
  acertos: number;
  erros: number;
  emBranco: number;
}
export interface EstatisticasAssuntosResponseModel {
  itens: EstatisticaAssuntoResponseModel[];
}
export interface GerarTreinoRecomendadoRequestModel {
  quantidade: number;
}
export interface GerarTreinoRevisaoRequestModel {
  quantidade: number;
}
export interface ListarQuestoesRevisaoRequestModel {
  pagina: number;
}
export interface ListarQuestoesRevisaoResponseModel {
  itens: QuestaoRevisaoResponseModel[];
  total: number;
  pagina: number;
  porPagina: number;
}
export interface MetaSemanalResponseModel {
  meta: number | null;
  respondidas: number;
  simulados: number;
  inicioSemana: string;
  fimSemana: string;
  dias: ProgressoDiaResponseModel[];
}
export interface ObterEstatisticasAssuntosRequestModel {}
export interface ObterMetaSemanalRequestModel {}
export interface ObterResumoRevisaoRequestModel {}
export interface PrepararTreinoRequestModel {
  quantidade: number;
  modo: string;
}
export interface ProgressoDiaResponseModel {
  data: string;
  questoes: number;
}
export interface QuestaoRevisaoResponseModel {
  idTentativa: string;
  idQuestao: string;
  enunciado: string;
  finalizadaEm: string;
  assunto: string;
  disciplina: string;
}
export interface ResumoRevisaoResponseModel {
  pendentes: number;
  recuperadas: number;
  assuntos: DisponibilidadeAssuntoResponseModel[];
}
export interface SalvarMetaSemanalRequestModel {
  quantidadeSemanal: number;
}
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
export interface AnaliseQuestaoResponseModel {
  conteudo: ConteudoAnaliseQuestaoResponseModel;
  modelo: string;
  geradaEm: string;
  demonstracao: boolean;
}
export interface ConsultarAnaliseQuestaoRequestModel {
  idTentativa: string;
  idQuestao: string;
}
export interface ConsultarAnaliseQuestaoResponseModel {
  disponivel: boolean;
  analise: AnaliseQuestaoResponseModel | null;
}
export interface ConteudoAnaliseQuestaoResponseModel {
  resumo: string;
  respostaMarcada: string;
  respostaCorreta: string;
  alternativas: JustificativaAlternativaResponseModel[];
  pontosRevisao: string[];
  ressalvas: string | null;
}
export interface JustificativaAlternativaResponseModel {
  idAlternativa: string;
  justificativa: string;
}
export interface SolicitarAnaliseQuestaoRequestModel {
  idTentativa: string;
  idQuestao: string;
}
export interface ValidarAnaliseQuestaoRequestModel {
  idQuestao: string;
  analise: AnaliseQuestaoResponseModel;
}
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
export interface AlternativaQuestaoRequestModel {
  idAlternativa: string;
  letra: string;
  texto: string;
  ordem: number;
}
export interface AlternativaQuestaoResponseModel {
  idAlternativa: string;
  letra: string;
  texto: string;
  ordem: number;
}
export interface AlternativaVinculadaResponseModel {
  idQuestao: string;
  idAlternativa: string;
  letra: string;
  texto: string;
  ordem: number;
}
export interface ArquivarQuestaoRequestModel {
  idQuestao: string;
}
export interface AtualizarQuestaoRequestModel extends CriarQuestaoRequestModel {
  idQuestao: string;
}
export interface CriarQuestaoRequestModel {
  idProva: string;
  idTema: string;
  numero: number;
  enunciado: string;
  dificuldade: string;
  fonte: string;
  imagemUrl: string | null;
  status: string;
  explicacao: string;
  statusGabarito: string;
  idAlternativaCorreta: string | null;
  alternativas: AlternativaQuestaoRequestModel[];
}
export interface GabaritoQuestaoResponseModel {
  idAlternativaCorreta: string | null;
  status: string;
  explicacao: string;
}
export interface ListarQuestoesRequestModel {
  idProva: string | null;
  idTema: string | null;
  orgao: string | null;
  organizadora: string | null;
  cargo: string | null;
  busca: string | null;
  ano: number | null;
  dificuldade: string | null;
  status: string | null;
  pagina: number;
  quantidadePorPagina: number;
}
export interface ListarQuestoesResponseModel {
  itens: QuestaoPublicaResponseModel[];
  total: number;
  pagina: number;
  quantidadePorPagina: number;
}
export interface ObterQuestaoRequestModel {
  idQuestao: string;
}
export interface QuestaoPublicaResponseModel {
  idQuestao: string;
  idProva: string | null;
  idTema: string | null;
  numero: number | null;
  nomeTema: string | null;
  enunciado: string;
  tipo: string;
  dificuldade: string;
  fonte: string;
  imagemUrl: string | null;
  status: string;
  dataHoraCadastro: string;
  dataHoraAtualizacao: string;
  alternativas: AlternativaQuestaoResponseModel[];
  revisaoPendente: boolean;
}
export interface QuestaoResponseModel extends QuestaoPublicaResponseModel {
  explicacao: string;
  gabarito: GabaritoQuestaoResponseModel | null;
}
export interface AtualizarSimuladoRequestModel extends CriarSimuladoRequestModel {
  idSimulado: string;
}
export interface ComposicaoSimuladoResponseModel {
  idSimulado: string;
  idQuestao: string;
  ordem: number;
}
export interface CorrecaoBancoResponseModel {
  itens: ItemCorrecaoBancoResponseModel[];
}
export interface CotaAssuntoRequestModel {
  idAssunto: string;
  quantidade: number;
}
export interface CotaTemaRequestModel {
  idTema: string;
  quantidade: number;
}
export interface CriarSimuladoFiltradoRequestModel {
  nome: string;
  quantidade: number;
  idTema: string | null;
  cotasTemas: CotaTemaRequestModel[];
  ano: number | null;
  orgao: string | null;
  organizadora: string | null;
  cargo: string | null;
}
export interface CriarSimuladoRequestModel {
  nome: string;
  descricao: string;
  idConcurso: string | null;
  duracaoMinutos: number | null;
  tipo: string;
  publico: boolean;
  status: string;
  idsQuestoes: string[];
}
export interface DisponibilidadeAssuntoResponseModel {
  idAssunto: string;
  assunto: string;
  idDisciplina: string;
  disciplina: string;
  quantidade: number;
}
export interface DisponibilidadeAssuntosResponseModel {
  itens: DisponibilidadeAssuntoResponseModel[];
  totalQuestoes: number;
}
export interface FinalizarTentativaSimuladoRequestModel {
  idTentativa: string;
}
export interface GerarSimuladoPersonalizadoRequestModel {
  quantidade: number;
  cotasAssuntos: CotaAssuntoRequestModel[];
}
export interface GerarSimuladoResponseModel {
  idTentativa: string;
  idSimulado: string;
}
export interface IniciarTentativaSimuladoRequestModel {
  idSimulado: string;
}
export interface ItemCorrecaoBancoResponseModel {
  idQuestao: string;
  idAlternativaSelecionada: string | null;
  idAlternativaCorreta: string | null;
  semGabarito: boolean;
  anulada: boolean;
  acertou: boolean;
  explicacao: string;
}
export interface ItemResultadoTentativaResponseModel {
  questao: QuestaoPublicaResponseModel;
  idAlternativaSelecionada: string | null;
  idAlternativaCorreta: string | null;
  semGabarito: boolean;
  anulada: boolean;
  acertou: boolean;
  explicacao: string;
}
export interface ListarMinhasTentativasRequestModel {
  pagina: number;
  quantidadePorPagina: number;
}
export interface ListarSimuladosRequestModel {
  somentePublicos: boolean;
  pagina: number;
  quantidadePorPagina: number;
}
export interface ListarSimuladosResponseModel {
  itens: SimuladoResponseModel[];
  total: number;
  pagina: number;
  quantidadePorPagina: number;
}
export interface ListarTentativasResponseModel {
  itens: TentativaSimuladoResponseModel[];
  total: number;
  pagina: number;
  quantidadePorPagina: number;
}
export interface ObterDisponibilidadeAssuntosRequestModel {}
export interface ObterQuestoesTentativaRequestModel {
  idTentativa: string;
}
export interface ObterResultadoTentativaRequestModel {
  idTentativa: string;
}
export interface ObterSimuladoRequestModel {
  idSimulado: string;
}
export interface ObterTentativaSimuladoRequestModel {
  idTentativa: string;
}
export interface QuestoesTentativaResponseModel {
  itens: QuestaoPublicaResponseModel[];
}
export interface ResponderQuestaoSimuladoRequestModel {
  idTentativa: string;
  idQuestao: string;
  idAlternativaSelecionada: string | null;
}
export interface RespostaTentativaResponseModel {
  idQuestao: string;
  idAlternativaSelecionada: string | null;
  dataHoraResposta: string | null;
}
export interface RespostaTentativaVinculadaResponseModel {
  idTentativa: string;
  idQuestao: string;
  idAlternativaSelecionada: string | null;
  dataHoraResposta: string | null;
}
export interface ResultadoTentativaResponseModel {
  tentativa: TentativaSimuladoResponseModel;
  simulado: SimuladoResponseModel;
  itens: ItemResultadoTentativaResponseModel[];
}
export interface SimuladoResponseModel {
  idSimulado: string;
  nome: string;
  descricao: string;
  idConcurso: string | null;
  duracaoMinutos: number | null;
  tipo: string;
  publico: boolean;
  status: string;
  dataHoraCadastro: string;
  idsQuestoes: string[];
}
export interface TentativaSimuladoResponseModel {
  nomeSimulado: string;
  tipoOrigem: string;
  idProva: string | null;
  idTentativa: string;
  idSimulado: string;
  idPessoa: string;
  status: string;
  dataHoraInicio: string;
  dataHoraFinalizacao: string | null;
  pontuacao: number | null;
  totalAnuladas: number;
  totalSemGabarito: number;
  totalAcertos: number;
  totalErros: number;
  totalNaoRespondidas: number;
  tempoGastoSegundos: number;
  respostas: RespostaTentativaResponseModel[];
}
export interface VerificarSistemaRequestModel {}
export interface VerificarSistemaResponseModel {
  aplicacao: string;
  versaoDotNet: string;
  bancoConfigurado: boolean;
}
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
export interface Models {
  MetricasSistemaResponseModel: MetricasSistemaResponseModel;
  ObterMetricasSistemaRequestModel: ObterMetricasSistemaRequestModel;
  AtualizarSenhaRequestModel: AtualizarSenhaRequestModel;
  CadastrarEstudanteRequestModel: CadastrarEstudanteRequestModel;
  CadastroEstudanteResponseModel: CadastroEstudanteResponseModel;
  ConcluirGoogleRequestModel: ConcluirGoogleRequestModel;
  ConfiguracaoAcessoResponseModel: ConfiguracaoAcessoResponseModel;
  ConfirmarEmailAutenticacaoRequestModel: ConfirmarEmailAutenticacaoRequestModel;
  EntrarAdministradorRequestModel: EntrarAdministradorRequestModel;
  EntrarContaRequestModel: EntrarContaRequestModel;
  EntrarEstudanteRequestModel: EntrarEstudanteRequestModel;
  FluxoGoogleResponseModel: FluxoGoogleResponseModel;
  IniciarGoogleRequestModel: IniciarGoogleRequestModel;
  IniciarVinculoGoogleRequestModel: IniciarVinculoGoogleRequestModel;
  MensagemAutenticacaoResponseModel: MensagemAutenticacaoResponseModel;
  ObterConfiguracaoAcessoRequestModel: ObterConfiguracaoAcessoRequestModel;
  ObterVinculoGoogleRequestModel: ObterVinculoGoogleRequestModel;
  RedefinirSenhaRequestModel: RedefinirSenhaRequestModel;
  ReenviarConfirmacaoRequestModel: ReenviarConfirmacaoRequestModel;
  RenovarSessaoNavegadorRequestModel: RenovarSessaoNavegadorRequestModel;
  RenovarSessaoRequestModel: RenovarSessaoRequestModel;
  SairSessaoRequestModel: SairSessaoRequestModel;
  SessaoNavegadorResponseModel: SessaoNavegadorResponseModel;
  SessaoResponseModel: SessaoResponseModel;
  SolicitarRecuperacaoSenhaRequestModel: SolicitarRecuperacaoSenhaRequestModel;
  TrocarCodigoGoogleRequestModel: TrocarCodigoGoogleRequestModel;
  UrlGoogleResponseModel: UrlGoogleResponseModel;
  VinculoGoogleResponseModel: VinculoGoogleResponseModel;
  AssuntoResponseModel: AssuntoResponseModel;
  AtualizarAssuntoRequestModel: AtualizarAssuntoRequestModel;
  CriarAssuntoRequestModel: CriarAssuntoRequestModel;
  ExcluirAssuntoRequestModel: ExcluirAssuntoRequestModel;
  ListarAssuntosRequestModel: ListarAssuntosRequestModel;
  ListarAssuntosResponseModel: ListarAssuntosResponseModel;
  ObterAssuntoRequestModel: ObterAssuntoRequestModel;
  AtualizarBancaRequestModel: AtualizarBancaRequestModel;
  BancaResponseModel: BancaResponseModel;
  CriarBancaRequestModel: CriarBancaRequestModel;
  ExcluirBancaRequestModel: ExcluirBancaRequestModel;
  ListarBancasRequestModel: ListarBancasRequestModel;
  ListarBancasResponseModel: ListarBancasResponseModel;
  ObterBancaRequestModel: ObterBancaRequestModel;
  AtualizarConcursoRequestModel: AtualizarConcursoRequestModel;
  ConcursoResponseModel: ConcursoResponseModel;
  CriarConcursoRequestModel: CriarConcursoRequestModel;
  ExcluirConcursoRequestModel: ExcluirConcursoRequestModel;
  ListarConcursosRequestModel: ListarConcursosRequestModel;
  ListarConcursosResponseModel: ListarConcursosResponseModel;
  ObterConcursoRequestModel: ObterConcursoRequestModel;
  AtualizarDisciplinaRequestModel: AtualizarDisciplinaRequestModel;
  CriarDisciplinaRequestModel: CriarDisciplinaRequestModel;
  DesativarDisciplinaRequestModel: DesativarDisciplinaRequestModel;
  DisciplinaResponseModel: DisciplinaResponseModel;
  ListarDisciplinasRequestModel: ListarDisciplinasRequestModel;
  ListarDisciplinasResponseModel: ListarDisciplinasResponseModel;
  ObterDisciplinaRequestModel: ObterDisciplinaRequestModel;
  AtualizarFluxoEmailRequestModel: AtualizarFluxoEmailRequestModel;
  EmailTransacionalResponseModel: EmailTransacionalResponseModel;
  FluxoEmailResponseModel: FluxoEmailResponseModel;
  ListarEmailsTransacionaisRequestModel: ListarEmailsTransacionaisRequestModel;
  ListarEmailsTransacionaisResponseModel: ListarEmailsTransacionaisResponseModel;
  ListarFluxosEmailRequestModel: ListarFluxosEmailRequestModel;
  ListarFluxosEmailResponseModel: ListarFluxosEmailResponseModel;
  MetricasEmailsResponseModel: MetricasEmailsResponseModel;
  ObterMetricasEmailsRequestModel: ObterMetricasEmailsRequestModel;
  ObterPreferenciaComunicacaoRequestModel: ObterPreferenciaComunicacaoRequestModel;
  PreferenciaComunicacaoRequestModel: PreferenciaComunicacaoRequestModel;
  PreferenciaComunicacaoResponseModel: PreferenciaComunicacaoResponseModel;
  RegistrarEventoEntregaRequestModel: RegistrarEventoEntregaRequestModel;
  RegistrarEventoEntregaResponseModel: RegistrarEventoEntregaResponseModel;
  ReprocessarEmailRequestModel: ReprocessarEmailRequestModel;
  ReprocessarEmailResponseModel: ReprocessarEmailResponseModel;
  EstatisticaAssuntoResponseModel: EstatisticaAssuntoResponseModel;
  EstatisticasAssuntosResponseModel: EstatisticasAssuntosResponseModel;
  GerarTreinoRecomendadoRequestModel: GerarTreinoRecomendadoRequestModel;
  GerarTreinoRevisaoRequestModel: GerarTreinoRevisaoRequestModel;
  ListarQuestoesRevisaoRequestModel: ListarQuestoesRevisaoRequestModel;
  ListarQuestoesRevisaoResponseModel: ListarQuestoesRevisaoResponseModel;
  MetaSemanalResponseModel: MetaSemanalResponseModel;
  ObterEstatisticasAssuntosRequestModel: ObterEstatisticasAssuntosRequestModel;
  ObterMetaSemanalRequestModel: ObterMetaSemanalRequestModel;
  ObterResumoRevisaoRequestModel: ObterResumoRevisaoRequestModel;
  PrepararTreinoRequestModel: PrepararTreinoRequestModel;
  ProgressoDiaResponseModel: ProgressoDiaResponseModel;
  QuestaoRevisaoResponseModel: QuestaoRevisaoResponseModel;
  ResumoRevisaoResponseModel: ResumoRevisaoResponseModel;
  SalvarMetaSemanalRequestModel: SalvarMetaSemanalRequestModel;
  AtualizarMinhaContaRequestModel: AtualizarMinhaContaRequestModel;
  DadosPessoaRequestModel: DadosPessoaRequestModel;
  ListarUsuariosRequestModel: ListarUsuariosRequestModel;
  ListarUsuariosResponseModel: ListarUsuariosResponseModel;
  MinhaContaResponseModel: MinhaContaResponseModel;
  ObterMeuUsuarioRequestModel: ObterMeuUsuarioRequestModel;
  ObterMinhaContaRequestModel: ObterMinhaContaRequestModel;
  ObterUsuarioRequestModel: ObterUsuarioRequestModel;
  PessoaResponseModel: PessoaResponseModel;
  UsuarioResponseModel: UsuarioResponseModel;
  ConsultarCepRequestModel: ConsultarCepRequestModel;
  ConsultarCepResponseModel: ConsultarCepResponseModel;
  AnaliseQuestaoResponseModel: AnaliseQuestaoResponseModel;
  ConsultarAnaliseQuestaoRequestModel: ConsultarAnaliseQuestaoRequestModel;
  ConsultarAnaliseQuestaoResponseModel: ConsultarAnaliseQuestaoResponseModel;
  ConteudoAnaliseQuestaoResponseModel: ConteudoAnaliseQuestaoResponseModel;
  JustificativaAlternativaResponseModel: JustificativaAlternativaResponseModel;
  SolicitarAnaliseQuestaoRequestModel: SolicitarAnaliseQuestaoRequestModel;
  ValidarAnaliseQuestaoRequestModel: ValidarAnaliseQuestaoRequestModel;
  AtualizarProvaRequestModel: AtualizarProvaRequestModel;
  CriarProvaRequestModel: CriarProvaRequestModel;
  IniciarProvaRequestModel: IniciarProvaRequestModel;
  ListarPendenciasProvasRequestModel: ListarPendenciasProvasRequestModel;
  ListarPendenciasProvasResponseModel: ListarPendenciasProvasResponseModel;
  ListarProvasRequestModel: ListarProvasRequestModel;
  ListarProvasResponseModel: ListarProvasResponseModel;
  ListarTemasRequestModel: ListarTemasRequestModel;
  ListarTemasResponseModel: ListarTemasResponseModel;
  ObterProvaRequestModel: ObterProvaRequestModel;
  PendenciaProvaResponseModel: PendenciaProvaResponseModel;
  ProvaResponseModel: ProvaResponseModel;
  TemaResponseModel: TemaResponseModel;
  AlternativaQuestaoRequestModel: AlternativaQuestaoRequestModel;
  AlternativaQuestaoResponseModel: AlternativaQuestaoResponseModel;
  AlternativaVinculadaResponseModel: AlternativaVinculadaResponseModel;
  ArquivarQuestaoRequestModel: ArquivarQuestaoRequestModel;
  AtualizarQuestaoRequestModel: AtualizarQuestaoRequestModel;
  CriarQuestaoRequestModel: CriarQuestaoRequestModel;
  GabaritoQuestaoResponseModel: GabaritoQuestaoResponseModel;
  ListarQuestoesRequestModel: ListarQuestoesRequestModel;
  ListarQuestoesResponseModel: ListarQuestoesResponseModel;
  ObterQuestaoRequestModel: ObterQuestaoRequestModel;
  QuestaoPublicaResponseModel: QuestaoPublicaResponseModel;
  QuestaoResponseModel: QuestaoResponseModel;
  AtualizarSimuladoRequestModel: AtualizarSimuladoRequestModel;
  ComposicaoSimuladoResponseModel: ComposicaoSimuladoResponseModel;
  CorrecaoBancoResponseModel: CorrecaoBancoResponseModel;
  CotaAssuntoRequestModel: CotaAssuntoRequestModel;
  CotaTemaRequestModel: CotaTemaRequestModel;
  CriarSimuladoFiltradoRequestModel: CriarSimuladoFiltradoRequestModel;
  CriarSimuladoRequestModel: CriarSimuladoRequestModel;
  DisponibilidadeAssuntoResponseModel: DisponibilidadeAssuntoResponseModel;
  DisponibilidadeAssuntosResponseModel: DisponibilidadeAssuntosResponseModel;
  FinalizarTentativaSimuladoRequestModel: FinalizarTentativaSimuladoRequestModel;
  GerarSimuladoPersonalizadoRequestModel: GerarSimuladoPersonalizadoRequestModel;
  GerarSimuladoResponseModel: GerarSimuladoResponseModel;
  IniciarTentativaSimuladoRequestModel: IniciarTentativaSimuladoRequestModel;
  ItemCorrecaoBancoResponseModel: ItemCorrecaoBancoResponseModel;
  ItemResultadoTentativaResponseModel: ItemResultadoTentativaResponseModel;
  ListarMinhasTentativasRequestModel: ListarMinhasTentativasRequestModel;
  ListarSimuladosRequestModel: ListarSimuladosRequestModel;
  ListarSimuladosResponseModel: ListarSimuladosResponseModel;
  ListarTentativasResponseModel: ListarTentativasResponseModel;
  ObterDisponibilidadeAssuntosRequestModel: ObterDisponibilidadeAssuntosRequestModel;
  ObterQuestoesTentativaRequestModel: ObterQuestoesTentativaRequestModel;
  ObterResultadoTentativaRequestModel: ObterResultadoTentativaRequestModel;
  ObterSimuladoRequestModel: ObterSimuladoRequestModel;
  ObterTentativaSimuladoRequestModel: ObterTentativaSimuladoRequestModel;
  QuestoesTentativaResponseModel: QuestoesTentativaResponseModel;
  ResponderQuestaoSimuladoRequestModel: ResponderQuestaoSimuladoRequestModel;
  RespostaTentativaResponseModel: RespostaTentativaResponseModel;
  RespostaTentativaVinculadaResponseModel: RespostaTentativaVinculadaResponseModel;
  ResultadoTentativaResponseModel: ResultadoTentativaResponseModel;
  SimuladoResponseModel: SimuladoResponseModel;
  TentativaSimuladoResponseModel: TentativaSimuladoResponseModel;
  VerificarSistemaRequestModel: VerificarSistemaRequestModel;
  VerificarSistemaResponseModel: VerificarSistemaResponseModel;
  AbrirChamadoRequestModel: AbrirChamadoRequestModel;
  ChamadoSuporteResponseModel: ChamadoSuporteResponseModel;
  FinalizarChamadoRequestModel: FinalizarChamadoRequestModel;
  ListarChamadosRequestModel: ListarChamadosRequestModel;
  ListarChamadosResponseModel: ListarChamadosResponseModel;
  MensagemChamadoResponseModel: MensagemChamadoResponseModel;
  ObterChamadoRequestModel: ObterChamadoRequestModel;
  ResponderChamadoRequestModel: ResponderChamadoRequestModel;
}
