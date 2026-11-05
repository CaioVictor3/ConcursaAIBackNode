# ConcursaAI — API Next.js

O backend Next.js expõe uma API independente em `/api`. Ele autentica no Supabase Auth e consulta tabelas e funções pela Data API com a sessão do usuário.

As regras de negócio e os contratos de request/response existentes são reaproveitados. O repositório Supabase converte consultas, filtros, paginação e JSON das RPCs; as políticas RLS continuam responsáveis pela separação dos dados dos alunos.

## Executar localmente

Use Node.js 24. Copie `.env.example` para `.env` neste backend e preencha a URL raiz do projeto Supabase e as duas chaves. A API, os scripts e os workers usam esse arquivo. Consulte [as opções de configuração](docs/CONFIGURACAO.md).

```sh
npm ci
cp .env.example .env # apenas na primeira configuração
```

Depois de preencher o arquivo, inicie a API.

```sh
npm run dev
```

A API utiliza a porta 3000 por padrão e pode ser iniciada sozinha. Para usar a interface local, configure `VITE_BACKEND_API_BASE_URL=http://localhost:3000` no frontend e `FRONTEND_APPLICATION_URL=http://localhost:5173` no backend. Se trocar a porta da API, ajuste a URL do frontend.

## Verificação

```sh
npm run check:database
npm run check:integration
npm run check:worker
npm run build
npm test
```

`check:database` verifica a Data API com uma consulta sem retornar dados pessoais. `check:integration` chama a API local, cria contas e uma questão temporárias e remove os dados ao terminar. Use `INTEGRATION_TEST_API_BASE_URL` para apontar para outra porta local.

- `GET /api/health`: processo e presença de configuração.
- `GET /api/health/ready`: consulta real ao Supabase; retorna 503 quando a conexão não estiver disponível.
- `GET /api/openapi.json`: contratos HTTP.

## Swagger

Abra [http://localhost:3000/swagger](http://localhost:3000/swagger) para consultar e testar as rotas. `/swagger/index.html` também redireciona à interface em `/api/docs`. O Swagger utiliza o documento `/api/openapi.json`, gerado a partir dos contratos da API, e carrega seus arquivos pelo próprio backend.

Para verificar se a API está no ar, abra **Saúde da API**, selecione `GET /api/health` e clique em **Try it out** e **Execute**.

Para testar uma rota protegida:

1. Em **Autenticacao**, execute `POST /api/Autenticacao/entrar-estudante` ou `entrar-administrador`, informando e-mail e senha.
2. Copie `data.accessToken` da resposta.
3. Clique em **Authorize** e cole o token em `bearerAuth`, sem o prefixo `Bearer`.
4. Abra a rota desejada, selecione **Try it out**, preencha o request e clique em **Execute**.

A autorização fica na página até recarregar. Para testar as rotas **Navegador** no Swagger, inclua também a origem da API em `BACKEND_CORS_ALLOWED_ORIGINS` e faça login pelo grupo **Navegador**. Localmente, a lista pode ser `http://localhost:5173,http://localhost:3000`. A sessão desse fluxo usa cookies HttpOnly.

O endpoint `/api/health/ready` verifica a comunicação com o Supabase. O Swagger fica em `/swagger` no domínio da API.

Os testes de unidade usam provedores controlados. O teste de integração usa o banco real e não envia e-mails nem consome OpenAI. O acervo real permanece preservado; dados temporários são removidos por seus identificadores.

## Publicação no Render

Crie um **Web Service** com runtime Docker neste repositório. O Dockerfile executa o servidor Next.js em `0.0.0.0` e lê a porta do ambiente. Cadastre as credenciais no painel do serviço e use `/api/health` como health check. Depois do deploy, copie a URL HTTPS do serviço para `VITE_BACKEND_API_BASE_URL` no build do frontend. Use `/api/health/ready` para verificar o Supabase. [Web Services no Render](https://render.com/docs/web-services)

O worker de e-mails funciona em processo separado com `npm run worker:email`, após o build. No Render, use `node dist-worker/worker-emails-supabase.js` em um Background Worker com as mesmas variáveis privadas, além de `RESEND_API_KEY`, `RESEND_SENDER_EMAIL_ADDRESS` e `FRONTEND_APPLICATION_URL`. `npm run check:worker` valida a conexão sem enviar mensagens. A reserva e a confirmação dos envios usam RPCs transacionais acessíveis somente à credencial do servidor.

Quando publicar a interface, configure `FRONTEND_APPLICATION_URL` no Render com a origem HTTPS do frontend. Se precisar permitir outras origens, configure `BACKEND_CORS_ALLOWED_ORIGINS` com a lista completa. Atrás do proxy do Render, configure `BACKEND_TRUSTED_PROXY_HOP_COUNT=1`. Consulte [as opções de produção](docs/CONFIGURACAO.md) para cadastrar os callbacks e os webhooks.

Google depende do provedor habilitado no Supabase. Os e-mails de confirmação e recuperação utilizam a configuração SMTP do Supabase Auth; para Resend, configure o SMTP desse provedor no painel do Supabase. Envio real de e-mail e OAuth real não fazem parte do teste automatizado de integração.

## Banco e código legado

As migrations incrementais desta migração ficam em `database/migrations`. Foram aplicadas no projeto ConcursaAI as migrations de honra, consumo/perguntas de IA, permissões Data API, comunicação, sincronização de perfis e operação. Elas não são executadas automaticamente na inicialização da API.

As implementações Express/PostgreSQL e os testes de compatibilidade permanecem no repositório para consulta e comparação. A API Next e o worker atual utilizam a Data API e não precisam de `POSTGRESQL_CONNECTION_URL`. O worker não é iniciado por `npm run dev` ou `npm start`; execute seu comando próprio quando quiser processar a fila. Os documentos antigos de paridade referem-se ao backend Express anterior.

## Pagamentos e assinaturas

Checkout Pro via Orders API, planos antecipados e renovação manual: veja [configuração, fluxos e homologação](docs/mercado-pago.md). A migration financeira altera o acesso aos recursos Premium; aplique primeiro em homologação.
