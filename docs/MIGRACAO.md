# Inventário e checklist da migração

Origem: `../ConcursaAI.BackEnd`. Destino: `ConcursaIA.BackNode`. Inspeção inicial: 22/10/2026. O inventário inclui 469 arquivos relevantes, 172 DTOs, 96 endpoints e 21 projeções de tabelas/views. Os hashes estão em `source-inventory.json`; arquivos de build, caches, skills e artefatos gerados não integram esse conjunto. Valores de secrets não foram exportados.

## Arquitetura

- `src/config`: variáveis de ambiente e validação.
- `src/contracts`: 172 interfaces TypeScript distribuídas em 16 arquivos por domínio; metadados de serialização, defaults, validação, rotas e whitelist de tabelas extraídos da origem.
- `src/domain`: erros, invariantes e validação de dados pessoais.
- `src/application`: services modulares; regras fora dos controllers.
- `src/infrastructure`: PostgreSQL, transações/RLS, contas/sessões, cifragem, clientes OpenAI, Google e ViaCEP em arquivos próprios, envio de emails e worker separado.
- `src/http`: despacho tipado, transporte de navegador, cookies e OpenAPI.
- `src/aplicacao-http-express.ts`: composição explícita das dependências e pipeline HTTP. `src/servidor-http.ts`: listen e shutdown.
- `database/reference`: migrations, schema e testes SQL históricos preservados; usados apenas no banco isolado pelos testes.
- `tools/importacao`: importação real com validação, progresso e retomada, apontando para a API Node.

Tecnologias: Node.js 24 LTS como alvo de deploy, TypeScript estrito, Express 5, pg, jose, bcryptjs, Pino, Helmet, CORS, express-rate-limit, dotenv e Swagger UI. Testes usam node:test, Supertest, tsx e PostgreSQL real via embedded-postgres.

Foram preservados Express 5 e o acesso nativo ao PostgreSQL; não foi introduzido NestJS, ORM substituto, fila externa ou container de DI. Repository, adaptadores de provedores e composição por construtores resolvem as fronteiras existentes.

## Checklist funcional

| Estado local | Recurso original | Equivalente Node / evidência |
| --- | --- | --- |
| [x] | Cadastros e hierarquia de assuntos, duplicidade, vínculos, arquivamento/desativação | `src/application/cadastro-bancas.service.ts`, `src/application/cadastro-disciplinas.service.ts`, `src/application/cadastro-assuntos.service.ts`, `src/application/cadastro-concursos.service.ts`; integração HTTP e comparação .NET |
| [x] | Provas, temas, pendências, questão única por número, organização e início integral | `src/application/consulta-cadastro-provas.service.ts`; funções SQL preservadas; testes SQL/HTTP |
| [x] | Questões, alternativas, explicação, gabarito e restrições de edição | `src/application/cadastro-questoes-alternativas-gabaritos.service.ts`; projeções protegidas e correção autorizada |
| [x] | Simulados públicos/pessoais, seleção aleatória, filtros e cotas por assunto/tema | `src/application/geracao-cadastro-simulados.service.ts`, `src/application/validacao-cotas-simulados.service.ts`; regras e funções originais; testes SQL/HTTP |
| [x] | Tentativas, retomada, respostas, correção, pontuação, anuladas/sem gabarito e tempo | `src/application/resolucao-correcao-tentativas.service.ts`; funções transacionais originais; testes SQL/HTTP |
| [x] | Revisão espaçada, recomendação, estatísticas e metas semanais | `src/application/revisao-questoes-metas-estudo.service.ts`; testes SQL originais e endpoints |
| [x] | Minha conta, dados pessoais, CPF/endereço, perfis e métricas administrativas | `src/application/dados-conta-usuarios-administracao.service.ts`, `src/domain/validacao-dados-pessoais.ts` |
| [x] | Suporte, propriedade, mensagens, atribuição e encerramento | `src/application/chamados-suporte.service.ts`; testes entre usuários e administrador |
| [x] | Cadastro, login aluno/admin, bloqueio, confirmação, recuperação e troca de senha | `src/application/autenticacao-contas-sessoes.service.ts`, `src/infrastructure/repositorio-contas-sessoes-postgresql.ts`; HTTP com PostgreSQL real |
| [x] | ASP.NET PBKDF2 v2/v3, bcrypt legado e atualização condicional de hash | `src/infrastructure/criptografia-senhas-tokens-links.ts`; testes criptográficos e persistência |
| [x] | JWT, sessões, refresh rotativo, detecção de replay, revogação e versão de credenciais | `src/application/autenticacao-contas-sessoes.service.ts`, `src/infrastructure/repositorio-contas-sessoes-postgresql.ts`; teste de replay real |
| [x] | Google OAuth/OIDC, PKCE, state, nonce, JWKS, email verificado e vínculo explícito | `src/infrastructure/cliente-autenticacao-google.ts`, `src/application/autenticacao-contas-sessoes.service.ts`, `src/http/cookies-sessao-navegador.ts`; JWT RSA de teste e banco real |
| [x] | Cookies, proteção Origin/header, renovação e logout de navegador | `src/http/cookies-sessao-navegador.ts`, `src/aplicacao-http-express.ts`; testes com agente HTTP e HttpOnly |
| [x] | IA explícita para resposta incorreta, cota, reserva, concorrência, cache e limpeza de falha | `src/application/analise-questoes-inteligencia-artificial.service.ts`; funções SQL preservadas e provedor controlado no teste |
| [x] | OpenAI Responses, modelo, schema, prompt, timeouts, recusa e store=false | `src/infrastructure/cliente-analise-questoes-openai.ts`; request/response testados sem cobrança |
| [x] | Consulta ViaCEP e limite por IP | `src/infrastructure/cliente-enderecos-viacep.ts`, `src/aplicacao-http-express.ts`; testes e chamada real somente de leitura |
| [x] | Email de confirmação, recuperação, boas-vindas e inatividade | `src/infrastructure/envio-emails-transacionais-resend.ts`, `src/infrastructure/consultas-sql-emails-transacionais.ts`; templates, fila e persistência reais |
| [x] | Worker, lease, SKIP LOCKED, idempotência, retentativas, limpeza por retenção | `src/infrastructure/worker-envio-emails-transacionais.ts`; PostgreSQL real e transporte controlado |
| [x] | Workflows pausáveis, preferência opt-in, histórico, métricas e reprocessamento | `src/application/administracao-emails-transacionais.service.ts`, `src/application/preferencias-comunicacao.service.ts`; testes HTTP/banco |
| [x] | Webhook Resend, HMAC, corpo bruto, janela temporal e eventos fora de ordem | `src/aplicacao-http-express.ts`, `src/infrastructure/envio-emails-transacionais-resend.ts`; teste de assinatura e evento idempotente |
| [x] | PostgreSQL restrito, RLS, claims transacionais, FKs, views, índices, funções e concorrência | `src/infrastructure/conexao-transacoes-postgresql.ts`, `src/infrastructure/repositorio-consultas-postgresql.ts`; sete suítes SQL originais |
| [x] | Erros, envelopes, JSON camelCase, query/body, defaults e números estritos | `src/domain/erros-validacoes-respostas-api.ts`, `src/contracts/validacao-conversao-contratos-api.ts`; comparação HTTP das 96 rotas |
| [x] | CORS, rate limit, logs, health, build, porta/HOST e shutdown | `src/aplicacao-http-express.ts`, `src/servidor-http.ts`; execução real dos scripts npm |
| [x] | Importação administrativa validada e retomável | `tools/importacao/scripts/importar-prova.mjs`; 5 testes |
| [ ] | Homologação Google com credenciais reais | Client ID/secret ausentes |
| [ ] | Homologação OpenAI com credencial real | API key ausente; nenhuma cobrança efetuada |
| [ ] | Homologação Resend, remetente/domínio e webhook reais | API key/remetente/secret ausentes; nenhum email real enviado |
| [ ] | Build efetivo da imagem Docker | Dockerfile entregue; daemon indisponível |

## Endpoints e rastreabilidade

Todos possuem implementação e schema OpenAPI. A verificação HTTP compara GETs com fixtures e mutações com dados vazios; os fluxos positivos e regras relevantes são exercitados separadamente nas suítes de integração. Isso não equivale a uma prova de todos os caminhos possíveis de cada endpoint.

| Método | Rota preservada | Request | Implementação |
| --- | --- | --- | --- |
| GET | `/api/Administracao/obter-metricas-sistema` | `ObterMetricasSistemaRequestModel` (query) | `src/application/dados-conta-usuarios-administracao.service.ts` |
| GET | `/api/AnaliseQuestao/consultar-analise-questao` | `ConsultarAnaliseQuestaoRequestModel` (query) | `src/application/analise-questoes-inteligencia-artificial.service.ts` |
| POST | `/api/AnaliseQuestao/solicitar-analise-questao` | `SolicitarAnaliseQuestaoRequestModel` (body) | `src/application/analise-questoes-inteligencia-artificial.service.ts` |
| GET | `/api/Assunto/listar-assuntos` | `ListarAssuntosRequestModel` (query) | `src/application/cadastro-assuntos.service.ts` |
| GET | `/api/Assunto/obter-assunto` | `ObterAssuntoRequestModel` (query) | `src/application/cadastro-assuntos.service.ts` |
| POST | `/api/Assunto/criar-assunto` | `CriarAssuntoRequestModel` (body) | `src/application/cadastro-assuntos.service.ts` |
| PUT | `/api/Assunto/atualizar-assunto` | `AtualizarAssuntoRequestModel` (body) | `src/application/cadastro-assuntos.service.ts` |
| DELETE | `/api/Assunto/excluir-assunto` | `ExcluirAssuntoRequestModel` (query) | `src/application/cadastro-assuntos.service.ts` |
| POST | `/api/Autenticacao/confirmar-email` | `ConfirmarEmailAutenticacaoRequestModel` (body) | `src/application/autenticacao-contas-sessoes.service.ts` |
| POST | `/api/Autenticacao/redefinir-senha` | `RedefinirSenhaRequestModel` (body) | `src/application/autenticacao-contas-sessoes.service.ts` |
| POST | `/api/Autenticacao/entrar-estudante` | `EntrarEstudanteRequestModel` (body) | `src/application/autenticacao-contas-sessoes.service.ts` |
| POST | `/api/Autenticacao/entrar-administrador` | `EntrarAdministradorRequestModel` (body) | `src/application/autenticacao-contas-sessoes.service.ts` |
| POST | `/api/Autenticacao/cadastrar-estudante` | `CadastrarEstudanteRequestModel` (body) | `src/application/autenticacao-contas-sessoes.service.ts` |
| POST | `/api/Autenticacao/renovar-sessao` | `RenovarSessaoRequestModel` (body) | `src/application/autenticacao-contas-sessoes.service.ts` |
| POST | `/api/Autenticacao/solicitar-recuperacao-senha` | `SolicitarRecuperacaoSenhaRequestModel` (body) | `src/application/autenticacao-contas-sessoes.service.ts` |
| POST | `/api/Autenticacao/reenviar-confirmacao` | `ReenviarConfirmacaoRequestModel` (body) | `src/application/autenticacao-contas-sessoes.service.ts` |
| POST | `/api/Autenticacao/sair-sessao` | `SairSessaoRequestModel` (body) | `src/application/autenticacao-contas-sessoes.service.ts` |
| PUT | `/api/Autenticacao/atualizar-senha` | `AtualizarSenhaRequestModel` (body) | `src/application/autenticacao-contas-sessoes.service.ts` |
| GET | `/api/Banca/listar-bancas` | `ListarBancasRequestModel` (query) | `src/application/cadastro-bancas.service.ts` |
| GET | `/api/Banca/obter-banca` | `ObterBancaRequestModel` (query) | `src/application/cadastro-bancas.service.ts` |
| POST | `/api/Banca/criar-banca` | `CriarBancaRequestModel` (body) | `src/application/cadastro-bancas.service.ts` |
| PUT | `/api/Banca/atualizar-banca` | `AtualizarBancaRequestModel` (body) | `src/application/cadastro-bancas.service.ts` |
| DELETE | `/api/Banca/excluir-banca` | `ExcluirBancaRequestModel` (query) | `src/application/cadastro-bancas.service.ts` |
| GET | `/api/Cep/consultar-cep` | `ConsultarCepRequestModel` (query) | `src/infrastructure/cliente-enderecos-viacep.ts` |
| GET | `/api/Concurso/listar-concursos` | `ListarConcursosRequestModel` (query) | `src/application/cadastro-concursos.service.ts` |
| GET | `/api/Concurso/obter-concurso` | `ObterConcursoRequestModel` (query) | `src/application/cadastro-concursos.service.ts` |
| POST | `/api/Concurso/criar-concurso` | `CriarConcursoRequestModel` (body) | `src/application/cadastro-concursos.service.ts` |
| PUT | `/api/Concurso/atualizar-concurso` | `AtualizarConcursoRequestModel` (body) | `src/application/cadastro-concursos.service.ts` |
| DELETE | `/api/Concurso/excluir-concurso` | `ExcluirConcursoRequestModel` (query) | `src/application/cadastro-concursos.service.ts` |
| GET | `/api/Conta/obter-minha-conta` | `ObterMinhaContaRequestModel` (query) | `src/application/dados-conta-usuarios-administracao.service.ts` |
| PUT | `/api/Conta/atualizar-minha-conta` | `AtualizarMinhaContaRequestModel` (body) | `src/application/dados-conta-usuarios-administracao.service.ts` |
| GET | `/api/Disciplina/listar-disciplinas` | `ListarDisciplinasRequestModel` (query) | `src/application/cadastro-disciplinas.service.ts` |
| GET | `/api/Disciplina/obter-disciplina` | `ObterDisciplinaRequestModel` (query) | `src/application/cadastro-disciplinas.service.ts` |
| POST | `/api/Disciplina/criar-disciplina` | `CriarDisciplinaRequestModel` (body) | `src/application/cadastro-disciplinas.service.ts` |
| PUT | `/api/Disciplina/atualizar-disciplina` | `AtualizarDisciplinaRequestModel` (body) | `src/application/cadastro-disciplinas.service.ts` |
| PATCH | `/api/Disciplina/desativar-disciplina` | `DesativarDisciplinaRequestModel` (body) | `src/application/cadastro-disciplinas.service.ts` |
| GET | `/api/EmailsTransacionais/listar-historico` | `ListarEmailsTransacionaisRequestModel` (query) | `src/application/administracao-emails-transacionais.service.ts` |
| GET | `/api/EmailsTransacionais/obter-metricas` | `ObterMetricasEmailsRequestModel` (query) | `src/application/administracao-emails-transacionais.service.ts` |
| POST | `/api/EmailsTransacionais/reprocessar-falha` | `ReprocessarEmailRequestModel` (body) | `src/application/administracao-emails-transacionais.service.ts` |
| GET | `/api/EmailsTransacionais/listar-fluxos` | `ListarFluxosEmailRequestModel` (query) | `src/application/administracao-emails-transacionais.service.ts` |
| PUT | `/api/EmailsTransacionais/atualizar-fluxo` | `AtualizarFluxoEmailRequestModel` (body) | `src/application/administracao-emails-transacionais.service.ts` |
| GET | `/api/Estudo/obter-resumo-revisao` | `ObterResumoRevisaoRequestModel` (query) | `src/application/revisao-questoes-metas-estudo.service.ts` |
| GET | `/api/Estudo/listar-questoes-revisao` | `ListarQuestoesRevisaoRequestModel` (query) | `src/application/revisao-questoes-metas-estudo.service.ts` |
| POST | `/api/Estudo/gerar-treino-revisao` | `GerarTreinoRevisaoRequestModel` (body) | `src/application/revisao-questoes-metas-estudo.service.ts` |
| POST | `/api/Estudo/gerar-treino-recomendado` | `GerarTreinoRecomendadoRequestModel` (body) | `src/application/revisao-questoes-metas-estudo.service.ts` |
| GET | `/api/Estudo/obter-estatisticas-assuntos` | `ObterEstatisticasAssuntosRequestModel` (query) | `src/application/revisao-questoes-metas-estudo.service.ts` |
| GET | `/api/Estudo/obter-meta-semanal` | `ObterMetaSemanalRequestModel` (query) | `src/application/revisao-questoes-metas-estudo.service.ts` |
| PUT | `/api/Estudo/salvar-meta-semanal` | `SalvarMetaSemanalRequestModel` (body) | `src/application/revisao-questoes-metas-estudo.service.ts` |
| GET | `/api/Navegador/obter-configuracao-acesso` | `ObterConfiguracaoAcessoRequestModel` (query) | `src/http/cookies-sessao-navegador.ts` |
| GET | `/api/Navegador/obter-vinculo-google` | `ObterVinculoGoogleRequestModel` (query) | `src/http/cookies-sessao-navegador.ts` |
| POST | `/api/Navegador/iniciar-vinculo-google` | `IniciarVinculoGoogleRequestModel` (body) | `src/http/cookies-sessao-navegador.ts` |
| POST | `/api/Navegador/iniciar-google` | `IniciarGoogleRequestModel` (body) | `src/http/cookies-sessao-navegador.ts` |
| POST | `/api/Navegador/concluir-google` | `ConcluirGoogleRequestModel` (body) | `src/http/cookies-sessao-navegador.ts` |
| POST | `/api/Navegador/entrar-estudante` | `EntrarEstudanteRequestModel` (body) | `src/http/cookies-sessao-navegador.ts` |
| POST | `/api/Navegador/entrar-administrador` | `EntrarAdministradorRequestModel` (body) | `src/http/cookies-sessao-navegador.ts` |
| POST | `/api/Navegador/renovar-sessao` | `RenovarSessaoNavegadorRequestModel` (body) | `src/http/cookies-sessao-navegador.ts` |
| POST | `/api/Navegador/confirmar-sessao` | `RenovarSessaoRequestModel` (body) | `src/http/cookies-sessao-navegador.ts` |
| POST | `/api/Navegador/sair-sessao` | `SairSessaoRequestModel` (body) | `src/http/cookies-sessao-navegador.ts` |
| GET | `/api/PreferenciaComunicacao/obter-minha-preferencia` | `ObterPreferenciaComunicacaoRequestModel` (query) | `src/application/preferencias-comunicacao.service.ts` |
| PUT | `/api/PreferenciaComunicacao/atualizar-minha-preferencia` | `PreferenciaComunicacaoRequestModel` (body) | `src/application/preferencias-comunicacao.service.ts` |
| GET | `/api/Prova/listar-provas` | `ListarProvasRequestModel` (query) | `src/application/consulta-cadastro-provas.service.ts` |
| GET | `/api/Prova/obter-prova` | `ObterProvaRequestModel` (query) | `src/application/consulta-cadastro-provas.service.ts` |
| GET | `/api/Prova/listar-temas` | `ListarTemasRequestModel` (query) | `src/application/consulta-cadastro-provas.service.ts` |
| POST | `/api/Prova/criar-prova` | `CriarProvaRequestModel` (body) | `src/application/consulta-cadastro-provas.service.ts` |
| PUT | `/api/Prova/atualizar-prova` | `AtualizarProvaRequestModel` (body) | `src/application/consulta-cadastro-provas.service.ts` |
| GET | `/api/Prova/listar-pendencias-provas` | `ListarPendenciasProvasRequestModel` (query) | `src/application/consulta-cadastro-provas.service.ts` |
| POST | `/api/Prova/iniciar-prova` | `IniciarProvaRequestModel` (body) | `src/application/consulta-cadastro-provas.service.ts` |
| GET | `/api/Questao/listar-questoes` | `ListarQuestoesRequestModel` (query) | `src/application/cadastro-questoes-alternativas-gabaritos.service.ts` |
| GET | `/api/Questao/obter-questao` | `ObterQuestaoRequestModel` (query) | `src/application/cadastro-questoes-alternativas-gabaritos.service.ts` |
| POST | `/api/Questao/criar-questao` | `CriarQuestaoRequestModel` (body) | `src/application/cadastro-questoes-alternativas-gabaritos.service.ts` |
| PUT | `/api/Questao/atualizar-questao` | `AtualizarQuestaoRequestModel` (body) | `src/application/cadastro-questoes-alternativas-gabaritos.service.ts` |
| PATCH | `/api/Questao/arquivar-questao` | `ArquivarQuestaoRequestModel` (body) | `src/application/cadastro-questoes-alternativas-gabaritos.service.ts` |
| POST | `/api/ResendWebhook/registrar-evento-entrega` | `RegistrarEventoEntregaRequestModel` (query) | `src/infrastructure/envio-emails-transacionais-resend.ts` |
| POST | `/api/Simulado/criar-simulado-filtrado` | `CriarSimuladoFiltradoRequestModel` (body) | `src/application/geracao-cadastro-simulados.service.ts` |
| GET | `/api/Simulado/listar-simulados` | `ListarSimuladosRequestModel` (query) | `src/application/geracao-cadastro-simulados.service.ts` |
| GET | `/api/Simulado/obter-simulado` | `ObterSimuladoRequestModel` (query) | `src/application/geracao-cadastro-simulados.service.ts` |
| POST | `/api/Simulado/criar-simulado` | `CriarSimuladoRequestModel` (body) | `src/application/geracao-cadastro-simulados.service.ts` |
| PUT | `/api/Simulado/atualizar-simulado` | `AtualizarSimuladoRequestModel` (body) | `src/application/geracao-cadastro-simulados.service.ts` |
| POST | `/api/Simulado/gerar-simulado-personalizado` | `GerarSimuladoPersonalizadoRequestModel` (body) | `src/application/geracao-cadastro-simulados.service.ts` |
| GET | `/api/Simulado/obter-disponibilidade-assuntos` | `ObterDisponibilidadeAssuntosRequestModel` (query) | `src/application/geracao-cadastro-simulados.service.ts` |
| GET | `/api/Sistema/verificar-sistema` | `VerificarSistemaRequestModel` (query) | `src/application/composicao-servicos-api.ts` |
| GET | `/api/Suporte/listar-chamados` | `ListarChamadosRequestModel` (query) | `src/application/chamados-suporte.service.ts` |
| GET | `/api/Suporte/obter-chamado` | `ObterChamadoRequestModel` (query) | `src/application/chamados-suporte.service.ts` |
| POST | `/api/Suporte/abrir-chamado` | `AbrirChamadoRequestModel` (body) | `src/application/chamados-suporte.service.ts` |
| POST | `/api/Suporte/responder-chamado` | `ResponderChamadoRequestModel` (body) | `src/application/chamados-suporte.service.ts` |
| POST | `/api/Suporte/finalizar-chamado` | `FinalizarChamadoRequestModel` (body) | `src/application/chamados-suporte.service.ts` |
| POST | `/api/Tentativa/iniciar-tentativa-simulado` | `IniciarTentativaSimuladoRequestModel` (body) | `src/application/resolucao-correcao-tentativas.service.ts` |
| GET | `/api/Tentativa/obter-tentativa-simulado` | `ObterTentativaSimuladoRequestModel` (query) | `src/application/resolucao-correcao-tentativas.service.ts` |
| PUT | `/api/Tentativa/responder-questao-simulado` | `ResponderQuestaoSimuladoRequestModel` (body) | `src/application/resolucao-correcao-tentativas.service.ts` |
| POST | `/api/Tentativa/finalizar-tentativa-simulado` | `FinalizarTentativaSimuladoRequestModel` (body) | `src/application/resolucao-correcao-tentativas.service.ts` |
| GET | `/api/Tentativa/obter-resultado-tentativa` | `ObterResultadoTentativaRequestModel` (query) | `src/application/resolucao-correcao-tentativas.service.ts` |
| GET | `/api/Tentativa/listar-minhas-tentativas` | `ListarMinhasTentativasRequestModel` (query) | `src/application/resolucao-correcao-tentativas.service.ts` |
| GET | `/api/Tentativa/obter-questoes-tentativa` | `ObterQuestoesTentativaRequestModel` (query) | `src/application/resolucao-correcao-tentativas.service.ts` |
| GET | `/api/Usuario/obter-meu-usuario` | `ObterMeuUsuarioRequestModel` (query) | `src/application/dados-conta-usuarios-administracao.service.ts` |
| GET | `/api/Usuario/listar-usuarios` | `ListarUsuariosRequestModel` (query) | `src/application/dados-conta-usuarios-administracao.service.ts` |
| GET | `/api/Usuario/obter-usuario` | `ObterUsuarioRequestModel` (query) | `src/application/dados-conta-usuarios-administracao.service.ts` |

## Mapeamento de Services

| Origem .NET | Destino Node |
| --- | --- | --- |
| `ConcursaAI.Application/Services/Administracao/AdministracaoService.cs` | `src/application/dados-conta-usuarios-administracao.service.ts` |
| `ConcursaAI.Application/Services/Autenticacao/AutenticacaoService.Google.cs` | `src/application/autenticacao-contas-sessoes.service.ts` |
| `ConcursaAI.Application/Services/Autenticacao/AutenticacaoService.cs` | `src/application/autenticacao-contas-sessoes.service.ts` |
| `ConcursaAI.Application/Services/BaseService.cs` | `src/application/autorizacao-usuario-autenticado.ts` |
| `ConcursaAI.Application/Services/Cadastro/AssuntoService.cs` | `src/application/cadastro-assuntos.service.ts` |
| `ConcursaAI.Application/Services/Cadastro/BancaService.cs` | `src/application/cadastro-bancas.service.ts` |
| `ConcursaAI.Application/Services/Cadastro/ConcursoService.cs` | `src/application/cadastro-concursos.service.ts` |
| `ConcursaAI.Application/Services/Cadastro/DisciplinaService.cs` | `src/application/cadastro-disciplinas.service.ts` |
| `ConcursaAI.Application/Services/Comunicacao/EmailsTransacionaisAdministracaoService.cs` | `src/application/administracao-emails-transacionais.service.ts` |
| `ConcursaAI.Application/Services/Comunicacao/PreferenciaComunicacaoService.cs` | `src/application/preferencias-comunicacao.service.ts` |
| `ConcursaAI.Application/Services/Estudo/EstudoService.cs` | `src/application/revisao-questoes-metas-estudo.service.ts` |
| `ConcursaAI.Application/Services/Identidade/ContaService.cs` | `src/application/dados-conta-usuarios-administracao.service.ts` |
| `ConcursaAI.Application/Services/Identidade/UsuarioService.cs` | `src/application/dados-conta-usuarios-administracao.service.ts` |
| `ConcursaAI.Application/Services/Integracoes/CepService.cs` | `src/infrastructure/cliente-enderecos-viacep.ts` |
| `ConcursaAI.Application/Services/InteligenciaArtificial/AnaliseQuestaoService.cs` | `src/application/analise-questoes-inteligencia-artificial.service.ts` |
| `ConcursaAI.Application/Services/Provas/ProvaService.cs` | `src/application/consulta-cadastro-provas.service.ts` |
| `ConcursaAI.Application/Services/Questoes/QuestaoService.cs` | `src/application/cadastro-questoes-alternativas-gabaritos.service.ts` |
| `ConcursaAI.Application/Services/Simulados/SimuladoService.cs` | `src/application/geracao-cadastro-simulados.service.ts` |
| `ConcursaAI.Application/Services/Simulados/TentativaService.cs` | `src/application/resolucao-correcao-tentativas.service.ts` |
| `ConcursaAI.Application/Services/Suporte/SuporteService.cs` | `src/application/chamados-suporte.service.ts` |

## Arquivos históricos e recursos ausentes

`Program.cs` é a referência para recursos ativos. `RepositorioSupabase`, `SupabaseGatewayClient`, opções antigas de Supabase Auth, `SupabaseJwksRetriever`, interceptor EF e factories/contexto EF não são registrados no runtime atual. Seus modelos/contratos/mapeamentos relevantes foram incorporados ao driver nativo; a implementação de transporte desativada não foi reativada. EF e suas migrations vazias/snapshots permanecem referências do schema, enquanto a evolução efetiva está nas migrations SQL preservadas.

Não existem serviços ativos de SMTP, Supabase Storage, upload/download de arquivos de usuário, PDFs, relatórios binários, processamento de imagens, pagamentos, embeddings, ferramentas de IA ou Redis. Não foram inventadas implementações para recursos inexistentes. O recurso de arquivos efetivamente utilizado é o importador administrativo JSON e seu arquivo de progresso. A única tarefa em background registrada é o worker de emails.

Skills consultadas: `skills/skill.md` (nodejs-backend-patterns), Supabase, Supabase Postgres Best Practices e OpenAI Docs disponíveis no ambiente, incluindo as cópias locais relevantes da origem. Não foram encontradas outras skills instaladas específicas de TypeScript, arquitetura ou testes.
