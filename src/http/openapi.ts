import routes from "../contracts/routes.json" with { type: "json" };
import { metadata, fields } from "../contracts/codec.js";
type Schema = Record<string, unknown>;
export function openapi() {
  const schemaFor = (type: string, nullable = false): Schema => {
    let s: Schema;
    if (type.startsWith("IReadOnlyList<"))
      s = { type: "array", items: schemaFor(type.slice(14, -1)) };
    else if (metadata[type]) s = { $ref: "#/components/schemas/" + type };
    else
      s = {
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
    return nullable ? { anyOf: [s, { type: "null" }] } : s;
  };
  const schemas: Record<string, Schema> = {};
  for (const name of Object.keys(metadata)) {
    const properties: Record<string, Schema> = {};
    for (const f of fields(name))
      properties[f.name] = schemaFor(f.type, f.nullable);
    if (
      name === "QuestaoPublicaResponseModel" ||
      name === "QuestaoResponseModel"
    )
      properties.revisaoPendente = { type: "boolean", readOnly: true };
    schemas[name] = {
      type: "object",
      properties,
      required: Object.keys(properties),
      "x-contract-module": metadata[name]!.source.split("/")
        .slice(2, -1)
        .join("/"),
    };
  }
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
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
                  data:
                    code === 200
                      ? schemaFor(r.response, true)
                      : { type: "null" },
                },
              },
            },
          },
        },
      ]),
    );
    const op: Record<string, unknown> = {
      operationId: r.controller + "_" + r.action,
      tags: [r.controller],
      security: r.anonymous ? [] : [{ bearerAuth: [] }, { browserSession: [] }],
      responses,
    };
    if (r.binding === "query")
      op.parameters = fields(r.request).map((f) => ({
        in: "query",
        name: f.name,
        required: false,
        schema: schemaFor(f.type, f.nullable),
      }));
    else
      op.requestBody = {
        required: true,
        content: { "application/json": { schema: schemaFor(r.request) } },
      };
    if (r.controller === "Navegador")
      op.parameters = [
        ...((op.parameters as unknown[]) ?? []),
        {
          in: "header",
          name: "X-Concursa-Client",
          required: r.method !== "GET",
          schema: { type: "string", enum: ["web"] },
        },
        {
          in: "header",
          name: "Origin",
          required: r.method !== "GET",
          schema: { type: "string" },
        },
      ];
    if (r.controller === "ResendWebhook") {
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
      op.parameters = ["svix-id", "svix-timestamp", "svix-signature"].map(
        (name) => ({
          in: "header",
          name,
          required: true,
          schema: { type: "string" },
        }),
      );
    }
    (paths[r.path] ??= {})[r.method.toLowerCase()] = op;
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
      description:
        "API Node.js independente; contratos preservados da API .NET.",
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
