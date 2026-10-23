# Configuração e operação

Todos os valores são lidos do ambiente, com suporte a `.env` em execução local. `.env.example` contém a lista completa; nenhum secret aparece nesta documentação.

| Origem .NET | Ambiente Node | Comportamento |
| --- | --- | --- |
| `Urls` / `PORT` | `HOST`, `PORT` | 127.0.0.1:3000 por padrão; 0.0.0.0 para hospedagem |
| Ambiente ASP.NET | `NODE_ENV` | development ou production; produção exige chave válida |
| `Cors:Origens` | `CORS_ORIGINS` | Lista explícita; credenciais somente para origens permitidas |
| `ConnectionStrings:ConcursaAI` | `DATABASE_URL` | URL PostgreSQL; papel concursa_backend |
| Root Certificate / SSL Mode | `DATABASE_CA_FILE`, `sslmode=verify-full` na URL | CA pública em certificates; verificação completa de hostname e cadeia |
| Pool / timeout Npgsql | `DATABASE_POOL_MAX`, `DATABASE_TIMEOUT_MS`, `DATABASE_COMMAND_TIMEOUT_MS` | 20 conexões / conexão 15 s / comando 60 s, preservados da configuração local |
| `Autenticacao:ChaveAssinatura` | `AUTH_SIGNING_KEY` | Base64 de pelo menos 64 bytes |
| `Autenticacao:Emissor` / `Audiencia` | `AUTH_ISSUER`, `AUTH_AUDIENCE` | ConcursaAI por padrão |
| `MinutosAcesso` / `DiasSessao` | `AUTH_ACCESS_MINUTES`, `AUTH_SESSION_DAYS` | 15 minutos e 7 dias; mesmas faixas aceitas |
| `FrontendUrl` | `AUTH_CLIENT_URL` | Origem para links/retorno OAuth; não cria dependência operacional do frontend |
| `Google:ClientId` / `ClientSecret` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Credenciais OAuth privadas |
| URLs Google | `GOOGLE_AUTHORIZATION_URL`, `GOOGLE_TOKEN_URL`, `GOOGLE_DISCOVERY_URL` | Endpoints originais HTTPS; JWKS descoberto e validado |
| `OpenAI:ApiKey`, `Modelo`, `ResponsesUrl` | `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_RESPONSES_URL` | Responses API, gpt-4.1-mini, timeout 60 s, store=false, limite 4000 tokens |
| `Integracoes:ViaCep:UrlBase` | `VIACEP_URL` | HTTPS, timeout 10 s, sem redirecionamentos |
| `EmailsTransacionais:NomeAplicacao` | `EMAIL_APP_NAME` | Marca dos templates |
| `Resend:ApiKey`, `Remetente`, `NomeRemetente` | `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_FROM_NAME` | Credenciais e remetente verificado |
| `Resend:WebhookSecret`, `UrlBase` | `RESEND_WEBHOOK_SECRET`, `RESEND_URL` | Assinatura Svix e envio HTTPS; timeout 20 s |
| Worker Habilitado / Intervalo / Lote | `EMAIL_WORKER_ENABLED`, `EMAIL_INTERVAL_SECONDS`, `EMAIL_BATCH_SIZE` | true / 15 s / 25 por padrão |
| Tentativas / Reserva | `EMAIL_MAX_ATTEMPTS`, `EMAIL_RESERVATION_SECONDS` | 5 tentativas / 120 s |
| Retentativas | `EMAIL_RETRY_BASE_SECONDS`, `EMAIL_RETRY_MAX_SECONDS` | Backoff exponencial com jitter; 30 s a 3600 s |
| DiasInatividade / RetencaoDias | `EMAIL_INACTIVITY_DAYS`, `EMAIL_RETENTION_DAYS` | 7,15,30 / 90 dias |
| Workflows | `EMAIL_VERIFICATION_ENABLED`, `EMAIL_WELCOME_ENABLED`, `EMAIL_PASSWORD_RESET_ENABLED`, `EMAIL_INACTIVE_ENABLED` | Defaults true/true/true/false; overrides persistidos prevalecem |
| Logging | `LOG_LEVEL` | Pino estruturado; sem corpo, tokens, query string ou senhas nos logs |
| Proxy da hospedagem | `TRUST_PROXY_HOPS` | 0 por padrão; configure apenas para a topologia real |
| Importador que lia appsettings | `CONCURSA_API_URL`, `CONCURSA_IMPORT_TOKEN` | URL do backend e token temporário de administrador |

## Persistência

Preservados schemas, tabelas, nomes sensíveis a caixa, índices, FKs, constraints, views, triggers e funções SQL das 21 migrations. As projeções são uma whitelist extraída de `ModelosSupabase`; respostas públicas de questões nunca selecionam explicações ou gabaritos. A correção só é obtida pela função autorizada após finalizar a tentativa. O driver `pg` mantém transações na mesma conexão, faz rollback em falhas e restaura o papel/contexto ao devolver a conexão.

A API não precisa de URL, chave publicável, service_role, bucket ou Supabase Auth: esses clientes existem como código legado na origem, mas a composição atual de `Program.cs` usa PostgreSQL nativo. Não foi identificada implementação ativa de Storage, uploads, SMTP, pagamentos, embeddings, PDF ou mensageria. As configurações SMTP encontradas no arquivo local estavam sem credenciais e não são utilizadas pelo código registrado; o provedor de emails efetivo é Resend.

## Emails e tarefas

A emissão de tokens e a inclusão na fila ocorrem na mesma transação. Links usam HMAC-SHA256 para derivar a chave e AES-256-GCM no mesmo formato binário da origem (nonce, tag, ciphertext em base64). Trocar `AUTH_SIGNING_KEY` invalida links pendentes; preserve a chave durante a migração.

O worker executa ciclos sem sobreposição; reserva com `FOR UPDATE SKIP LOCKED`, expiração de lease e contador de tentativas; usa chave idempotente no Resend e distingue aceite de entrega. Webhooks exigem corpo bruto até 64 KiB, HMAC e timestamp com tolerância de 5 minutos. Eventos repetidos não duplicam efeitos, e eventos recebidos antes do aceite são reaplicados quando o identificador do provedor é persistido. Bounce/reclamação/falha têm precedência sobre entrega.

Limpeza por retenção e seleção de inativos ocorrem no máximo a cada hora. Inatividade exige opt-in e usuário ainda inativo; cada marco é idempotente. Desabilitar a preferência cancela envios ainda pendentes/processando. Workflows podem ser pausados sem consumir tentativas. Reprocessamento manual só aceita falhas permanentes 4xx seguras de boas-vindas/inatividade, sem mensagem já aceita pelo provedor.

O `.env` local foi deixado com o worker desabilitado para que a validação da migração não acione limpeza ou envio no banco existente. A opção continua disponível e o padrão do código permanece habilitado como no .NET. Ative `EMAIL_WORKER_ENABLED=true` no ambiente apropriado após configurar o provedor e revisar os workflows.

## Publicação

1. Publique o conteúdo de `ConcursaIA.BackNode` como backend independente.
2. Execute `npm ci`, `npm run build` e `npm run start`, ou use o Dockerfile.
3. Forneça secrets na hospedagem, `HOST=0.0.0.0`, porta da plataforma e origens CORS autorizadas.
4. Use o PostgreSQL existente com o papel restrito, grants e migrations já aplicadas. Não reaplique o histórico ao banco existente.
5. Configure retorno Google como `AUTH_CLIENT_URL/autenticacao/google` e webhook Resend como a URL pública da API seguida de `/api/ResendWebhook/registrar-evento-entrega`.
6. Use HTTPS no acesso público e confira `/api/health`, logs e `npm run check:database`.

Rate limiting mantém contadores por processo, como na origem. Em várias réplicas, a limitação global precisa ocorrer no gateway ou em um store compartilhado. O pool deve ser dimensionado conforme o limite de conexões do provedor e o número de réplicas. OpenAPI está disponível também em produção para documentar clientes externos; restrinja sua exposição no gateway se necessário ao ambiente.

Referências consultadas: [Responses e saídas estruturadas](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), [modelo preservado](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [conexões Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres), [transações pg](https://node-postgres.com/features/transactions), [ciclo Node LTS](https://nodejs.org/en/about/previous-releases). A revisão do [changelog Supabase](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes) não identificou uso dos recursos afetados no runtime migrado.
