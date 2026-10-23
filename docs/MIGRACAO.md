# Inventário e checklist da migração

Origem: `../ConcursaAI.BackEnd`. Destino: `ConcursaIA.BackNode`. Inspeção inicial: 22/10/2026. O inventário inclui 469 arquivos relevantes, 172 DTOs, 96 endpoints e 21 projeções de tabelas/views. Os hashes estão em `source-inventory.json`; arquivos de build, caches, skills e artefatos gerados não integram esse conjunto. Valores de secrets não foram exportados.

## Arquitetura

- `src/config`: variáveis de ambiente e validação.
- `src/contracts`: interfaces TypeScript, metadados de serialização, defaults, validação, rotas e whitelist de tabelas extraídos da origem.
- `src/domain`: erros, invariantes e validação de dados pessoais.
- `src/application`: services modulares; regras fora dos controllers.
- `src/infrastructure`: PostgreSQL, transações/RLS, contas/sessões, cifragem, OpenAI, Google, ViaCEP, emails e worker.
- `src/http`: despacho tipado, transporte de navegador, cookies e OpenAPI.
- `src/app.ts`: composição explícita das dependências e pipeline HTTP. `src/server.ts`: listen e shutdown.
- `database/reference`: migrations, schema e testes SQL históricos preservados; usados apenas no banco isolado pelos testes.
- `tools/importacao`: importação real com validação, progresso e retomada, apontando para a API Node.

Foram preservados Express 5 e o acesso nativo ao PostgreSQL; não foi introduzido NestJS, ORM substituto, fila externa ou container de DI. Repository, adaptadores de provedores e composição por construtores resolvem as fronteiras existentes.

## Checklist funcional

| Estado local | Recurso original | Equivalente Node / evidência |
| --- | --- | --- |
| [x] | Cadastros e hierarquia de assuntos, duplicidade, vínculos, arquivamento/desativação | `application/catalog.ts`; integração HTTP e comparação .NET |
| [x] | Provas, temas, pendências, questão única por número, organização e início integral | `application/exams.ts`; funções SQL preservadas; testes SQL/HTTP |
| [x] | Questões, alternativas, explicação, gabarito e restrições de edição | `application/exams.ts`; projeções protegidas e correção autorizada |
| [x] | Simulados públicos/pessoais, seleção aleatória, filtros e cotas por assunto/tema | `application/simulations.ts`; regras e funções originais; testes SQL/HTTP |
| [x] | Tentativas, retomada, respostas, correção, pontuação, anuladas/sem gabarito e tempo | `application/simulations.ts`; funções transacionais originais; testes SQL/HTTP |
| [x] | Revisão espaçada, recomendação, estatísticas e metas semanais | `application/simulations.ts`; testes SQL originais e endpoints |
| [x] | Minha conta, dados pessoais, CPF/endereço, perfis e métricas administrativas | `application/identity-support.ts`, `domain/person.ts` |
| [x] | Suporte, propriedade, mensagens, atribuição e encerramento | `application/identity-support.ts`; testes entre usuários e administrador |
| [x] | Cadastro, login aluno/admin, bloqueio, confirmação, recuperação e troca de senha | `application/auth.ts`, `infrastructure/accounts.ts`; HTTP com PostgreSQL real |
| [x] | ASP.NET PBKDF2 v2/v3, bcrypt legado e atualização condicional de hash | `infrastructure/crypto.ts`; testes criptográficos e persistência |
| [x] | JWT, sessões, refresh rotativo, detecção de replay, revogação e versão de credenciais | `application/auth.ts`, `infrastructure/accounts.ts`; teste de replay real |
| [x] | Google OAuth/OIDC, PKCE, state, nonce, JWKS, email verificado e vínculo explícito | `infrastructure/providers.ts`, `application/auth.ts`, `http/cookies.ts`; JWT RSA de teste e banco real |
| [x] | Cookies, proteção Origin/header, renovação e logout de navegador | `http/cookies.ts`, `app.ts`; testes com agente HTTP e HttpOnly |
| [x] | IA explícita para resposta incorreta, cota, reserva, concorrência, cache e limpeza de falha | `application/ai.ts`; funções SQL preservadas e provedor controlado no teste |
| [x] | OpenAI Responses, modelo, schema, prompt, timeouts, recusa e store=false | `infrastructure/providers.ts`; request/response testados sem cobrança |
| [x] | Consulta ViaCEP e limite por IP | `infrastructure/providers.ts`, `app.ts`; testes e chamada real somente de leitura |
| [x] | Email de confirmação, recuperação, boas-vindas e inatividade | `infrastructure/emails.ts`, `email-sql.json`; templates, fila e persistência reais |
| [x] | Worker, lease, SKIP LOCKED, idempotência, retentativas, limpeza por retenção | `infrastructure/emails.ts`; PostgreSQL real e transporte controlado |
| [x] | Workflows pausáveis, preferência opt-in, histórico, métricas e reprocessamento | `application/communication.ts`; testes HTTP/banco |
| [x] | Webhook Resend, HMAC, corpo bruto, janela temporal e eventos fora de ordem | `app.ts`, `infrastructure/emails.ts`; teste de assinatura e evento idempotente |
| [x] | PostgreSQL restrito, RLS, claims transacionais, FKs, views, índices, funções e concorrência | `infrastructure/database.ts`, `repository.ts`; sete suítes SQL originais |
| [x] | Erros, envelopes, JSON camelCase, query/body, defaults e números estritos | `domain/errors.ts`, `contracts/codec.ts`; comparação HTTP das 96 rotas |
| [x] | CORS, rate limit, logs, health, build, porta/HOST e shutdown | `app.ts`, `server.ts`; execução real dos scripts npm |
| [x] | Importação administrativa validada e retomável | `tools/importacao/scripts/importar-prova.mjs`; 5 testes |
| [ ] | Homologação Google com credenciais reais | Client ID/secret ausentes |
| [ ] | Homologação OpenAI com credencial real | API key ausente; nenhuma cobrança efetuada |
| [ ] | Homologação Resend, remetente/domínio e webhook reais | API key/remetente/secret ausentes; nenhum email real enviado |
| [ ] | Build efetivo da imagem Docker | Dockerfile entregue; daemon indisponível |

## Endpoints e rastreabilidade

Todos possuem implementação e schema OpenAPI. A verificação HTTP compara GETs com fixtures e mutações com dados vazios; os fluxos positivos e regras relevantes são exercitados separadamente nas suítes de integração. Isso não equivale a uma prova de todos os caminhos possíveis de cada endpoint.

| Método | Rota preservada | Request | Implementação |
| --- | --- | --- | --- |
| GET | `/api/Administracao/obter-metricas-sistema` | `ObterMetricasSistemaRequestModel` (query) | `src/application/identity-support.ts` |
| GET | `/api/AnaliseQuestao/consultar-analise-questao` | `ConsultarAnaliseQuestaoRequestModel` (query) | `src/application/ai.ts` |
| POST | `/api/AnaliseQuestao/solicitar-analise-questao` | `SolicitarAnaliseQuestaoRequestModel` (body) | `src/application/ai.ts` |
| GET | `/api/Assunto/listar-assuntos` | `ListarAssuntosRequestModel` (query) | `src/application/catalog.ts` |
| GET | `/api/Assunto/obter-assunto` | `ObterAssuntoRequestModel` (query) | `src/application/catalog.ts` |
| POST | `/api/Assunto/criar-assunto` | `CriarAssuntoRequestModel` (body) | `src/application/catalog.ts` |
| PUT | `/api/Assunto/atualizar-assunto` | `AtualizarAssuntoRequestModel` (body) | `src/application/catalog.ts` |
| DELETE | `/api/Assunto/excluir-assunto` | `ExcluirAssuntoRequestModel` (query) | `src/application/catalog.ts` |
| POST | `/api/Autenticacao/confirmar-email` | `ConfirmarEmailAutenticacaoRequestModel` (body) | `src/application/auth.ts` |
| POST | `/api/Autenticacao/redefinir-senha` | `RedefinirSenhaRequestModel` (body) | `src/application/auth.ts` |
| POST | `/api/Autenticacao/entrar-estudante` | `EntrarEstudanteRequestModel` (body) | `src/application/auth.ts` |
| POST | `/api/Autenticacao/entrar-administrador` | `EntrarAdministradorRequestModel` (body) | `src/application/auth.ts` |
| POST | `/api/Autenticacao/cadastrar-estudante` | `CadastrarEstudanteRequestModel` (body) | `src/application/auth.ts` |
| POST | `/api/Autenticacao/renovar-sessao` | `RenovarSessaoRequestModel` (body) | `src/application/auth.ts` |
| POST | `/api/Autenticacao/solicitar-recuperacao-senha` | `SolicitarRecuperacaoSenhaRequestModel` (body) | `src/application/auth.ts` |
| POST | `/api/Autenticacao/reenviar-confirmacao` | `ReenviarConfirmacaoRequestModel` (body) | `src/application/auth.ts` |
| POST | `/api/Autenticacao/sair-sessao` | `SairSessaoRequestModel` (body) | `src/application/auth.ts` |
| PUT | `/api/Autenticacao/atualizar-senha` | `AtualizarSenhaRequestModel` (body) | `src/application/auth.ts` |
| GET | `/api/Banca/listar-bancas` | `ListarBancasRequestModel` (query) | `src/application/catalog.ts` |
| GET | `/api/Banca/obter-banca` | `ObterBancaRequestModel` (query) | `src/application/catalog.ts` |
| POST | `/api/Banca/criar-banca` | `CriarBancaRequestModel` (body) | `src/application/catalog.ts` |
| PUT | `/api/Banca/atualizar-banca` | `AtualizarBancaRequestModel` (body) | `src/application/catalog.ts` |
| DELETE | `/api/Banca/excluir-banca` | `ExcluirBancaRequestModel` (query) | `src/application/catalog.ts` |
| GET | `/api/Cep/consultar-cep` | `ConsultarCepRequestModel` (query) | `src/application/../infrastructure/providers.ts` |
| GET | `/api/Concurso/listar-concursos` | `ListarConcursosRequestModel` (query) | `src/application/catalog.ts` |
| GET | `/api/Concurso/obter-concurso` | `ObterConcursoRequestModel` (query) | `src/application/catalog.ts` |
| POST | `/api/Concurso/criar-concurso` | `CriarConcursoRequestModel` (body) | `src/application/catalog.ts` |
| PUT | `/api/Concurso/atualizar-concurso` | `AtualizarConcursoRequestModel` (body) | `src/application/catalog.ts` |
| DELETE | `/api/Concurso/excluir-concurso` | `ExcluirConcursoRequestModel` (query) | `src/application/catalog.ts` |
| GET | `/api/Conta/obter-minha-conta` | `ObterMinhaContaRequestModel` (query) | `src/application/identity-support.ts` |
| PUT | `/api/Conta/atualizar-minha-conta` | `AtualizarMinhaContaRequestModel` (body) | `src/application/identity-support.ts` |
| GET | `/api/Disciplina/listar-disciplinas` | `ListarDisciplinasRequestModel` (query) | `src/application/catalog.ts` |
| GET | `/api/Disciplina/obter-disciplina` | `ObterDisciplinaRequestModel` (query) | `src/application/catalog.ts` |
| POST | `/api/Disciplina/criar-disciplina` | `CriarDisciplinaRequestModel` (body) | `src/application/catalog.ts` |
| PUT | `/api/Disciplina/atualizar-disciplina` | `AtualizarDisciplinaRequestModel` (body) | `src/application/catalog.ts` |
| PATCH | `/api/Disciplina/desativar-disciplina` | `DesativarDisciplinaRequestModel` (body) | `src/application/catalog.ts` |
| GET | `/api/EmailsTransacionais/listar-historico` | `ListarEmailsTransacionaisRequestModel` (query) | `src/application/communication.ts` |
| GET | `/api/EmailsTransacionais/obter-metricas` | `ObterMetricasEmailsRequestModel` (query) | `src/application/communication.ts` |
| POST | `/api/EmailsTransacionais/reprocessar-falha` | `ReprocessarEmailRequestModel` (body) | `src/application/communication.ts` |
| GET | `/api/EmailsTransacionais/listar-fluxos` | `ListarFluxosEmailRequestModel` (query) | `src/application/communication.ts` |
| PUT | `/api/EmailsTransacionais/atualizar-fluxo` | `AtualizarFluxoEmailRequestModel` (body) | `src/application/communication.ts` |
| GET | `/api/Estudo/obter-resumo-revisao` | `ObterResumoRevisaoRequestModel` (query) | `src/application/simulations.ts` |
| GET | `/api/Estudo/listar-questoes-revisao` | `ListarQuestoesRevisaoRequestModel` (query) | `src/application/simulations.ts` |
| POST | `/api/Estudo/gerar-treino-revisao` | `GerarTreinoRevisaoRequestModel` (body) | `src/application/simulations.ts` |
| POST | `/api/Estudo/gerar-treino-recomendado` | `GerarTreinoRecomendadoRequestModel` (body) | `src/application/simulations.ts` |
| GET | `/api/Estudo/obter-estatisticas-assuntos` | `ObterEstatisticasAssuntosRequestModel` (query) | `src/application/simulations.ts` |
| GET | `/api/Estudo/obter-meta-semanal` | `ObterMetaSemanalRequestModel` (query) | `src/application/simulations.ts` |
| PUT | `/api/Estudo/salvar-meta-semanal` | `SalvarMetaSemanalRequestModel` (body) | `src/application/simulations.ts` |
| GET | `/api/Navegador/obter-configuracao-acesso` | `ObterConfiguracaoAcessoRequestModel` (query) | `src/application/../http/cookies.ts` |
| GET | `/api/Navegador/obter-vinculo-google` | `ObterVinculoGoogleRequestModel` (query) | `src/application/../http/cookies.ts` |
| POST | `/api/Navegador/iniciar-vinculo-google` | `IniciarVinculoGoogleRequestModel` (body) | `src/application/../http/cookies.ts` |
| POST | `/api/Navegador/iniciar-google` | `IniciarGoogleRequestModel` (body) | `src/application/../http/cookies.ts` |
| POST | `/api/Navegador/concluir-google` | `ConcluirGoogleRequestModel` (body) | `src/application/../http/cookies.ts` |
| POST | `/api/Navegador/entrar-estudante` | `EntrarEstudanteRequestModel` (body) | `src/application/../http/cookies.ts` |
| POST | `/api/Navegador/entrar-administrador` | `EntrarAdministradorRequestModel` (body) | `src/application/../http/cookies.ts` |
| POST | `/api/Navegador/renovar-sessao` | `RenovarSessaoNavegadorRequestModel` (body) | `src/application/../http/cookies.ts` |
| POST | `/api/Navegador/confirmar-sessao` | `RenovarSessaoRequestModel` (body) | `src/application/../http/cookies.ts` |
| POST | `/api/Navegador/sair-sessao` | `SairSessaoRequestModel` (body) | `src/application/../http/cookies.ts` |
| GET | `/api/PreferenciaComunicacao/obter-minha-preferencia` | `ObterPreferenciaComunicacaoRequestModel` (query) | `src/application/communication.ts` |
| PUT | `/api/PreferenciaComunicacao/atualizar-minha-preferencia` | `PreferenciaComunicacaoRequestModel` (body) | `src/application/communication.ts` |
| GET | `/api/Prova/listar-provas` | `ListarProvasRequestModel` (query) | `src/application/exams.ts` |
| GET | `/api/Prova/obter-prova` | `ObterProvaRequestModel` (query) | `src/application/exams.ts` |
| GET | `/api/Prova/listar-temas` | `ListarTemasRequestModel` (query) | `src/application/exams.ts` |
| POST | `/api/Prova/criar-prova` | `CriarProvaRequestModel` (body) | `src/application/exams.ts` |
| PUT | `/api/Prova/atualizar-prova` | `AtualizarProvaRequestModel` (body) | `src/application/exams.ts` |
| GET | `/api/Prova/listar-pendencias-provas` | `ListarPendenciasProvasRequestModel` (query) | `src/application/exams.ts` |
| POST | `/api/Prova/iniciar-prova` | `IniciarProvaRequestModel` (body) | `src/application/exams.ts` |
| GET | `/api/Questao/listar-questoes` | `ListarQuestoesRequestModel` (query) | `src/application/exams.ts` |
| GET | `/api/Questao/obter-questao` | `ObterQuestaoRequestModel` (query) | `src/application/exams.ts` |
| POST | `/api/Questao/criar-questao` | `CriarQuestaoRequestModel` (body) | `src/application/exams.ts` |
| PUT | `/api/Questao/atualizar-questao` | `AtualizarQuestaoRequestModel` (body) | `src/application/exams.ts` |
| PATCH | `/api/Questao/arquivar-questao` | `ArquivarQuestaoRequestModel` (body) | `src/application/exams.ts` |
| POST | `/api/ResendWebhook/registrar-evento-entrega` | `RegistrarEventoEntregaRequestModel` (query) | `src/application/../infrastructure/emails.ts` |
| POST | `/api/Simulado/criar-simulado-filtrado` | `CriarSimuladoFiltradoRequestModel` (body) | `src/application/simulations.ts` |
| GET | `/api/Simulado/listar-simulados` | `ListarSimuladosRequestModel` (query) | `src/application/simulations.ts` |
| GET | `/api/Simulado/obter-simulado` | `ObterSimuladoRequestModel` (query) | `src/application/simulations.ts` |
| POST | `/api/Simulado/criar-simulado` | `CriarSimuladoRequestModel` (body) | `src/application/simulations.ts` |
| PUT | `/api/Simulado/atualizar-simulado` | `AtualizarSimuladoRequestModel` (body) | `src/application/simulations.ts` |
| POST | `/api/Simulado/gerar-simulado-personalizado` | `GerarSimuladoPersonalizadoRequestModel` (body) | `src/application/simulations.ts` |
| GET | `/api/Simulado/obter-disponibilidade-assuntos` | `ObterDisponibilidadeAssuntosRequestModel` (query) | `src/application/simulations.ts` |
| GET | `/api/Sistema/verificar-sistema` | `VerificarSistemaRequestModel` (query) | `src/application/services.ts` |
| GET | `/api/Suporte/listar-chamados` | `ListarChamadosRequestModel` (query) | `src/application/identity-support.ts` |
| GET | `/api/Suporte/obter-chamado` | `ObterChamadoRequestModel` (query) | `src/application/identity-support.ts` |
| POST | `/api/Suporte/abrir-chamado` | `AbrirChamadoRequestModel` (body) | `src/application/identity-support.ts` |
| POST | `/api/Suporte/responder-chamado` | `ResponderChamadoRequestModel` (body) | `src/application/identity-support.ts` |
| POST | `/api/Suporte/finalizar-chamado` | `FinalizarChamadoRequestModel` (body) | `src/application/identity-support.ts` |
| POST | `/api/Tentativa/iniciar-tentativa-simulado` | `IniciarTentativaSimuladoRequestModel` (body) | `src/application/simulations.ts` |
| GET | `/api/Tentativa/obter-tentativa-simulado` | `ObterTentativaSimuladoRequestModel` (query) | `src/application/simulations.ts` |
| PUT | `/api/Tentativa/responder-questao-simulado` | `ResponderQuestaoSimuladoRequestModel` (body) | `src/application/simulations.ts` |
| POST | `/api/Tentativa/finalizar-tentativa-simulado` | `FinalizarTentativaSimuladoRequestModel` (body) | `src/application/simulations.ts` |
| GET | `/api/Tentativa/obter-resultado-tentativa` | `ObterResultadoTentativaRequestModel` (query) | `src/application/simulations.ts` |
| GET | `/api/Tentativa/listar-minhas-tentativas` | `ListarMinhasTentativasRequestModel` (query) | `src/application/simulations.ts` |
| GET | `/api/Tentativa/obter-questoes-tentativa` | `ObterQuestoesTentativaRequestModel` (query) | `src/application/simulations.ts` |
| GET | `/api/Usuario/obter-meu-usuario` | `ObterMeuUsuarioRequestModel` (query) | `src/application/identity-support.ts` |
| GET | `/api/Usuario/listar-usuarios` | `ListarUsuariosRequestModel` (query) | `src/application/identity-support.ts` |
| GET | `/api/Usuario/obter-usuario` | `ObterUsuarioRequestModel` (query) | `src/application/identity-support.ts` |

## Mapeamento de Services

| Origem .NET | Destino Node |
| --- | --- | --- |
| `ConcursaAI.Application/Services/Administracao/AdministracaoService.cs` | `src/application/identity-support.ts` |
| `ConcursaAI.Application/Services/Autenticacao/AutenticacaoService.Google.cs` | `src/application/auth.ts` |
| `ConcursaAI.Application/Services/Autenticacao/AutenticacaoService.cs` | `src/application/auth.ts` |
| `ConcursaAI.Application/Services/BaseService.cs` | `src/application/context.ts` |
| `ConcursaAI.Application/Services/Cadastro/AssuntoService.cs` | `src/application/catalog.ts` |
| `ConcursaAI.Application/Services/Cadastro/BancaService.cs` | `src/application/catalog.ts` |
| `ConcursaAI.Application/Services/Cadastro/ConcursoService.cs` | `src/application/catalog.ts` |
| `ConcursaAI.Application/Services/Cadastro/DisciplinaService.cs` | `src/application/catalog.ts` |
| `ConcursaAI.Application/Services/Comunicacao/EmailsTransacionaisAdministracaoService.cs` | `src/application/communication.ts` |
| `ConcursaAI.Application/Services/Comunicacao/PreferenciaComunicacaoService.cs` | `src/application/communication.ts` |
| `ConcursaAI.Application/Services/Estudo/EstudoService.cs` | `src/application/simulations.ts` |
| `ConcursaAI.Application/Services/Identidade/ContaService.cs` | `src/application/identity-support.ts` |
| `ConcursaAI.Application/Services/Identidade/UsuarioService.cs` | `src/application/identity-support.ts` |
| `ConcursaAI.Application/Services/Integracoes/CepService.cs` | `src/application/../infrastructure/providers.ts` |
| `ConcursaAI.Application/Services/InteligenciaArtificial/AnaliseQuestaoService.cs` | `src/application/ai.ts` |
| `ConcursaAI.Application/Services/Provas/ProvaService.cs` | `src/application/exams.ts` |
| `ConcursaAI.Application/Services/Questoes/QuestaoService.cs` | `src/application/exams.ts` |
| `ConcursaAI.Application/Services/Simulados/SimuladoService.cs` | `src/application/simulations.ts` |
| `ConcursaAI.Application/Services/Simulados/TentativaService.cs` | `src/application/simulations.ts` |
| `ConcursaAI.Application/Services/Suporte/SuporteService.cs` | `src/application/identity-support.ts` |

## Arquivos históricos e recursos ausentes

`Program.cs` é a referência para recursos ativos. `RepositorioSupabase`, `SupabaseGatewayClient`, opções antigas de Supabase Auth, `SupabaseJwksRetriever`, interceptor EF e factories/contexto EF não são registrados no runtime atual. Seus modelos/contratos/mapeamentos relevantes foram incorporados ao driver nativo; a implementação de transporte desativada não foi reativada. EF e suas migrations vazias/snapshots permanecem referências do schema, enquanto a evolução efetiva está nas migrations SQL preservadas.

Não existem serviços ativos de SMTP, Supabase Storage, upload/download de arquivos de usuário, PDFs, relatórios binários, processamento de imagens, pagamentos, embeddings, ferramentas de IA ou Redis. Não foram inventadas implementações para recursos inexistentes. O recurso de arquivos efetivamente utilizado é o importador administrativo JSON e seu arquivo de progresso. A única tarefa em background registrada é o worker de emails.

Skills consultadas: `skills/skill.md` (nodejs-backend-patterns), Supabase, Supabase Postgres Best Practices e OpenAI Docs disponíveis no ambiente, incluindo as cópias locais relevantes da origem. Não foram encontradas outras skills instaladas específicas de TypeScript, arquitetura ou testes.
