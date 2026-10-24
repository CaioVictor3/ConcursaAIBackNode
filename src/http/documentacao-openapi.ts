import routes from "../contracts/rotas-publicas-api.json" with { type: "json" };
import { obterCamposContrato, metadata } from "../contracts/validacao-conversao-contratos-api.js";

type EsquemaOpenApi = Record<string, unknown>;

export function gerarDocumentoOpenApi() {
  const schemaFor = (type: string, nullable = false): EsquemaOpenApi => {
    let textoNormalizado: EsquemaOpenApi;

    if (type.startsWith("IReadOnlyList<")) {
      textoNormalizado = { type: "array", items: schemaFor(type.slice(14, -1)) };
    } else if (metadata[type]) {
      textoNormalizado = { $ref: "#/components/schemas/" + type };
    } else {
      textoNormalizado = {
        type: ["int", "long"].includes(type)
          ? "integer"
          : ["decimal", "double"].includes(type)
            ? "number"
            : type === "bool"
              ? "boolean"
              : "string",
        ...(type === "Guid"
          ? { format: "uuid" }
          : type === "DateOnly"
            ? { format: "date" }
            : type === "DateTimeOffset"
              ? { format: "date-time" }
              : {}),
      };
    }

    return nullable ? { anyOf: [textoNormalizado, { type: "null" }] } : textoNormalizado;
  };

  const schemas: Record<string, EsquemaOpenApi> = {};

  for (const name of Object.keys(metadata)) {
    const properties: Record<string, EsquemaOpenApi> = {};

    for (const campoContrato of obterCamposContrato(name)) {
      properties[campoContrato.name] = schemaFor(campoContrato.type, campoContrato.nullable);
    }

    if (name === "QuestaoPublicaResponseModel" || name === "QuestaoResponseModel") {
      properties.revisaoPendente = { type: "boolean", readOnly: true };
    }

    schemas[name] = {
      type: "object",
      properties,
      required: Object.keys(properties),
      "x-contract-module": metadata[name]!.source.split("/").slice(2, -1).join("/"),
    };
  }

  const paths: Record<string, Record<string, unknown>> = {};

  for (const rotaApi of routes) {
    const responses = Object.fromEntries(
      [200, 400, 401, 403, 404, 409, 429, 500, 502, 503, 504].map((code) => [
        code,
        {
          description: code === 200 ? "Operação concluída" : "Falha",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  message: { type: "string" },
                  statusCode: { type: "integer" },
                  data: code === 200 ? schemaFor(rotaApi.response, true) : { type: "null" },
                },
              },
            },
          },
        },
      ]),
    );

    const op: Record<string, unknown> = {
      operationId: rotaApi.controller + "_" + rotaApi.action,
      tags: [rotaApi.controller],
      security: rotaApi.anonymous ? [] : [{ bearerAuth: [] }],
      responses,
    };

    if (rotaApi.binding === "query") {
      op.parameters = obterCamposContrato(rotaApi.request).map((campoContrato) => ({
        in: "query",
        name: campoContrato.name,
        required: false,
        schema: schemaFor(campoContrato.type, campoContrato.nullable),
      }));
    } else {
      op.requestBody = {
        required: true,
        content: { "application/json": { schema: schemaFor(rotaApi.request) } },
      };
    }

    if (rotaApi.controller === "Navegador") {
      op.description =
        "Rota de sessão HttpOnly utilizada pelo frontend. Para testá-la, abra /api/docs pela origem do frontend, cadastrada em CORS_ORIGINS. O navegador envia Origin automaticamente. Para autenticar no Swagger da API, prefira as rotas Autenticacao e o botão Authorize.";
      op.parameters = [
        ...((op.parameters as unknown[]) ?? []),
        {
          in: "header",
          name: "X-Concursa-Client",
          required: rotaApi.method !== "GET",
          schema: { type: "string", enum: ["web"] },
        },
      ];
    }

    if (rotaApi.controller === "ResendWebhook") {
      op.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                type: { type: "string" },
                data: {
                  type: "object",
                  properties: { email_id: { type: "string" } },
                },
              },
            },
          },
        },
      };

      op.parameters = ["svix-id", "svix-timestamp", "svix-signature"].map((name) => ({
        in: "header",
        name,
        required: true,
        schema: { type: "string" },
      }));
    }

    (paths[rotaApi.path] ??= {})[rotaApi.method.toLowerCase()] = op;
  }

  paths["/api/health"] = {
    get: {
      operationId: "health",
      tags: ["Saúde da API"],
      security: [],
      responses: { 200: { description: "Processo em execução" } },
    },
  };

  paths["/api/health/ready"] = {
    get: {
      operationId: "verificarConexaoSupabase",
      tags: ["Saúde da API"],
      security: [],
      responses: {
        200: { description: "Conexão com o Supabase disponível" },
        503: { description: "Conexão com o Supabase indisponível" },
      },
    },
  };

  const respostaHonra = (descricao: string, schema: EsquemaOpenApi = { type: "object" }) => ({
    200: {
      description: descricao,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["success", "message", "statusCode", "data"],
            properties: {
              success: { type: "boolean" },
              message: { type: "string" },
              statusCode: { type: "integer" },
              data: schema,
            },
          },
        },
      },
    },
    400: { description: "Dados inválidos" },
    401: { description: "Autenticação necessária" },
    403: { description: "Acesso não autorizado" },
  });

  const segurancaHonra = [{ bearerAuth: [] }];
  const parametroPessoa = {
    in: "path",
    name: "idPessoa",
    required: true,
    schema: { type: "string", format: "uuid" },
  };
  const parametroQuestao = {
    in: "path",
    name: "idQuestao",
    required: true,
    schema: { type: "string", format: "uuid" },
  };
  const parametrosPagina = [
    { in: "query", name: "pagina", schema: { type: "integer", minimum: 1, default: 1 } },
    {
      in: "query",
      name: "quantidadePorPagina",
      schema: { type: "integer", minimum: 1, maximum: 50, default: 20 },
    },
  ];
  const corpoJson = (properties: Record<string, EsquemaOpenApi>, required: string[]) => ({
    required: true,
    content: {
      "application/json": {
        schema: { type: "object", properties, required, additionalProperties: false },
      },
    },
  });

  paths["/api/honra/estudante/meu-progresso"] = {
    get: {
      operationId: "Honra_consultarMeuProgressoHonra",
      tags: ["Sistema de Honra"],
      security: segurancaHonra,
      responses: respostaHonra("Título, saldo, jornada e indicadores do estudante"),
    },
  };

  paths["/api/estudo/estudante/painel-desempenho"] = {
    get: {
      operationId: "Estudo_consultarPainelDesempenhoEstudante",
      tags: ["Desempenho do estudante"],
      security: segurancaHonra,
      responses: respostaHonra("Métricas acadêmicas agregadas, evolução e PH separados"),
    },
  };

  paths["/api/honra/estudante/historico-pontos"] = {
    get: {
      operationId: "Honra_consultarMeuHistoricoPontos",
      tags: ["Sistema de Honra"],
      security: segurancaHonra,
      parameters: parametrosPagina,
      responses: respostaHonra("Movimentações paginadas do estudante"),
    },
  };

  paths["/api/honra/administracao/painel-sistema-honra"] = {
    get: {
      operationId: "Honra_consultarPainelAdministrativoHonra",
      tags: ["Administração · Honra"],
      security: segurancaHonra,
      responses: respostaHonra("Títulos, regras, distribuição e movimentações recentes"),
    },
  };

  paths["/api/honra/administracao/estudantes/{idPessoa}/historico-pontos"] = {
    get: {
      operationId: "Honra_consultarHistoricoAdministrativoEstudante",
      tags: ["Administração · Honra"],
      security: segurancaHonra,
      parameters: [parametroPessoa, ...parametrosPagina],
      responses: respostaHonra("Movimentações paginadas de um estudante"),
    },
  };

  paths["/api/honra/administracao/titulos-honra"] = {
    post: {
      operationId: "Honra_salvarTituloHonra",
      tags: ["Administração · Honra"],
      security: segurancaHonra,
      requestBody: corpoJson(
        {
          id: { type: "string", format: "uuid" },
          nivel: { type: "integer", minimum: 1 },
          nome: { type: "string" },
          descricao: { type: "string" },
          pontuacaoMinima: { type: "integer", minimum: 0 },
          icone: { type: "string" },
          cor: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          ativo: { type: "boolean" },
        },
        ["nivel", "nome", "pontuacaoMinima", "icone", "cor", "ativo"],
      ),
      responses: respostaHonra("Título criado ou atualizado"),
    },
  };

  paths["/api/honra/administracao/regras-pontuacao/{codigoRegra}"] = {
    put: {
      operationId: "Honra_salvarRegraPontuacao",
      tags: ["Administração · Honra"],
      security: segurancaHonra,
      parameters: [{ in: "path", name: "codigoRegra", required: true, schema: { type: "string" } }],
      requestBody: corpoJson(
        {
          pontos: { type: "integer", minimum: 0 },
          minimoQuestoes: { type: "integer", minimum: 0 },
          minimoQuestoesIneditas: { type: "integer", minimum: 0 },
          percentualMinimoRespostas: { type: "integer", minimum: 0, maximum: 100 },
          limiteDiario: { type: "integer", minimum: 0 },
          ativo: { type: "boolean" },
        },
        [
          "pontos",
          "minimoQuestoes",
          "minimoQuestoesIneditas",
          "percentualMinimoRespostas",
          "limiteDiario",
          "ativo",
        ],
      ),
      responses: respostaHonra("Regra atualizada para futuras atividades"),
    },
  };

  paths["/api/honra/administracao/estudantes/{idPessoa}/ajustes-pontos"] = {
    post: {
      operationId: "Honra_registrarAjusteAdministrativo",
      tags: ["Administração · Honra"],
      security: segurancaHonra,
      parameters: [parametroPessoa],
      requestBody: corpoJson(
        {
          pontos: { type: "integer", minimum: -10000, maximum: 10000 },
          justificativa: { type: "string", minLength: 10 },
        },
        ["pontos", "justificativa"],
      ),
      responses: respostaHonra("Ajuste auditável registrado"),
    },
  };

  paths["/api/estudo/questoes/{idQuestao}/anotacao-pessoal"] = {
    get: {
      operationId: "Estudo_consultarAnotacaoPessoalQuestao",
      tags: ["Anotações pessoais"],
      security: segurancaHonra,
      parameters: [parametroQuestao],
      responses: respostaHonra("Anotação privada associada à questão"),
    },
    put: {
      operationId: "Estudo_salvarAnotacaoPessoalQuestao",
      tags: ["Anotações pessoais"],
      security: segurancaHonra,
      parameters: [parametroQuestao],
      requestBody: corpoJson({ conteudo: { type: "string", maxLength: 10000 } }, ["conteudo"]),
      responses: respostaHonra("Anotação criada, alterada ou removida"),
    },
  };

  paths["/api/ia/estudante/questoes/{idQuestao}/historico-perguntas"] = {
    get: {
      operationId: "InteligenciaArtificial_consultarHistoricoPerguntasContextuais",
      tags: ["Inteligência artificial · Perguntas contextuais"],
      security: segurancaHonra,
      parameters: [
        parametroQuestao,
        {
          name: "idTentativa",
          in: "query",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: respostaHonra("Histórico privado de perguntas da questão"),
    },
  };

  paths["/api/ia/estudante/questoes/{idQuestao}/perguntas-contextuais"] = {
    post: {
      operationId: "InteligenciaArtificial_responderPerguntaContextualQuestao",
      tags: ["Inteligência artificial · Perguntas contextuais"],
      security: segurancaHonra,
      parameters: [parametroQuestao],
      requestBody: corpoJson(
        {
          idTentativa: { type: "string", format: "uuid" },
          pergunta: { type: "string", minLength: 5, maxLength: 1000 },
        },
        ["idTentativa", "pergunta"],
      ),
      responses: respostaHonra("Pergunta respondida e salva na conta do estudante"),
    },
  };

  const uuidFinanceiro = { type: "string", format: "uuid" };
  for (const [rota, metodo, descricao] of [
    ["planos", "get", "Catálogo de planos ativos; valores definidos pelo banco"],
    ["acesso", "get", "Verificação centralizada de acesso Premium vigente"],
    [
      "minha-assinatura",
      "get",
      "Acesso, períodos contratados, pedidos, pagamentos, histórico e avisos",
    ],
    ["pedido", "get", "Consultar pedido pertencente ao estudante autenticado"],
    ["checkout", "post", "Criar ou reutilizar checkout avulso Orders API; nunca recorrente"],
    [
      "sincronizar",
      "post",
      "Consultar estado da order no provedor sem confiar no redirecionamento",
    ],
    [
      "cancelamento",
      "post",
      "Registrar solicitação de cancelamento para análise preservando o período pago",
    ],
    [
      "admin/painel",
      "get",
      "Planos, pagamentos, assinaturas e indicadores; exige administrador ativo",
    ],
    ["admin/planos", "post", "Criar plano; exige administrador e registra auditoria"],
    ["admin/planos", "put", "Editar plano sem modificar condições contratadas"],
    ["admin/sincronizar", "post", "Conciliação administrativa auditada"],
    ["admin/reprocessar", "post", "Recolocar webhooks com falha na fila; exige administrador"],
    [
      "admin/operacao",
      "post",
      "Estorno total ou cancelamento; exige administrador, justificativa e habilitação operacional",
    ],
    ["webhook", "post", "Receber notificação assinada de order e persistir na fila"],
    [
      "tarefas",
      "post",
      "Expiração, avisos, reprocessamento e conciliação; exige Bearer MP_WORKER_SECRET",
    ],
  ] as const) {
    const operacao: Record<string, unknown> = {
      operationId: "Financeiro_" + rota.replaceAll("/", "_") + "_" + metodo,
      tags: ["Financeiro"],
      description: descricao,
      security: rota === "planos" || rota === "webhook" ? [] : [{ bearerAuth: [] }],
      responses: respostaHonra(descricao),
    };
    if (rota === "checkout") {
      operacao.requestBody = corpoJson({ idPlano: uuidFinanceiro }, ["idPlano"]);
      operacao.parameters = [
        { in: "header", name: "X-Idempotency-Key", required: true, schema: uuidFinanceiro },
      ];
    } else if (rota === "pedido")
      operacao.parameters = [{ in: "query", name: "id", required: true, schema: uuidFinanceiro }];
    else if (rota === "webhook")
      operacao.parameters = [
        { in: "query", name: "data.id", required: true, schema: { type: "string" } },
        ...["x-signature", "x-request-id"].map((name) => ({
          in: "header",
          name,
          required: true,
          schema: { type: "string" },
        })),
      ];
    else if (metodo !== "get")
      operacao.requestBody = {
        required: true,
        content: { "application/json": { schema: { type: "object" } } },
      };
    (paths["/api/financeiro/" + rota] ??= {})[metodo] = operacao;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "ConcursaAI API",
      version: "1.0.0",
      description:
        "Backend Next.js do ConcursaAI.\n\n" +
        "Para testar rotas protegidas: execute POST /api/Autenticacao/entrar-estudante ou /api/Autenticacao/entrar-administrador com e-mail e senha. Copie data.accessToken da resposta e informe somente o token em Authorize (sem o prefixo Bearer). A autorização permanece apenas nesta página e é removida ao recarregar.\n\n" +
        "As rotas Navegador utilizam cookies HttpOnly e a origem autorizada do frontend. Abra /api/docs pelo frontend para testar esse fluxo. As demais rotas também aceitam a sessão do frontend; no Swagger da API, utilize Bearer.",
    },
    servers: [{ url: "/", description: "Servidor atual" }],
    paths,
    components: {
      schemas,
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Informe data.accessToken retornado pelo login em Autenticacao, sem o prefixo Bearer.",
        },
      },
    },
  };
}
