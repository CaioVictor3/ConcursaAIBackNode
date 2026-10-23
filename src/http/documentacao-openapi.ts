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
      security: rotaApi.anonymous ? [] : [{ bearerAuth: [] }, { browserSession: [] }],
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
      op.parameters = [
        ...((op.parameters as unknown[]) ?? []),
        {
          in: "header",
          name: "X-Concursa-Client",
          required: rotaApi.method !== "GET",
          schema: { type: "string", enum: ["web"] },
        },
        {
          in: "header",
          name: "Origin",
          required: rotaApi.method !== "GET",
          schema: { type: "string" },
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
      security: [],
      responses: { 200: { description: "Processo em execução" } },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "ConcursaAI API",
      version: "1.0.0",
      description: "API Node.js independente; contratos preservados da API .NET.",
    },
    paths,
    components: {
      schemas,
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        browserSession: {
          type: "apiKey",
          in: "cookie",
          name: "concursa-sessao",
        },
      },
    },
  };
}
