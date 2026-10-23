# ConcursaAI — API Next.js

O frontend React/Vite chama somente `/api`. O backend Next.js App Router autentica no Supabase Auth e consulta tabelas/RPCs pela Data API com a sessão do usuário. O runtime HTTP não utiliza conexão PostgreSQL direta ou pooler.

As regras de negócio e os contratos de request/response existentes são reaproveitados. O repositório Supabase converte consultas, filtros, paginação e JSON das RPCs; as políticas RLS continuam responsáveis pela separação dos dados dos alunos.

## Executar localmente

Use Node.js 24 e configure `.env.local` **neste backend**:

```dotenv
SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
AUTH_CLIENT_URL=http://localhost:5173
```

A URL deve ser a raiz do projeto, sem `/rest/v1`. A chave secreta fica somente no servidor; é usada nos callbacks de IA, webhooks, verificações e operações administrativas. Consultas normais usam a chave publicável com o token do usuário, respeitando RLS. Os arquivos de ambiente são ignorados pelo Git e pelo Docker.

```sh
npm ci
npm run dev
```

A API utiliza a porta 3000. No projeto irmão `../ConcursaAI`, execute `npm run dev`; o Vite utiliza a porta 5173 e encaminha `/api` à API. Para outro destino local, configure `VITE_API_PROXY_TARGET` no ambiente do Vite. O frontend não recebe chaves do Supabase, OpenAI ou Resend.

## Verificação

```sh
npm run check:database
npm run check:integration
npm run check:worker
npm run build
npm test
```

`check:database` verifica a Data API com uma consulta sem retornar dados pessoais. `check:integration` exige os dois servidores locais em execução; cria contas e uma questão temporárias, verifica aluno/administrador, isolamento, simulado, resposta/correção, honra, métricas, preferências e logout, e remove os dados ao terminar. Pode apontar para outro proxy **local** com `CONCURSA_TEST_API_URL`.

- `GET /api/health`: processo e presença de configuração.
- `GET /api/health/ready`: consulta real ao Supabase; retorna 503 quando a conexão não estiver disponível.
- `GET /api/openapi.json`: contratos HTTP.

## Swagger

Abra [http://localhost:3000/swagger](http://localhost:3000/swagger) para consultar e testar as rotas. `/swagger/index.html` também redireciona à interface em `/api/docs`. O Swagger utiliza o documento `/api/openapi.json`, gerado a partir dos contratos da API, e carrega seus arquivos pelo próprio backend.

Para testar uma rota protegida:

1. Em **Autenticacao**, execute `POST /api/Autenticacao/entrar-estudante` ou `entrar-administrador`, informando e-mail e senha.
2. Copie `data.accessToken` da resposta.
3. Clique em **Authorize** e cole somente o token, sem o prefixo `Bearer`.
4. Abra a rota desejada, selecione **Try it out**, preencha o request e clique em **Execute**.

A autorização não é persistida ao recarregar a página. As chamadas desse fluxo usam Bearer e não alteram os cookies da sessão do frontend. Para testar as rotas **Navegador**, que usam cookies HttpOnly e proteção de origem, acesse [http://localhost:5173/api/docs](http://localhost:5173/api/docs) pelo proxy do frontend; essa origem deve estar em `CORS_ORIGINS`. O cabeçalho `X-Concursa-Client` é preenchido pelo Swagger, e `Origin` pelo navegador.

O endpoint `/api/health/ready` permite verificar a comunicação com o Supabase pela própria interface. Na publicação, use `/swagger` no domínio da API ou `/api/docs` na origem que encaminha `/api` ao backend. A integração segue a [instalação](https://swagger.io/docs/open-source-tools/swagger-ui/usage/installation/) e as [opções oficiais do Swagger UI](https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/).

Os testes de unidade usam provedores controlados. O teste de integração usa o banco real e não envia e-mails nem consome OpenAI. O acervo real permanece preservado; dados temporários são removidos por seus identificadores.

## Publicação

```sh
npm run build
npm start
```

O Dockerfile utiliza o output `standalone` do Next.js, Node 24 e usuário sem privilégios. Configure as variáveis privadas no Render; não inclua arquivos `.env` na imagem. O health check é `/api/health`; a prontidão do banco pode ser acompanhada em `/api/health/ready`.

O worker de e-mails funciona em processo separado com `npm run worker:email`, após o build. No Render, use o comando `node dist-worker/worker-emails-supabase.js` em um Background Worker com as mesmas variáveis privadas, além de `RESEND_API_KEY`, `RESEND_FROM` e `AUTH_CLIENT_URL`. A origem de `AUTH_CLIENT_URL` deve estar em `CORS_ORIGINS`. `npm run check:worker` valida a conexão sem enviar mensagens. A reserva e a confirmação dos envios usam RPCs transacionais acessíveis somente à credencial do servidor.

Em produção, sirva frontend e API pela mesma origem, encaminhando `/api` para este backend. Essa configuração mantém os cookies de sessão `HttpOnly`, `Secure` e `SameSite=Lax`. Libere a origem pública em `CORS_ORIGINS` e nos Redirect URLs do Supabase Auth. Atrás do proxy do Render, configure `TRUST_PROXY_HOPS=1`.

Google depende do provedor habilitado no Supabase. Os e-mails de confirmação e recuperação utilizam a configuração SMTP do Supabase Auth; para Resend, configure o SMTP desse provedor no painel do Supabase. Envio real de e-mail e OAuth real não fazem parte do teste automatizado de integração.

## Banco e código legado

As migrations incrementais desta migração ficam em `database/migrations`. Foram aplicadas no projeto ConcursaAI as migrations de honra, consumo/perguntas de IA, permissões Data API, comunicação, sincronização de perfis e operação. Elas não são executadas automaticamente na inicialização da API.

As implementações Express/PostgreSQL e os testes de compatibilidade permanecem no repositório para consulta e comparação. A API Next e o worker atual utilizam a Data API e não precisam de `DATABASE_URL`. O worker não é iniciado por `npm run dev` ou `npm start`; execute seu comando próprio quando quiser processar a fila. Os documentos antigos de paridade referem-se ao backend Express anterior.
