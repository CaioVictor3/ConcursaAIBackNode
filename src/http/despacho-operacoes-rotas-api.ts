import type { Services } from "../application/composicao-servicos-api.js";
import { vincularRequisicaoAoContrato } from "../contracts/validacao-conversao-contratos-api.js";

export function criarDespachoOperacoesApi(services: Services, query: boolean) {
  return {
    "/api/Administracao/obter-metricas-sistema": (input: unknown) =>
      services.obterMetricasSistema(
        vincularRequisicaoAoContrato("ObterMetricasSistemaRequestModel", input, query),
      ),
    "/api/AnaliseQuestao/consultar-analise-questao": (input: unknown) =>
      services.consultarAnaliseQuestao(
        vincularRequisicaoAoContrato("ConsultarAnaliseQuestaoRequestModel", input, query),
      ),
    "/api/AnaliseQuestao/solicitar-analise-questao": (input: unknown) =>
      services.solicitarAnaliseQuestao(
        vincularRequisicaoAoContrato("SolicitarAnaliseQuestaoRequestModel", input, query),
      ),
    "/api/Assunto/listar-assuntos": (input: unknown) =>
      services.listarAssuntos(
        vincularRequisicaoAoContrato("ListarAssuntosRequestModel", input, query),
      ),
    "/api/Assunto/obter-assunto": (input: unknown) =>
      services.obterAssunto(vincularRequisicaoAoContrato("ObterAssuntoRequestModel", input, query)),
    "/api/Assunto/criar-assunto": (input: unknown) =>
      services.criarAssunto(vincularRequisicaoAoContrato("CriarAssuntoRequestModel", input, query)),
    "/api/Assunto/atualizar-assunto": (input: unknown) =>
      services.atualizarAssunto(
        vincularRequisicaoAoContrato("AtualizarAssuntoRequestModel", input, query),
      ),
    "/api/Assunto/excluir-assunto": (input: unknown) =>
      services.excluirAssunto(
        vincularRequisicaoAoContrato("ExcluirAssuntoRequestModel", input, query),
      ),
    "/api/Autenticacao/confirmar-email": (input: unknown) =>
      services.confirmarEmail(
        vincularRequisicaoAoContrato("ConfirmarEmailAutenticacaoRequestModel", input, query),
      ),
    "/api/Autenticacao/redefinir-senha": (input: unknown) =>
      services.redefinirSenha(
        vincularRequisicaoAoContrato("RedefinirSenhaRequestModel", input, query),
      ),
    "/api/Autenticacao/entrar-estudante": (input: unknown) =>
      services.entrarEstudante(
        vincularRequisicaoAoContrato("EntrarEstudanteRequestModel", input, query),
      ),
    "/api/Autenticacao/entrar-administrador": (input: unknown) =>
      services.entrarAdministrador(
        vincularRequisicaoAoContrato("EntrarAdministradorRequestModel", input, query),
      ),
    "/api/Autenticacao/cadastrar-estudante": (input: unknown) =>
      services.cadastrarEstudante(
        vincularRequisicaoAoContrato("CadastrarEstudanteRequestModel", input, query),
      ),
    "/api/Autenticacao/renovar-sessao": (input: unknown) =>
      services.renovarSessao(
        vincularRequisicaoAoContrato("RenovarSessaoRequestModel", input, query),
      ),
    "/api/Autenticacao/solicitar-recuperacao-senha": (input: unknown) =>
      services.solicitarRecuperacaoSenha(
        vincularRequisicaoAoContrato("SolicitarRecuperacaoSenhaRequestModel", input, query),
      ),
    "/api/Autenticacao/reenviar-confirmacao": (input: unknown) =>
      services.reenviarConfirmacao(
        vincularRequisicaoAoContrato("ReenviarConfirmacaoRequestModel", input, query),
      ),
    "/api/Autenticacao/sair-sessao": (input: unknown) =>
      services.sairSessao(vincularRequisicaoAoContrato("SairSessaoRequestModel", input, query)),
    "/api/Autenticacao/atualizar-senha": (input: unknown) =>
      services.atualizarSenha(
        vincularRequisicaoAoContrato("AtualizarSenhaRequestModel", input, query),
      ),
    "/api/Banca/listar-bancas": (input: unknown) =>
      services.listarBancas(vincularRequisicaoAoContrato("ListarBancasRequestModel", input, query)),
    "/api/Banca/obter-banca": (input: unknown) =>
      services.obterBanca(vincularRequisicaoAoContrato("ObterBancaRequestModel", input, query)),
    "/api/Banca/criar-banca": (input: unknown) =>
      services.criarBanca(vincularRequisicaoAoContrato("CriarBancaRequestModel", input, query)),
    "/api/Banca/atualizar-banca": (input: unknown) =>
      services.atualizarBanca(
        vincularRequisicaoAoContrato("AtualizarBancaRequestModel", input, query),
      ),
    "/api/Banca/excluir-banca": (input: unknown) =>
      services.excluirBanca(vincularRequisicaoAoContrato("ExcluirBancaRequestModel", input, query)),
    "/api/Cep/consultar-cep": (input: unknown) =>
      services.consultarCep(vincularRequisicaoAoContrato("ConsultarCepRequestModel", input, query)),
    "/api/Concurso/listar-concursos": (input: unknown) =>
      services.listarConcursos(
        vincularRequisicaoAoContrato("ListarConcursosRequestModel", input, query),
      ),
    "/api/Concurso/obter-concurso": (input: unknown) =>
      services.obterConcurso(
        vincularRequisicaoAoContrato("ObterConcursoRequestModel", input, query),
      ),
    "/api/Concurso/criar-concurso": (input: unknown) =>
      services.criarConcurso(
        vincularRequisicaoAoContrato("CriarConcursoRequestModel", input, query),
      ),
    "/api/Concurso/atualizar-concurso": (input: unknown) =>
      services.atualizarConcurso(
        vincularRequisicaoAoContrato("AtualizarConcursoRequestModel", input, query),
      ),
    "/api/Concurso/excluir-concurso": (input: unknown) =>
      services.excluirConcurso(
        vincularRequisicaoAoContrato("ExcluirConcursoRequestModel", input, query),
      ),
    "/api/Conta/obter-minha-conta": (input: unknown) =>
      services.obterMinhaConta(
        vincularRequisicaoAoContrato("ObterMinhaContaRequestModel", input, query),
      ),
    "/api/Conta/atualizar-minha-conta": (input: unknown) =>
      services.atualizarMinhaConta(
        vincularRequisicaoAoContrato("AtualizarMinhaContaRequestModel", input, query),
      ),
    "/api/Disciplina/listar-disciplinas": (input: unknown) =>
      services.listarDisciplinas(
        vincularRequisicaoAoContrato("ListarDisciplinasRequestModel", input, query),
      ),
    "/api/Disciplina/obter-disciplina": (input: unknown) =>
      services.obterDisciplina(
        vincularRequisicaoAoContrato("ObterDisciplinaRequestModel", input, query),
      ),
    "/api/Disciplina/criar-disciplina": (input: unknown) =>
      services.criarDisciplina(
        vincularRequisicaoAoContrato("CriarDisciplinaRequestModel", input, query),
      ),
    "/api/Disciplina/atualizar-disciplina": (input: unknown) =>
      services.atualizarDisciplina(
        vincularRequisicaoAoContrato("AtualizarDisciplinaRequestModel", input, query),
      ),
    "/api/Disciplina/desativar-disciplina": (input: unknown) =>
      services.desativarDisciplina(
        vincularRequisicaoAoContrato("DesativarDisciplinaRequestModel", input, query),
      ),
    "/api/EmailsTransacionais/listar-historico": (input: unknown) =>
      services.listarHistorico(
        vincularRequisicaoAoContrato("ListarEmailsTransacionaisRequestModel", input, query),
      ),
    "/api/EmailsTransacionais/obter-metricas": (input: unknown) =>
      services.obterMetricas(
        vincularRequisicaoAoContrato("ObterMetricasEmailsRequestModel", input, query),
      ),
    "/api/EmailsTransacionais/reprocessar-falha": (input: unknown) =>
      services.reprocessarFalha(
        vincularRequisicaoAoContrato("ReprocessarEmailRequestModel", input, query),
      ),
    "/api/EmailsTransacionais/listar-fluxos": (input: unknown) =>
      services.listarFluxos(
        vincularRequisicaoAoContrato("ListarFluxosEmailRequestModel", input, query),
      ),
    "/api/EmailsTransacionais/atualizar-fluxo": (input: unknown) =>
      services.atualizarFluxo(
        vincularRequisicaoAoContrato("AtualizarFluxoEmailRequestModel", input, query),
      ),
    "/api/Estudo/obter-resumo-revisao": (input: unknown) =>
      services.obterResumoRevisao(
        vincularRequisicaoAoContrato("ObterResumoRevisaoRequestModel", input, query),
      ),
    "/api/Estudo/listar-questoes-revisao": (input: unknown) =>
      services.listarQuestoesRevisao(
        vincularRequisicaoAoContrato("ListarQuestoesRevisaoRequestModel", input, query),
      ),
    "/api/Estudo/gerar-treino-revisao": (input: unknown) =>
      services.gerarTreinoRevisao(
        vincularRequisicaoAoContrato("GerarTreinoRevisaoRequestModel", input, query),
      ),
    "/api/Estudo/gerar-treino-recomendado": (input: unknown) =>
      services.gerarTreinoRecomendado(
        vincularRequisicaoAoContrato("GerarTreinoRecomendadoRequestModel", input, query),
      ),
    "/api/Estudo/obter-estatisticas-assuntos": (input: unknown) =>
      services.obterEstatisticasAssuntos(
        vincularRequisicaoAoContrato("ObterEstatisticasAssuntosRequestModel", input, query),
      ),
    "/api/Estudo/obter-meta-semanal": (input: unknown) =>
      services.obterMetaSemanal(
        vincularRequisicaoAoContrato("ObterMetaSemanalRequestModel", input, query),
      ),
    "/api/Estudo/salvar-meta-semanal": (input: unknown) =>
      services.salvarMetaSemanal(
        vincularRequisicaoAoContrato("SalvarMetaSemanalRequestModel", input, query),
      ),
    "/api/PreferenciaComunicacao/obter-minha-preferencia": (input: unknown) =>
      services.obterMinhaPreferencia(
        vincularRequisicaoAoContrato("ObterPreferenciaComunicacaoRequestModel", input, query),
      ),
    "/api/PreferenciaComunicacao/atualizar-minha-preferencia": (input: unknown) =>
      services.atualizarMinhaPreferencia(
        vincularRequisicaoAoContrato("PreferenciaComunicacaoRequestModel", input, query),
      ),
    "/api/Prova/listar-provas": (input: unknown) =>
      services.listarProvas(vincularRequisicaoAoContrato("ListarProvasRequestModel", input, query)),
    "/api/Prova/obter-prova": (input: unknown) =>
      services.obterProva(vincularRequisicaoAoContrato("ObterProvaRequestModel", input, query)),
    "/api/Prova/listar-temas": (input: unknown) =>
      services.listarTemas(vincularRequisicaoAoContrato("ListarTemasRequestModel", input, query)),
    "/api/Prova/criar-prova": (input: unknown) =>
      services.criarProva(vincularRequisicaoAoContrato("CriarProvaRequestModel", input, query)),
    "/api/Prova/atualizar-prova": (input: unknown) =>
      services.atualizarProva(
        vincularRequisicaoAoContrato("AtualizarProvaRequestModel", input, query),
      ),
    "/api/Prova/listar-pendencias-provas": (input: unknown) =>
      services.listarPendenciasProvas(
        vincularRequisicaoAoContrato("ListarPendenciasProvasRequestModel", input, query),
      ),
    "/api/Prova/iniciar-prova": (input: unknown) =>
      services.iniciarProva(vincularRequisicaoAoContrato("IniciarProvaRequestModel", input, query)),
    "/api/Questao/listar-questoes": (input: unknown) =>
      services.listarQuestoes(
        vincularRequisicaoAoContrato("ListarQuestoesRequestModel", input, query),
      ),
    "/api/Questao/obter-questao": (input: unknown) =>
      services.obterQuestao(vincularRequisicaoAoContrato("ObterQuestaoRequestModel", input, query)),
    "/api/Questao/criar-questao": (input: unknown) =>
      services.criarQuestao(vincularRequisicaoAoContrato("CriarQuestaoRequestModel", input, query)),
    "/api/Questao/atualizar-questao": (input: unknown) =>
      services.atualizarQuestao(
        vincularRequisicaoAoContrato("AtualizarQuestaoRequestModel", input, query),
      ),
    "/api/Questao/arquivar-questao": (input: unknown) =>
      services.arquivarQuestao(
        vincularRequisicaoAoContrato("ArquivarQuestaoRequestModel", input, query),
      ),
    "/api/Simulado/criar-simulado-filtrado": (input: unknown) =>
      services.criarSimuladoFiltrado(
        vincularRequisicaoAoContrato("CriarSimuladoFiltradoRequestModel", input, query),
      ),
    "/api/Simulado/listar-simulados": (input: unknown) =>
      services.listarSimulados(
        vincularRequisicaoAoContrato("ListarSimuladosRequestModel", input, query),
      ),
    "/api/Simulado/obter-simulado": (input: unknown) =>
      services.obterSimulado(
        vincularRequisicaoAoContrato("ObterSimuladoRequestModel", input, query),
      ),
    "/api/Simulado/criar-simulado": (input: unknown) =>
      services.criarSimulado(
        vincularRequisicaoAoContrato("CriarSimuladoRequestModel", input, query),
      ),
    "/api/Simulado/atualizar-simulado": (input: unknown) =>
      services.atualizarSimulado(
        vincularRequisicaoAoContrato("AtualizarSimuladoRequestModel", input, query),
      ),
    "/api/Simulado/gerar-simulado-personalizado": (input: unknown) =>
      services.gerarSimuladoPersonalizado(
        vincularRequisicaoAoContrato("GerarSimuladoPersonalizadoRequestModel", input, query),
      ),
    "/api/Simulado/obter-disponibilidade-assuntos": (input: unknown) =>
      services.obterDisponibilidadeAssuntos(
        vincularRequisicaoAoContrato("ObterDisponibilidadeAssuntosRequestModel", input, query),
      ),
    "/api/Sistema/verificar-sistema": (input: unknown) =>
      services.verificarSistema(
        vincularRequisicaoAoContrato("VerificarSistemaRequestModel", input, query),
      ),
    "/api/Suporte/listar-chamados": (input: unknown) =>
      services.listarChamados(
        vincularRequisicaoAoContrato("ListarChamadosRequestModel", input, query),
      ),
    "/api/Suporte/obter-chamado": (input: unknown) =>
      services.obterChamado(vincularRequisicaoAoContrato("ObterChamadoRequestModel", input, query)),
    "/api/Suporte/abrir-chamado": (input: unknown) =>
      services.abrirChamado(vincularRequisicaoAoContrato("AbrirChamadoRequestModel", input, query)),
    "/api/Suporte/responder-chamado": (input: unknown) =>
      services.responderChamado(
        vincularRequisicaoAoContrato("ResponderChamadoRequestModel", input, query),
      ),
    "/api/Suporte/finalizar-chamado": (input: unknown) =>
      services.finalizarChamado(
        vincularRequisicaoAoContrato("FinalizarChamadoRequestModel", input, query),
      ),
    "/api/Tentativa/iniciar-tentativa-simulado": (input: unknown) =>
      services.iniciarTentativaSimulado(
        vincularRequisicaoAoContrato("IniciarTentativaSimuladoRequestModel", input, query),
      ),
    "/api/Tentativa/obter-tentativa-simulado": (input: unknown) =>
      services.obterTentativaSimulado(
        vincularRequisicaoAoContrato("ObterTentativaSimuladoRequestModel", input, query),
      ),
    "/api/Tentativa/responder-questao-simulado": (input: unknown) =>
      services.responderQuestaoSimulado(
        vincularRequisicaoAoContrato("ResponderQuestaoSimuladoRequestModel", input, query),
      ),
    "/api/Tentativa/finalizar-tentativa-simulado": (input: unknown) =>
      services.finalizarTentativaSimulado(
        vincularRequisicaoAoContrato("FinalizarTentativaSimuladoRequestModel", input, query),
      ),
    "/api/Tentativa/obter-resultado-tentativa": (input: unknown) =>
      services.obterResultadoTentativa(
        vincularRequisicaoAoContrato("ObterResultadoTentativaRequestModel", input, query),
      ),
    "/api/Tentativa/listar-minhas-tentativas": (input: unknown) =>
      services.listarMinhasTentativas(
        vincularRequisicaoAoContrato("ListarMinhasTentativasRequestModel", input, query),
      ),
    "/api/Tentativa/obter-questoes-tentativa": (input: unknown) =>
      services.obterQuestoesTentativa(
        vincularRequisicaoAoContrato("ObterQuestoesTentativaRequestModel", input, query),
      ),
    "/api/Usuario/obter-meu-usuario": (input: unknown) =>
      services.obterMeuUsuario(
        vincularRequisicaoAoContrato("ObterMeuUsuarioRequestModel", input, query),
      ),
    "/api/Usuario/listar-usuarios": (input: unknown) =>
      services.listarUsuarios(
        vincularRequisicaoAoContrato("ListarUsuariosRequestModel", input, query),
      ),
    "/api/Usuario/obter-usuario": (input: unknown) =>
      services.obterUsuario(vincularRequisicaoAoContrato("ObterUsuarioRequestModel", input, query)),
  };
}
