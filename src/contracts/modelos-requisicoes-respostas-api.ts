// Contratos HTTP extraídos da API .NET. Cada domínio possui seu próprio arquivo em ./modelos/.

export interface RespostaPadraoApi<T> {
  success: boolean;
  message: string;
  statusCode: number;
  data: T | null;
}

import type * as administracao_sistema from "./modelos/administracao-sistema.js";

export type * from "./modelos/administracao-sistema.js";

import type * as autenticacao_contas_sessoes from "./modelos/autenticacao-contas-sessoes.js";

export type * from "./modelos/autenticacao-contas-sessoes.js";

import type * as cadastro_assuntos from "./modelos/cadastro-assuntos.js";

export type * from "./modelos/cadastro-assuntos.js";

import type * as cadastro_bancas from "./modelos/cadastro-bancas.js";

export type * from "./modelos/cadastro-bancas.js";

import type * as cadastro_concursos from "./modelos/cadastro-concursos.js";

export type * from "./modelos/cadastro-concursos.js";

import type * as cadastro_disciplinas from "./modelos/cadastro-disciplinas.js";

export type * from "./modelos/cadastro-disciplinas.js";

import type * as comunicacao_emails from "./modelos/comunicacao-emails.js";

export type * from "./modelos/comunicacao-emails.js";

import type * as estudo_revisao_metas from "./modelos/estudo-revisao-metas.js";

export type * from "./modelos/estudo-revisao-metas.js";

import type * as identidade_usuarios from "./modelos/identidade-usuarios.js";

export type * from "./modelos/identidade-usuarios.js";

import type * as integracoes_enderecos from "./modelos/integracoes-enderecos.js";

export type * from "./modelos/integracoes-enderecos.js";

import type * as analise_questoes_inteligencia_artificial from "./modelos/analise-questoes-inteligencia-artificial.js";

export type * from "./modelos/analise-questoes-inteligencia-artificial.js";

import type * as provas_catalogo from "./modelos/provas-catalogo.js";

export type * from "./modelos/provas-catalogo.js";

import type * as questoes_alternativas_gabaritos from "./modelos/questoes-alternativas-gabaritos.js";

export type * from "./modelos/questoes-alternativas-gabaritos.js";

import type * as simulados_tentativas_correcao from "./modelos/simulados-tentativas-correcao.js";

export type * from "./modelos/simulados-tentativas-correcao.js";

import type * as monitoramento_sistema from "./modelos/monitoramento-sistema.js";

export type * from "./modelos/monitoramento-sistema.js";

import type * as chamados_suporte from "./modelos/chamados-suporte.js";

export type * from "./modelos/chamados-suporte.js";

export interface MapaModelosContratosApi {
  MetricasSistemaResponseModel: administracao_sistema.MetricasSistemaResponseModel;

  ObterMetricasSistemaRequestModel: administracao_sistema.ObterMetricasSistemaRequestModel;

  AtualizarSenhaRequestModel: autenticacao_contas_sessoes.AtualizarSenhaRequestModel;

  CadastrarEstudanteRequestModel: autenticacao_contas_sessoes.CadastrarEstudanteRequestModel;

  CadastroEstudanteResponseModel: autenticacao_contas_sessoes.CadastroEstudanteResponseModel;

  ConcluirGoogleRequestModel: autenticacao_contas_sessoes.ConcluirGoogleRequestModel;

  ConfiguracaoAcessoResponseModel: autenticacao_contas_sessoes.ConfiguracaoAcessoResponseModel;

  ConfirmarEmailAutenticacaoRequestModel: autenticacao_contas_sessoes.ConfirmarEmailAutenticacaoRequestModel;

  EntrarAdministradorRequestModel: autenticacao_contas_sessoes.EntrarAdministradorRequestModel;

  EntrarContaRequestModel: autenticacao_contas_sessoes.EntrarContaRequestModel;

  EntrarEstudanteRequestModel: autenticacao_contas_sessoes.EntrarEstudanteRequestModel;

  FluxoGoogleResponseModel: autenticacao_contas_sessoes.FluxoGoogleResponseModel;

  IniciarGoogleRequestModel: autenticacao_contas_sessoes.IniciarGoogleRequestModel;

  IniciarVinculoGoogleRequestModel: autenticacao_contas_sessoes.IniciarVinculoGoogleRequestModel;

  MensagemAutenticacaoResponseModel: autenticacao_contas_sessoes.MensagemAutenticacaoResponseModel;

  ObterConfiguracaoAcessoRequestModel: autenticacao_contas_sessoes.ObterConfiguracaoAcessoRequestModel;

  ObterVinculoGoogleRequestModel: autenticacao_contas_sessoes.ObterVinculoGoogleRequestModel;

  RedefinirSenhaRequestModel: autenticacao_contas_sessoes.RedefinirSenhaRequestModel;

  ReenviarConfirmacaoRequestModel: autenticacao_contas_sessoes.ReenviarConfirmacaoRequestModel;

  RenovarSessaoNavegadorRequestModel: autenticacao_contas_sessoes.RenovarSessaoNavegadorRequestModel;

  RenovarSessaoRequestModel: autenticacao_contas_sessoes.RenovarSessaoRequestModel;

  SairSessaoRequestModel: autenticacao_contas_sessoes.SairSessaoRequestModel;

  SessaoNavegadorResponseModel: autenticacao_contas_sessoes.SessaoNavegadorResponseModel;

  SessaoResponseModel: autenticacao_contas_sessoes.SessaoResponseModel;

  SolicitarRecuperacaoSenhaRequestModel: autenticacao_contas_sessoes.SolicitarRecuperacaoSenhaRequestModel;

  TrocarCodigoGoogleRequestModel: autenticacao_contas_sessoes.TrocarCodigoGoogleRequestModel;

  UrlGoogleResponseModel: autenticacao_contas_sessoes.UrlGoogleResponseModel;

  VinculoGoogleResponseModel: autenticacao_contas_sessoes.VinculoGoogleResponseModel;

  AssuntoResponseModel: cadastro_assuntos.AssuntoResponseModel;

  AtualizarAssuntoRequestModel: cadastro_assuntos.AtualizarAssuntoRequestModel;

  CriarAssuntoRequestModel: cadastro_assuntos.CriarAssuntoRequestModel;

  ExcluirAssuntoRequestModel: cadastro_assuntos.ExcluirAssuntoRequestModel;

  ListarAssuntosRequestModel: cadastro_assuntos.ListarAssuntosRequestModel;

  ListarAssuntosResponseModel: cadastro_assuntos.ListarAssuntosResponseModel;

  ObterAssuntoRequestModel: cadastro_assuntos.ObterAssuntoRequestModel;

  AtualizarBancaRequestModel: cadastro_bancas.AtualizarBancaRequestModel;

  BancaResponseModel: cadastro_bancas.BancaResponseModel;

  CriarBancaRequestModel: cadastro_bancas.CriarBancaRequestModel;

  ExcluirBancaRequestModel: cadastro_bancas.ExcluirBancaRequestModel;

  ListarBancasRequestModel: cadastro_bancas.ListarBancasRequestModel;

  ListarBancasResponseModel: cadastro_bancas.ListarBancasResponseModel;

  ObterBancaRequestModel: cadastro_bancas.ObterBancaRequestModel;

  AtualizarConcursoRequestModel: cadastro_concursos.AtualizarConcursoRequestModel;

  ConcursoResponseModel: cadastro_concursos.ConcursoResponseModel;

  CriarConcursoRequestModel: cadastro_concursos.CriarConcursoRequestModel;

  ExcluirConcursoRequestModel: cadastro_concursos.ExcluirConcursoRequestModel;

  ListarConcursosRequestModel: cadastro_concursos.ListarConcursosRequestModel;

  ListarConcursosResponseModel: cadastro_concursos.ListarConcursosResponseModel;

  ObterConcursoRequestModel: cadastro_concursos.ObterConcursoRequestModel;

  AtualizarDisciplinaRequestModel: cadastro_disciplinas.AtualizarDisciplinaRequestModel;

  CriarDisciplinaRequestModel: cadastro_disciplinas.CriarDisciplinaRequestModel;

  DesativarDisciplinaRequestModel: cadastro_disciplinas.DesativarDisciplinaRequestModel;

  DisciplinaResponseModel: cadastro_disciplinas.DisciplinaResponseModel;

  ListarDisciplinasRequestModel: cadastro_disciplinas.ListarDisciplinasRequestModel;

  ListarDisciplinasResponseModel: cadastro_disciplinas.ListarDisciplinasResponseModel;

  ObterDisciplinaRequestModel: cadastro_disciplinas.ObterDisciplinaRequestModel;

  AtualizarFluxoEmailRequestModel: comunicacao_emails.AtualizarFluxoEmailRequestModel;

  EmailTransacionalResponseModel: comunicacao_emails.EmailTransacionalResponseModel;

  FluxoEmailResponseModel: comunicacao_emails.FluxoEmailResponseModel;

  ListarEmailsTransacionaisRequestModel: comunicacao_emails.ListarEmailsTransacionaisRequestModel;

  ListarEmailsTransacionaisResponseModel: comunicacao_emails.ListarEmailsTransacionaisResponseModel;

  ListarFluxosEmailRequestModel: comunicacao_emails.ListarFluxosEmailRequestModel;

  ListarFluxosEmailResponseModel: comunicacao_emails.ListarFluxosEmailResponseModel;

  MetricasEmailsResponseModel: comunicacao_emails.MetricasEmailsResponseModel;

  ObterMetricasEmailsRequestModel: comunicacao_emails.ObterMetricasEmailsRequestModel;

  ObterPreferenciaComunicacaoRequestModel: comunicacao_emails.ObterPreferenciaComunicacaoRequestModel;

  PreferenciaComunicacaoRequestModel: comunicacao_emails.PreferenciaComunicacaoRequestModel;

  PreferenciaComunicacaoResponseModel: comunicacao_emails.PreferenciaComunicacaoResponseModel;

  RegistrarEventoEntregaRequestModel: comunicacao_emails.RegistrarEventoEntregaRequestModel;

  RegistrarEventoEntregaResponseModel: comunicacao_emails.RegistrarEventoEntregaResponseModel;

  ReprocessarEmailRequestModel: comunicacao_emails.ReprocessarEmailRequestModel;

  ReprocessarEmailResponseModel: comunicacao_emails.ReprocessarEmailResponseModel;

  EstatisticaAssuntoResponseModel: estudo_revisao_metas.EstatisticaAssuntoResponseModel;

  EstatisticasAssuntosResponseModel: estudo_revisao_metas.EstatisticasAssuntosResponseModel;

  GerarTreinoRecomendadoRequestModel: estudo_revisao_metas.GerarTreinoRecomendadoRequestModel;

  GerarTreinoRevisaoRequestModel: estudo_revisao_metas.GerarTreinoRevisaoRequestModel;

  ListarQuestoesRevisaoRequestModel: estudo_revisao_metas.ListarQuestoesRevisaoRequestModel;

  ListarQuestoesRevisaoResponseModel: estudo_revisao_metas.ListarQuestoesRevisaoResponseModel;

  MetaSemanalResponseModel: estudo_revisao_metas.MetaSemanalResponseModel;

  ObterEstatisticasAssuntosRequestModel: estudo_revisao_metas.ObterEstatisticasAssuntosRequestModel;

  ObterMetaSemanalRequestModel: estudo_revisao_metas.ObterMetaSemanalRequestModel;

  ObterResumoRevisaoRequestModel: estudo_revisao_metas.ObterResumoRevisaoRequestModel;

  PrepararTreinoRequestModel: estudo_revisao_metas.PrepararTreinoRequestModel;

  ProgressoDiaResponseModel: estudo_revisao_metas.ProgressoDiaResponseModel;

  QuestaoRevisaoResponseModel: estudo_revisao_metas.QuestaoRevisaoResponseModel;

  ResumoRevisaoResponseModel: estudo_revisao_metas.ResumoRevisaoResponseModel;

  SalvarMetaSemanalRequestModel: estudo_revisao_metas.SalvarMetaSemanalRequestModel;

  AtualizarMinhaContaRequestModel: identidade_usuarios.AtualizarMinhaContaRequestModel;

  DadosPessoaRequestModel: identidade_usuarios.DadosPessoaRequestModel;

  ListarUsuariosRequestModel: identidade_usuarios.ListarUsuariosRequestModel;

  ListarUsuariosResponseModel: identidade_usuarios.ListarUsuariosResponseModel;

  MinhaContaResponseModel: identidade_usuarios.MinhaContaResponseModel;

  ObterMeuUsuarioRequestModel: identidade_usuarios.ObterMeuUsuarioRequestModel;

  ObterMinhaContaRequestModel: identidade_usuarios.ObterMinhaContaRequestModel;

  ObterUsuarioRequestModel: identidade_usuarios.ObterUsuarioRequestModel;

  PessoaResponseModel: identidade_usuarios.PessoaResponseModel;

  UsuarioResponseModel: identidade_usuarios.UsuarioResponseModel;

  ConsultarCepRequestModel: integracoes_enderecos.ConsultarCepRequestModel;

  ConsultarCepResponseModel: integracoes_enderecos.ConsultarCepResponseModel;

  AnaliseQuestaoResponseModel: analise_questoes_inteligencia_artificial.AnaliseQuestaoResponseModel;

  ConsultarAnaliseQuestaoRequestModel: analise_questoes_inteligencia_artificial.ConsultarAnaliseQuestaoRequestModel;

  ConsultarAnaliseQuestaoResponseModel: analise_questoes_inteligencia_artificial.ConsultarAnaliseQuestaoResponseModel;

  ConteudoAnaliseQuestaoResponseModel: analise_questoes_inteligencia_artificial.ConteudoAnaliseQuestaoResponseModel;

  JustificativaAlternativaResponseModel: analise_questoes_inteligencia_artificial.JustificativaAlternativaResponseModel;

  SolicitarAnaliseQuestaoRequestModel: analise_questoes_inteligencia_artificial.SolicitarAnaliseQuestaoRequestModel;

  ValidarAnaliseQuestaoRequestModel: analise_questoes_inteligencia_artificial.ValidarAnaliseQuestaoRequestModel;

  AtualizarProvaRequestModel: provas_catalogo.AtualizarProvaRequestModel;

  CriarProvaRequestModel: provas_catalogo.CriarProvaRequestModel;

  IniciarProvaRequestModel: provas_catalogo.IniciarProvaRequestModel;

  ListarPendenciasProvasRequestModel: provas_catalogo.ListarPendenciasProvasRequestModel;

  ListarPendenciasProvasResponseModel: provas_catalogo.ListarPendenciasProvasResponseModel;

  ListarProvasRequestModel: provas_catalogo.ListarProvasRequestModel;

  ListarProvasResponseModel: provas_catalogo.ListarProvasResponseModel;

  ListarTemasRequestModel: provas_catalogo.ListarTemasRequestModel;

  ListarTemasResponseModel: provas_catalogo.ListarTemasResponseModel;

  ObterProvaRequestModel: provas_catalogo.ObterProvaRequestModel;

  PendenciaProvaResponseModel: provas_catalogo.PendenciaProvaResponseModel;

  ProvaResponseModel: provas_catalogo.ProvaResponseModel;

  TemaResponseModel: provas_catalogo.TemaResponseModel;

  AlternativaQuestaoRequestModel: questoes_alternativas_gabaritos.AlternativaQuestaoRequestModel;

  AlternativaQuestaoResponseModel: questoes_alternativas_gabaritos.AlternativaQuestaoResponseModel;

  AlternativaVinculadaResponseModel: questoes_alternativas_gabaritos.AlternativaVinculadaResponseModel;

  ArquivarQuestaoRequestModel: questoes_alternativas_gabaritos.ArquivarQuestaoRequestModel;

  AtualizarQuestaoRequestModel: questoes_alternativas_gabaritos.AtualizarQuestaoRequestModel;

  CriarQuestaoRequestModel: questoes_alternativas_gabaritos.CriarQuestaoRequestModel;

  GabaritoQuestaoResponseModel: questoes_alternativas_gabaritos.GabaritoQuestaoResponseModel;

  ListarQuestoesRequestModel: questoes_alternativas_gabaritos.ListarQuestoesRequestModel;

  ListarQuestoesResponseModel: questoes_alternativas_gabaritos.ListarQuestoesResponseModel;

  ObterQuestaoRequestModel: questoes_alternativas_gabaritos.ObterQuestaoRequestModel;

  QuestaoPublicaResponseModel: questoes_alternativas_gabaritos.QuestaoPublicaResponseModel;

  QuestaoResponseModel: questoes_alternativas_gabaritos.QuestaoResponseModel;

  AtualizarSimuladoRequestModel: simulados_tentativas_correcao.AtualizarSimuladoRequestModel;

  ComposicaoSimuladoResponseModel: simulados_tentativas_correcao.ComposicaoSimuladoResponseModel;

  CorrecaoBancoResponseModel: simulados_tentativas_correcao.CorrecaoBancoResponseModel;

  CotaAssuntoRequestModel: simulados_tentativas_correcao.CotaAssuntoRequestModel;

  CotaTemaRequestModel: simulados_tentativas_correcao.CotaTemaRequestModel;

  CriarSimuladoFiltradoRequestModel: simulados_tentativas_correcao.CriarSimuladoFiltradoRequestModel;

  CriarSimuladoRequestModel: simulados_tentativas_correcao.CriarSimuladoRequestModel;

  DisponibilidadeAssuntoResponseModel: simulados_tentativas_correcao.DisponibilidadeAssuntoResponseModel;

  DisponibilidadeAssuntosResponseModel: simulados_tentativas_correcao.DisponibilidadeAssuntosResponseModel;

  FinalizarTentativaSimuladoRequestModel: simulados_tentativas_correcao.FinalizarTentativaSimuladoRequestModel;

  GerarSimuladoPersonalizadoRequestModel: simulados_tentativas_correcao.GerarSimuladoPersonalizadoRequestModel;

  GerarSimuladoResponseModel: simulados_tentativas_correcao.GerarSimuladoResponseModel;

  IniciarTentativaSimuladoRequestModel: simulados_tentativas_correcao.IniciarTentativaSimuladoRequestModel;

  ItemCorrecaoBancoResponseModel: simulados_tentativas_correcao.ItemCorrecaoBancoResponseModel;

  ItemResultadoTentativaResponseModel: simulados_tentativas_correcao.ItemResultadoTentativaResponseModel;

  ListarMinhasTentativasRequestModel: simulados_tentativas_correcao.ListarMinhasTentativasRequestModel;

  ListarSimuladosRequestModel: simulados_tentativas_correcao.ListarSimuladosRequestModel;

  ListarSimuladosResponseModel: simulados_tentativas_correcao.ListarSimuladosResponseModel;

  ListarTentativasResponseModel: simulados_tentativas_correcao.ListarTentativasResponseModel;

  ObterDisponibilidadeAssuntosRequestModel: simulados_tentativas_correcao.ObterDisponibilidadeAssuntosRequestModel;

  ObterQuestoesTentativaRequestModel: simulados_tentativas_correcao.ObterQuestoesTentativaRequestModel;

  ObterResultadoTentativaRequestModel: simulados_tentativas_correcao.ObterResultadoTentativaRequestModel;

  ObterSimuladoRequestModel: simulados_tentativas_correcao.ObterSimuladoRequestModel;

  ObterTentativaSimuladoRequestModel: simulados_tentativas_correcao.ObterTentativaSimuladoRequestModel;

  QuestoesTentativaResponseModel: simulados_tentativas_correcao.QuestoesTentativaResponseModel;

  ResponderQuestaoSimuladoRequestModel: simulados_tentativas_correcao.ResponderQuestaoSimuladoRequestModel;

  RespostaTentativaResponseModel: simulados_tentativas_correcao.RespostaTentativaResponseModel;

  RespostaTentativaVinculadaResponseModel: simulados_tentativas_correcao.RespostaTentativaVinculadaResponseModel;

  ResultadoTentativaResponseModel: simulados_tentativas_correcao.ResultadoTentativaResponseModel;

  SimuladoResponseModel: simulados_tentativas_correcao.SimuladoResponseModel;

  TentativaSimuladoResponseModel: simulados_tentativas_correcao.TentativaSimuladoResponseModel;

  VerificarSistemaRequestModel: monitoramento_sistema.VerificarSistemaRequestModel;

  VerificarSistemaResponseModel: monitoramento_sistema.VerificarSistemaResponseModel;

  AbrirChamadoRequestModel: chamados_suporte.AbrirChamadoRequestModel;

  ChamadoSuporteResponseModel: chamados_suporte.ChamadoSuporteResponseModel;

  FinalizarChamadoRequestModel: chamados_suporte.FinalizarChamadoRequestModel;

  ListarChamadosRequestModel: chamados_suporte.ListarChamadosRequestModel;

  ListarChamadosResponseModel: chamados_suporte.ListarChamadosResponseModel;

  MensagemChamadoResponseModel: chamados_suporte.MensagemChamadoResponseModel;

  ObterChamadoRequestModel: chamados_suporte.ObterChamadoRequestModel;

  ResponderChamadoRequestModel: chamados_suporte.ResponderChamadoRequestModel;
}
