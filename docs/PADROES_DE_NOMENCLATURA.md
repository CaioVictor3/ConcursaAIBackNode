# Padrões de nomenclatura e leitura

O código da API usa nomes em português que indicam domínio e responsabilidade. Arquivos de aplicação terminam em `.service.ts` e identificam a operação principal: `cadastro-bancas.service.ts`, `resolucao-correcao-tentativas.service.ts` e `revisao-questoes-metas-estudo.service.ts`. Clientes externos ficam em arquivos próprios, como `cliente-autenticacao-google.ts`, `cliente-analise-questoes-openai.ts` e `cliente-enderecos-viacep.ts`.

Os 172 contratos TypeScript estão separados em 16 arquivos sob `src/contracts/modelos`. O arquivo `modelos-requisicoes-respostas-api.ts` expõe esses tipos e o mapa usado pela validação HTTP. O worker de emails está separado do serviço de envio; as consultas SQL ativas têm nomes de operação em `consultas-sql-emails-transacionais.ts`. A lista de endpoints, os metadados de serialização e os mapeamentos PostgreSQL têm nomes específicos em `src/contracts`.

Use nomes que expressem o conteúdo e o papel da variável: `solicitacaoCriarBanca`, `identificadorBanca`, `repositorioNegocio`, `paginaRegistros`, `clienteTransacaoPostgreSql`. Evite letras isoladas, nomes como `data` ou `result` sem contexto, e reutilizar um nome de variável em um callback interno. Prefixe operações de validação, consulta, criação e atualização com verbos correspondentes. Separe responsabilidades quando um arquivo começar a reunir operações de domínios diferentes.

Indentação: dois espaços, chaves em condicionais e laços, e uma linha em branco entre etapas de uma função e entre métodos. O arquivo `.editorconfig` configura editores; `.prettierrc.json` define a formatação. Execute `npm run format` ao editar e `npm run format:check` para verificar. `npm run build` também verifica tipos estritos e imports não utilizados.

Nomes de campos JSON, URLs HTTP, códigos de status, variáveis de ambiente, colunas SQL, parâmetros das funções PostgreSQL e nomes exigidos por bibliotecas externas permanecem iguais aos contratos existentes. Alterá-los exige migração de clientes ou banco; nomes internos podem evoluir sem esse efeito. Consulte `docs/MIGRACAO.md` para o vínculo entre cada rota original e seu serviço atual.
