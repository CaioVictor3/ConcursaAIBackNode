# Validação, diferenças e bloqueios

## Resultados executados

- Build TypeScript estrito: passou.
- Testes Node de contratos, segurança, criptografia, provedores, limite por IP, inicialização e shutdown: 13 testes passaram.
- Integração com PostgreSQL 17 real e descartável: inclui migração do histórico completo, as sete suítes SQL originais, autenticação, RLS concorrente, cadastros, provas, questões, simulados, correção, estudo, IA, suporte, comunicação e navegador. Resultados detalhados na execução de `npm run test:postgres`.
- Importador administrativo: 5 testes passaram.
- Comparação HTTP executada das 96 rotas contra uma cópia .NET compilada: 95 respostas equivalentes nos cenários escolhidos e uma correção de erro SQL explicitamente aceita pelo teste. 97 verificações da suíte passaram. [Evidência JSON](http-parity-results.json).
- Suíte .NET original executada em cópia isolada: 149 testes passaram, zero ignorados.
- `npm audit --omit=dev`: zero vulnerabilidades relatadas na execução.
- Conexão existente: consulta somente de leitura confirmou PostgreSQL 17.11, TLS verificado e usuário restrito. Não houve DDL, alteração de dados, envio de emails ou geração de IA no ambiente existente.
- ViaCEP real: requisição pública para CEP de teste confirmou conectividade e formato esperado.
- `npm run dev` e `npm run start`: iniciaram em 127.0.0.1, responderam health na porta configurada e encerraram por SIGTERM.
- Auditoria por hashes: 469 arquivos relevantes da origem preservados.

Os testes com provedores controlados existem somente nos arquivos de teste. O runtime usa HTTP real e PostgreSQL real; não contém repositório em memória ou respostas fictícias. Não houve chamada real paga à OpenAI, envio real pelo Resend ou login real com Google.

## Diferenças técnicas documentadas

1. **Histórico de emails corrigido:** na origem, `FilaEmailsPostgres.ListarHistoricoAsync` concatena o SELECT que termina em `mensagem_erro` com `from` sem um espaço. A comparação real retornou 503 no .NET. O Node usa SQL válido, preserva filtros/paginação/DTO e retorna 200. Essa correção evita reproduzir um defeito e está explícita na evidência de comparação.
2. **Cookies exigem novo login:** o Node utiliza AES-256-GCM com derivação por finalidade em vez do formato ASP.NET Data Protection. Nomes, proteção HttpOnly/SameSite/Secure, chunking, vida útil e contratos HTTP foram preservados. Cookies emitidos pelo .NET não são decifrados; precisam ser substituídos por novo login. Os JWTs, refresh tokens no banco e links cifrados de emails usam formatos compatíveis e a chave original foi conservada no `.env` local.
3. **Informação de runtime:** `versaoDotNet` no endpoint legado continua existindo para preservar o campo público, mas informa a versão Node. O health adicional identifica `runtime=node`.
4. **Porta e host:** padrão alterado de localhost:5252 para 127.0.0.1:3000, conforme solicitado. Ambos configuráveis.
5. **OpenAPI:** mantido `/openapi/v1.json`, acrescentados `/api/openapi.json` e Swagger em `/api/docs`, disponíveis também na produção.
6. **Importador:** lê `CONCURSA_API_URL` com padrão 127.0.0.1:3000 e não depende de appsettings nem de arquivos do .NET. Mantém validação, progresso, retomada e autenticação administrativa.
7. **Segurança da conexão:** usa `pg` com validação TLS completa, CA pública e papel restrito, no lugar do Npgsql. O pool preserva os parâmetros configurados de 20 conexões, 15 s para conexão e 60 s para comandos. A API não aplica migrations ao iniciar.
8. **HTTPS público:** o proxy/serviço de hospedagem termina TLS; o processo Node escuta HTTP interno configurável, sem redirecionamento automático baseado em headers não confiáveis. Helmet aplica headers de segurança.

A comparação normaliza representações de timestamps para UTC e desconsidera a versão do runtime e os IDs aleatórios de rastreamento. GETs usam registros de teste; mutações são comparadas com entradas vazias para verificar binding, defaults, autenticação e erros sem interferir entre as duas implementações. Fluxos positivos possuem testes próprios; nenhuma afirmação de equivalência cobre cenários não exercitados.

## Limitações já existentes preservadas

O banco impede criar concursos pelo contrato legado sem organizadora (`Informe a organizadora pelo cadastro de provas`). A criação atual deve usar `/api/Prova/criar-prova`. O Node conserva a resposta do endpoint antigo, sem alterar seu contrato ou contornar as constraints. Simulados/assuntos antigos e novos fluxos de provas/temas continuam coexistindo conforme o schema original.

O limitador usa memória do processo, como na origem. O worker preserva a semântica de aceite/entrega, idempotência e retenção; não promete entrega exatamente uma vez de ponta a ponta.

## Bloqueios reais para homologação integral

- `OPENAI_API_KEY`: não encontrada nas configurações disponíveis. Implementação preserva Responses API, modelo gpt-4.1-mini, prompt e schema; teste real depende de credencial de homologação.
- `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`: vazios na configuração original. Login real exige aplicação OAuth e URL de retorno cadastrada. Assinaturas, JWKS, nonce, azp, PKCE e vínculos foram exercitados em teste.
- `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_WEBHOOK_SECRET`: ausentes nas configurações ativas disponíveis. Envio/entrega/webhook reais dependem dessas credenciais e de remetente/domínio verificado.
- Docker: daemon local indisponível. O Dockerfile foi preparado e inspecionado; não foi declarado build de imagem bem-sucedido.

A implementação não deixa funcionalidades substituídas por mocks de produção. **A migração não é declarada integralmente concluída ou homologada para produção enquanto esses critérios externos permanecerem pendentes.** A API está executável localmente com a conexão existente e pronta para receber as configurações externas faltantes.
