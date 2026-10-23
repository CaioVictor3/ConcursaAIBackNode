import metadataJson from "./metadata.json" with { type: "json" };
import type { Models } from "./models.js";
import { EMPTY_UUID, ServiceError } from "../domain/errors.js";
interface Field {
  name: string;
  type: string;
  nullable: boolean;
  array: boolean;
  item: string | null;
  default: string | null;
  required: boolean;
}
interface Descriptor {
  base: string | null;
  fields: Field[];
  source: string;
}
export const metadata: Record<string, Descriptor> = metadataJson;
export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key = (s: string) => s.replaceAll("_", "").toLowerCase();
const dates: Record<string, string> = {
  criado_em: "dataHoraCadastro",
  criada_em: "dataHoraCadastro",
  atualizado_em: "dataHoraAtualizacao",
  atualizada_em: "dataHoraAtualizacao",
  finalizado_em: "dataHoraFinalizacao",
  finalizada_em: "dataHoraFinalizacao",
  iniciada_em: "dataHoraInicio",
  respondida_em: "dataHoraResposta",
  ultimo_acesso_em: "dataHoraUltimoAcesso",
  gerada_em: "geradaEm",
  papel_autor: "tipoUsuarioAutor",
};
export function fields(name: string): Field[] {
  const m = metadata[name];
  if (!m) throw new Error(`Contrato desconhecido: ${name}`);
  return [...(m.base ? fields(m.base) : []), ...m.fields];
}
function defaultValue(f: Field): unknown {
  if (f.default === "[]") return [];
  if (f.default?.startsWith("new")) return {};
  if (f.default === "string.Empty") return "";
  if (f.default) {
    try {
      return JSON.parse(f.default);
    } catch {
      /* handled below */
    }
  }
  if (f.nullable) return null;
  if (f.array) return [];
  if (f.type === "Guid") return EMPTY_UUID;
  if (f.type === "string") return "";
  if (f.type === "DateTimeOffset") return "0001-01-01T00:00:00+00:00";
  if (f.type === "bool") return false;
  if (["int", "long", "decimal", "double"].includes(f.type)) return 0;
  return null;
}
const invalid = () =>
  new ServiceError(
    "Confira os campos informados e envie uma requisição válida.",
  );
function convert(
  f: Field,
  value: unknown,
  input: boolean,
  query: boolean,
): unknown {
  if (value === undefined) value = defaultValue(f);
  if (value === null) {
    if (f.nullable || !input) return null;
    throw invalid();
  }
  if (f.array) {
    if (!Array.isArray(value)) throw invalid();
    const item = f.item!;
    return value.map((v) =>
      convert(
        {
          ...f,
          array: false,
          type: item.replace("?", ""),
          nullable: item.endsWith("?"),
          default: null,
        },
        v,
        input,
        query,
      ),
    );
  }
  if (metadata[f.type]) return decode(f.type, value, input, query);
  if (!input) {
    if (["int", "long", "decimal", "double"].includes(f.type))
      return Number(value);
    return value instanceof Date ? value.toISOString() : value;
  }
  switch (f.type) {
    case "string":
      if (typeof value !== "string" || (f.required && !value.trim()))
        throw invalid();
      return value;
    case "Guid":
      if (typeof value !== "string" || !uuidPattern.test(value))
        throw invalid();
      return value.toLowerCase();
    case "bool":
      if (query && typeof value === "string" && /^(true|false)$/i.test(value))
        return value.toLowerCase() === "true";
      if (typeof value !== "boolean") throw invalid();
      return value;
    case "int":
    case "long":
    case "decimal":
    case "double": {
      if (query && typeof value === "string" && value.trim())
        value = Number(value);
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (["int", "long"].includes(f.type) && !Number.isSafeInteger(value)) ||
        (f.type === "int" && (value < -2147483648 || value > 2147483647))
      )
        throw invalid();
      return value;
    }
    case "DateOnly":
      if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value
      )
        throw invalid();
      return value;
    case "DateTimeOffset":
      if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
        throw invalid();
      return value;
    default:
      return value;
  }
}
function decode(
  name: string,
  value: unknown,
  input: boolean,
  query: boolean,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  const entries = Object.entries(value).map(([k, v]) => [
    key(input ? k : (dates[k] ?? k)),
    v,
  ]);
  const source = Object.fromEntries(entries) as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const f of fields(name))
    result[f.name] = convert(f, source[key(f.name)], input, query);
  if (name === "QuestaoPublicaResponseModel" || name === "QuestaoResponseModel")
    result.revisaoPendente =
      !result.idProva || !result.idTema || result.numero === null;
  return result;
}
export function bind<K extends keyof Models>(
  name: K,
  value: unknown,
  query = false,
): Models[K] {
  return decode(name, value, true, query) as Models[K];
}
export function project<K extends keyof Models>(
  name: K,
  value: unknown,
): Models[K] {
  return decode(name, value, false, false) as Models[K];
}
