# Pagamentos antecipados — ConcursaAI / Mercado Pago

Implementação em 24/10/2026. Backend existente Next.js/TypeScript, frontend React/Vite e Supabase Auth/Data API preservados. Não foi introduzido um backend .NET nem uma segunda autenticação.

## Produto escolhido e pesquisa oficial

Foi escolhido **Checkout Pro hospedado, via Orders API**, com `type=online`, `processing_mode=manual` e captura assíncrona. O servidor usa um cliente HTTP tipado com `fetch`, timeout e retentativa limitada. Não foi necessária uma dependência adicional de SDK.

| Alternativa | Avaliação |
| --- | --- |
| Checkout Pro por Preferences | Hospedado e ainda documentado; usa preferências e consultas de Payments. Não foi misturado com o modelo Orders. |
| Checkout Pro por Orders | Escolhido: checkout hospedado, criação com idempotência documentada e consulta do ciclo financeiro pelo mesmo recurso. |
| Checkout Transparente/API por Orders | Permite formulário próprio, mas amplia o trabalho de captura/tokenização. Desnecessário para este produto. |
| Assinaturas/preapproval | Cobrança recorrente; incompatível com o modelo comercial solicitado. |

Documentação oficial consultada:

- [Visão geral do Checkout Pro por Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/overview) — experiência hospedada, Pix e cartão, comparação com as outras modalidades.
- [Criação de order](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/create-order) e [referência POST](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro/create-order/post) — valores decimais em texto, referência externa, `checkout_url` e `X-Idempotency-Key`.
- [Consulta GET](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro/get-order/get) e [estados](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/payment-management/status/order-status) — estados da order e transações.
- [Retorno](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/web-integration/configure-back-urls) — `config.online.success_url`, `pending_url`, `failure_url` e `auto_return`.
- [Meios de pagamento e parcelas](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/additional-settings/exclude-payment-methods) — `config.payment_method.max_installments`, exclusão de boleto. Pix não é excluído. Parcelamento depende da oferta do provedor e não é anunciado como sem juros.
- [Webhooks](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/notifications), [validação sem SDK](https://www.mercadopago.com.br/developers/en/docs/checkout-pro-preferences/additional-settings/optional-notifications) e [orientação oficial do SDK Node](https://github.com/mercadopago/sdk-nodejs/blob/master/docs/webhooks.md) — HMAC, comparação constante, tolerância temporal, confirmação rápida e processamento idempotente.
- [Reembolsos/cancelamentos](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/refunds-cancellations) — endpoints `/v1/orders/{id}/refund` e `/cancel`, requisitos e limitações. A documentação informa prazo de até 180 dias para reembolso e necessidade de saldo; a decisão final pertence ao provedor.
- [Contestações](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/chargebacks/notifications) e [gerenciamento](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/chargebacks/manage) — acompanhamento por notificações de order e pelo painel Mercado Pago.
- [Credenciais Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/resources/credentials) e [compra com cartão de teste](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/integration-test/test-purchase-with-card).
- [Preferências](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/overview), [Checkout API/Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/overview) e [migração Payments/Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/migrate-payments-to-orders) — comparação e diferenças de estados/endpoints.
- [RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security), [changelog](https://supabase.com/changelog) e [implementação oficial Mercado Pago da verificação de conta de teste](https://github.com/mercadopago/cart-magento2/blob/main/src/MercadoPago/Core/Observer/ConfigObserver.php).

**Credenciais de teste de Orders também começam com `APP_USR`.** Não use o prefixo para decidir o ambiente. Copie a credencial com o seletor **Teste** aberto no painel. Antes de criar uma order, o cliente verifica `/users/me`, ID do vendedor, país MLB e a identificação `test_user`; a resposta da order também deve corresponder à aplicação, vendedor, ambiente e valor esperados. O fluxo manual de teste documentado retorna IDs `ORDTST...`.

## Fluxo e regras financeiras

1. O aluno confirma o resumo da compra. O corpo HTTP contém apenas `idPlano`; uma UUID de idempotência segue em header e é preservada nas retentativas.
2. O servidor verifica a sessão Supabase e o cadastro. A RPC bloqueia a identidade do estudante, consulta o plano ativo e copia preço, moeda, duração, nome e benefícios para o pedido/assinatura pendente.
3. A criação de checkout possui reserva com vencimento. Seu payload e sua chave ficam persistidos; uma falha ambígua pode ser repetida com os mesmos dados. Cliques concorrentes para o mesmo plano reutilizam o pedido aberto.
4. O navegador recebe apenas a URL HTTPS validada do Mercado Pago. Token, segredo, CVV e número de cartão não chegam ao frontend.
5. O webhook valida `data.id`, `x-request-id` e `x-signature`. O manifesto segue o formato oficial, com ID alfanumérico em minúsculas, HMAC-SHA256 e comparação constante. Rejeita timestamps fora da janela de cinco minutos. O corpo não fornece a verdade financeira.
6. O evento é persistido antes do HTTP 200. `after()` tenta processá-lo; o agendador recupera falhas, interrupções ou reservas vencidas.
7. O processamento consulta a order diretamente no provedor, valida os vínculos e aplica pagamento, assinatura e histórico numa única transação PostgreSQL. Versões antigas são ignoradas. Uma order origina no máximo um período.
8. A liberação exige confirmação assinada e consulta ao provedor. Apenas consultar o pedido ou receber um redirect de sucesso não ativa Premium.
9. Uma renovação antecipada começa no fim do último período válido; após vencimento, começa na confirmação. São somados meses de calendário em UTC, com ajuste natural para o fim do mês.
10. O estorno integral cancela somente o período vinculado. A contestação suspende esse período. Outros períodos pagos não são encurtados nem antecipados. Pode haver uma lacuna de acesso caso o período anterior seja revertido.

Reembolso parcial conserva a vigência originalmente paga e registra o valor devolvido; não aplica rateio automático. Contestações permanecem suspensas para análise, inclusive após mudança de detalhe do caso, até revisão operacional. Não existe aprovação arbitrária de pagamento nem concessão administrativa fictícia de acesso.

Cancelamento solicitado pelo estudante é registrado para análise e aparece na administração. Preserva o período pago enquanto o suporte analisa a política comercial e os direitos aplicáveis. Um estorno/cancelamento financeiro autorizado é executado pelo administrador e o acesso acompanha a confirmação do provedor. A política comercial e o atendimento precisam ser publicados pelo responsável antes da venda.

## Persistência e segurança

Migration: `database/migrations/20261024040828_pagamentos_mercado_pago.sql`. Aplicar após as migrations já existentes, pelo processo de deployment do projeto. Não executa migrations no runtime. O nome foi criado com a CLI Supabase e movido para a pasta de migrations adotada pelo repositório.

- `planos_comerciais`: seed idempotente de mensal (19,90 / 1 mês), semestral (101,40 / 6 meses), anual (166,80 / 12 meses). Preços não ficam no código de produção.
- `pedidos_pagamento`: intenção de compra, condições imutáveis, referência externa, chave, payload, checkout e versão da order.
- `pagamentos`: visão financeira da compra, IDs MP como texto, método, parcelas, aprovação e estornos.
- `assinaturas`: período individual por compra, com FK única para pedido/pagamento.
- `historico_assinaturas` e `avisos_assinatura`: rastreabilidade e alertas sem duplicação.
- Schema privado `financeiro`: configuração de ambiente, inbox persistente, auditoria e limites de requisições.
- `numeric(12,2)` no banco e decimais em texto na fronteira MP; cálculos financeiros de validação usam centavos inteiros.
- FKs sem remoção em cascata do histórico financeiro, índices de proprietário, vencimento, conciliação e reservas; unicidade de pedido, pagamento, referência e idempotência.
- Leituras de financeiro usam sessão/RLS. Escritas financeiras só por RPC de backend permitida a `service_role`; segredo Supabase continua exclusivamente no servidor.
- Verificação central em `tem_acesso_premium()`, guard HTTP e políticas restritivas no acervo. RPCs que executam como proprietário também recebem guard explícito. Perfil, suporte e histórico financeiro continuam disponíveis sem Premium.
- Dez mutações financeiras por minuto por estudante e trinta por administrador, persistidas no PostgreSQL; consulta ao provedor possui intervalo mínimo de dez segundos por pedido.
- Logs só registram identificador de requisição, rota, classe da falha e status. Inbox mantém código de erro, nunca assinatura completa ou dados de cartão.

A configuração privada inicia com `ambiente='teste'`. O acesso exige que o ambiente da compra corresponda ao ambiente configurado no banco. Assim, compras de teste não concedem Premium depois da promoção para produção.

## Arquivos e endpoints

Camadas novas: domínio em `domain/pagamentos-assinaturas.ts`; configuração em `config/configuracoes-mercado-pago.ts`; aplicação em `application/pagamentos-assinaturas.service.ts`; cliente/repositório em `infrastructure`; HTTP em `http/rotas-financeiro-next.ts`; worker em `worker-pagamentos-supabase.ts`.

Todas as rotas abaixo começam com `/api/financeiro`. Aceitam os envelopes JSON já utilizados pelo frontend. Sessão por cookies HttpOnly ou Bearer. Mutações por cookies exigem Origin permitido e `X-Concursa-Client: web`.

| Método / sufixo | Finalidade / entrada |
| --- | --- |
| GET `/planos` | Catálogo público ativo |
| GET `/acesso` | `{premium}` do estudante |
| GET `/minha-assinatura` | Períodos, pedidos, pagamentos, avisos e histórico |
| POST `/checkout` | `{idPlano}`, header `X-Idempotency-Key` UUID |
| GET `/pedido?id=UUID` | Pedido do estudante autenticado |
| POST `/sincronizar` | `{id}` do pedido próprio |
| POST `/cancelamento` | `{id}` da assinatura e `justificativa` |
| GET `/admin/painel` | Planos, transações, assinaturas, histórico e indicadores; filtros `pessoa` UUID, `plano`, `status`, `de`, `ate`, `vencimento`, `pagina` |
| POST/PUT `/admin/planos` | Cadastro/edição de plano |
| POST `/admin/sincronizar` | `{id}` do pedido, com auditoria |
| POST `/admin/operacao` | `{id,acao,justificativa}`, ação `cancelar` ou `estornar` integral |
| POST `/admin/reprocessar` | Recoloca eventos com falha na fila |
| POST `/webhook` | Público; exige assinatura válida e `data.id` na query |
| POST ou GET `/tarefas` | Manutenção; Bearer `MP_WORKER_SECRET`, não a sessão de aluno |

O OpenAPI inclui essas rotas. DTOs de integração e estados estão nos módulos de domínio/cliente; os tipos de apresentação estão em `ConcursaAI/src/types/financeiro.ts` e as chamadas em `services/requisicoesFinanceiroHttp.ts`.

Frontend: `/planos`, `/pagamento/retorno?pedido=UUID`, `/estudante/minha-assinatura` e `/administracao/financeiro`. Minha conta e a navegação lateral apontam para a assinatura. `AcessoPremium` adapta as páginas de estudo ao estado do servidor. Alertas de proximidade de vencimento aparecem na assinatura; o worker também enfileira e-mails no serviço Resend existente.

O painel diferencia bruto, estornos, valores contestados e líquido estimado. A estimativa não representa saldo liquidado e não deduz taxas, tributos ou custos do cartão. Não projeta receita recorrente garantida. Consultas do estudante mostram até 100 registros recentes por coleção; administração tem páginas de 30 registros.

## Configuração e operação

Veja `.env.example`. Todos os campos `MP_*` pertencem ao backend:

- `MP_AMBIENTE=teste`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_SELLER_ID`, `MP_APPLICATION_ID`.
- `MP_RETORNO_URL`: URL HTTPS pública do frontend, terminando em `/pagamento/retorno`, sem query. O servidor acrescenta o pedido.
- `MP_MAX_PARCELAS=1`: padrão conservador; configure até 12 após validar a oferta/custos da conta. Mensal permanece à vista; semestral/anual aceitam o limite configurado.
- `MP_TIMEOUT_MS=7000`; falhas transitórias têm uma retentativa curta com a mesma chave. `Retry-After` maior que um segundo deixa a recuperação para o agendador.
- `MP_WORKER_SECRET`: segredo aleatório de pelo menos 32 caracteres para o agendador externo.
- `MP_PRODUCAO_HABILITADA=false`; operações de cancelamento/estorno ficam bloqueadas por padrão com `MP_OPERACOES_FINANCEIRAS_HABILITADAS=false` e, em produção, também exigem `MP_OPERACOES_PRODUCAO_AUTORIZADAS=true`.
- `EMAIL_SUBSCRIPTION_EXPIRING_ENABLED=true`, além da configuração Resend já existente.

No painel Mercado Pago, crie uma aplicação de Checkout Pro por Orders. Selecione **Teste**, copie as credenciais correspondentes, confira IDs da conta/aplicação e configure a URL HTTPS `https://API/api/financeiro/webhook`. Habilite **Order (Mercado Pago)** e **Contestações**. O provedor envia `data.id` e os headers de assinatura; não configure IPN. O webhook é configurado no painel, sem adicionar um parâmetro de preferências à criação da order.

Use um agendador externo a cada minuto para chamar `/tarefas` com o Bearer apropriado. Alternativa em ambiente com scheduler de processos:

```sh
npm run build:worker
npm run worker:pagamentos
```

Esse worker executa um ciclo e termina. Executá-lo continuamente não é necessário. Ele expira assinaturas, cria alertas de 7/3/1/0 dias e concilia pedidos por lotes. A fila tem reserva recuperável e até 12 tentativas, com backoff limitado a uma hora. Eventos esgotados aparecem no painel para reprocessamento. Cada ciclo reserva até três eventos e deixa de iniciar novas conciliações após um minuto, preservando margem para encerrar a chamada no limite do servidor. A conciliação periódica considera orders dos últimos 400 dias, até três por ciclo; monitore o atraso e dimensione o agendamento conforme o volume. Webhooks permanecem processáveis independentemente dessa janela.

O processo de e-mail existente deve continuar em execução: `npm run worker:email`. Não foi criado um segundo serviço de envio.

## Homologação e produção

1. Aplicar a migration num projeto Supabase de homologação e configurar o backend.
2. Configurar a aplicação Mercado Pago em Teste e uma URL HTTPS alcançável para webhook/retorno. Para desenvolvimento local, usar publicação de homologação ou túnel controlado pelo operador.
3. Fazer compras com cartões oficiais de teste para aprovação, recusa e pendência. Verificar o webhook, fila, pagamento e início/fim do acesso no banco.
4. Confirmar a disponibilidade de Pix no checkout da conta. O código permite o método; não foi adicionado fluxo de Checkout Transparente para simular Pix. Ausência do método no ambiente de teste não deve ser contornada com cobranças reais.
5. Validar parcelas com as condições comerciais reais oferecidas no checkout; não anunciar juros inexistentes.
6. Antes da produção, publicar política comercial, configurar atendimento, monitoramento e agendamento. Definir explicitamente o tratamento dos usuários existentes, pois endpoints Premium passam a exigir uma compra confirmada.
7. **Somente com autorização do responsável**, configurar credenciais de produção e novos segredos/URLs, definir `MP_AMBIENTE=producao`, habilitar `MP_PRODUCAO_HABILITADA=true` e atualizar a configuração privada do banco no projeto de produção:

```sql
update financeiro.configuracao set ambiente='producao' where id=true;
```

Compras de teste continuam históricas e não concedem acesso nesse ambiente. Não apagar registros financeiros para promover o sistema. Estornos reais exigem autorização operacional adicional, justificativa e auditoria.

## Verificações e pendências

Testes automatizados usam PostgreSQL 17 descartável, identidades locais explicitamente identificadas como fixtures e respostas HTTP simuladas conforme os contratos documentados. Não usam credenciais reais nem efetuam cobranças.

Cobertura: dinheiro/estados; assinatura e replay; moeda/valor/vendedor/aplicação/ambiente; URLs; idempotência de criação e clique concorrente; snapshots; ativação por webhook; renovação mensal/semestral/anual; meses de calendário; ordem dos eventos; estorno/contestação; expiração; plano inexistente/inativo; isolamento/RLS; permissões administrativas; inbox, reservas, falha transitória e reprocessamento; quotas; avisos/e-mails sem duplicação. Há um teste integrado do service com HTTP MP simulado e PostgreSQL real, além da regressão dos módulos de estudo/autenticação.

A página de planos e seu modal foram conferidos no navegador em desktop e 390×844, com catálogo vindo do PostgreSQL descartável.

**Pendente externamente:** as variáveis MP não estavam configuradas no ambiente local; não foi possível efetuar homologação contra o gateway. A migration foi validada localmente e não aplicada a um Supabase remoto. Ainda é preciso configurar credenciais de teste, application/seller IDs, webhook/retorno HTTPS e scheduler; depois executar a homologação no painel. Nenhuma credencial de produção ou transação financeira real foi utilizada. O deploy comercial ainda depende dessa homologação e da ativação autorizada de produção.

Limitações deliberadas: checkout hospedado; estorno administrativo integral (parciais recebidos são conciliados); sem rateio de vigência; evidências e resolução operacional de contestações continuam no Mercado Pago; suspensão não é removida automaticamente por eventos antigos ou por um simples redirect. A cobrança é sempre avulsa e não existe agendamento de débito nem `/preapproval`.

### Resultados desta entrega

| Verificação | Resultado |
| --- | --- |
| Backend `npm run build` (inclui workers) | Passou |
| Backend `npm test` | 39 testes passaram |
| Backend `npm run test:postgres` | 33 testes passaram, migrations em PostgreSQL descartável |
| Backend `npm run test:importacao` | 5 testes passaram |
| Frontend `npm run build` | Passou |
| Frontend `npm test` | 55 testes passaram |
| Frontend `npm run lint` | Passou, sem avisos |
| Prettier / `git diff --check` | Passaram nos dois projetos |
| Verificação visual de planos e resumo | Desktop e 390×844 |
| Homologação contra Mercado Pago | Pendente: credenciais e URLs não configuradas |

Duas verificações legadas não puderam concluir: `check:parity` procura o diretório ausente `../ConcursaAI.BackEnd`; `arquitetura:verificar` procura o snapshot ausente `ConcursaAI.Backend/ConcursaAI.Api/Contratos/openapi.snapshot.json`. Os scripts dependem da antiga árvore .NET, que não está neste workspace. Não foram criadas cópias fictícias para fazê-los passar. Builds, typechecks, testes funcionais e formatação executaram sobre os projetos atuais.

Nos testes de regressão, os estudantes passaram a receber uma fixture Premium identificada explicitamente como local, exclusivamente no banco descartável. O adaptador também atualiza a asserção antiga de privilégio de IA para refletir o grant já existente na migration da Data API, sem editar as migrations/fixtures arquivadas de referência.
