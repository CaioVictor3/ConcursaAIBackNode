# ConcursaAI — API Node.js + TypeScript

Backend independente em Express 5. O runtime não depende de .NET, frontend, Supabase Auth ou Data API. Preserva as 96 rotas da API original, seus DTOs e as funções PostgreSQL existentes.

**Situação:** implementação dos módulos e rotas entregue e validada localmente. A homologação integral com OpenAI, Google e Resend reais permanece pendente das credenciais. Os adaptadores reais estão implementados; os testes usam provedores controlados apenas durante a execução dos testes.

## Executar localmente

Recomendado Node.js 24 LTS (`nvm use`); mínimo 22.16. PostgreSQL 17 com a estrutura e permissões existentes.

```sh
npm ci
cp .env.example .env # somente se .env ainda não existir
# Preencha DATABASE_URL, AUTH_SIGNING_KEY e as integrações necessárias.
npm run dev
```

A configuração local existente foi reaproveitada em `.env`, com permissão 0600 e ignorada pelo Git. Não substitua esse arquivo pelo exemplo se já estiver configurado.

Endereço padrão: `http://127.0.0.1:3000`. Ajuste `HOST` e `PORT` no ambiente.

- `GET /api/health`: saúde do processo; não garante conectividade com dependências.
- `GET /api/Sistema/verificar-sistema`: contrato legado preservado.
- `GET /openapi/v1.json` ou `/api/openapi.json`: OpenAPI 3.1.
- `/api/docs`: Swagger UI.
- `npm run check:database`: consulta somente de leitura para verificar conexão e papel restrito.

Não é necessário manter um frontend em execução. Clientes HTTP podem usar `Authorization: Bearer TOKEN`. `AUTH_CLIENT_URL` e `CORS_ORIGINS` são necessários para links de email e fluxos de navegador/OAuth que dependam de uma origem de retorno.

## Build e produção

```sh
npm run build
NODE_ENV=production HOST=0.0.0.0 PORT=3000 npm run start
```

Configure os secrets no serviço de hospedagem, mantenha TLS até o PostgreSQL e termine HTTPS no proxy da plataforma. `AUTH_SIGNING_KEY` precisa conter pelo menos 64 bytes codificados em base64; reutilize a chave original para conservar JWTs e links já emitidos. Configure `TRUST_PROXY_HOPS` apenas para a quantidade efetiva de proxies confiáveis. CORS aceita uma lista de origens explícitas separadas por vírgulas; o padrão vazio permite clientes HTTP diretos, sem habilitar acesso de origens de navegador.

```sh
docker build -t concursa-api .
docker run --rm --env-file .env -e NODE_ENV=production -e HOST=0.0.0.0 -p 3000:3000 concursa-api
```

O Dockerfile usa Node 24, usuário sem privilégios e somente dependências de produção na imagem final. A imagem não inclui `.env`. O build da imagem não foi executado nesta entrega porque o daemon Docker estava indisponível. O build TypeScript e os scripts reais de desenvolvimento e produção foram executados.

SIGTERM/SIGINT interrompem o worker, aguardam requisições, encerram conexões ociosas e fecham o pool. O limite de encerramento é 30 segundos. O health check da plataforma deve usar `/api/health`.

## Banco e segurança

Use uma URL PostgreSQL com `concursa_backend` (ou `concursa_backend.<referência>` para o pooler). Conexões remotas exigem `sslmode=verify-full`; `DATABASE_CA_FILE` permite a CA fornecida no projeto. O runtime nunca usa `postgres`, `service_role` ou `bypassrls`.

As operações de negócio executam `SET LOCAL ROLE concursa_dados` e definem claims de usuário dentro da mesma transação, na mesma conexão. Credenciais e filas permanecem nos schemas privados `identidade` e `comunicacao`. Nenhuma migration é executada na inicialização. Os scripts históricos em `database/reference/migrations` são referência auditável; não devem ser reaplicados ao banco existente. Contêm inclusive uma limpeza histórica de acervo, executada nesta entrega somente no banco descartável de testes.

JWT HS256 inclui `sub`, `sid`, `tipo` e `jti`, exige issuer/audience/expiração e valida a sessão persistida. A autorização consulta o perfil no banco. Hashes ASP.NET Identity v2/v3 e bcrypt são aceitos; hashes legados são atualizados para PBKDF2-SHA512/210.000 iterações após login válido. Refresh tokens têm rotação, detecção de reutilização e revogação. Login e CEP preservam limites de 10 e 30 requisições por minuto por IP.

Cookies de navegador usam HttpOnly, SameSite e Secure em produção. Mutações desse transporte exigem origem autorizada e `X-Concursa-Client: web`. A cifragem dos cookies mudou de ASP.NET Data Protection para AES-256-GCM com chaves derivadas; usuários que utilizavam cookies antigos precisam entrar novamente. JWTs Bearer, refresh tokens persistidos e links de email permanecem compatíveis.

## Testes e evidências

```sh
npm run test:all
npm run test:parity # requer Python 3, SDK .NET 10 e a pasta de origem ao lado
```

`test:all` executa build, testes de contratos/segurança/provedores, início e encerramento pelos scripts npm, PostgreSQL real descartável, importador e auditoria de preservação da origem. `test:parity` copia a origem para `.tmp`, compila a cópia e compara HTTP contra ela usando outro PostgreSQL descartável. Nenhum teste modifica dados do banco existente. O relatório da comparação declara o alcance dos cenários, a normalização de timestamps e a diferença justificada do histórico de email.

As funções SQL originais e as sete suítes SQL foram preservadas. A imagem de PostgreSQL usada nos testes locais é 17.10; a conexão existente foi verificada somente por leitura no PostgreSQL 17.11. Os testes de provedores não enviam emails reais nem geram consumo na OpenAI.

## Importação administrativa

```sh
npm run import:prova -- arquivo.json
CONCURSA_API_URL=http://127.0.0.1:3000 CONCURSA_IMPORT_TOKEN=TOKEN npm run import:prova -- arquivo.json --aplicar
```

A primeira execução somente valida. `--aplicar` exige token de administrador, confere prova e temas, salva progresso e permite retomada. O importador antigo da apostila continua explicitamente descontinuado, como na origem. Não registre o token em arquivos versionados ou histórico de shell.

## Documentação detalhada

- [Inventário e checklist de módulos/rotas](docs/MIGRACAO.md).
- [Configurações, integrações, banco e operação](docs/CONFIGURACAO.md).
- [Resultados, diferenças e bloqueios](docs/VALIDACAO.md).
- [Inventário de 469 arquivos e hashes da origem](docs/source-inventory.json).
- [Comparação HTTP executada](docs/http-parity-results.json).
