import { EMPTY_UUID, ErroRegraNegocioHttp } from "../domain/erros-validacoes-respostas-api.js";
import metadataJson from "./metadados-contratos-api.json" with { type: "json" };
import type { MapaModelosContratosApi } from "./modelos-requisicoes-respostas-api.js";

interface CampoContratoApi {
  name: string;
  type: string;
  nullable: boolean;
  array: boolean;
  item: string | null;
  default: string | null;
  required: boolean;
}

interface DescritorContratoApi {
  base: string | null;
  fields: CampoContratoApi[];
  source: string;
}

export const metadata: Record<string, DescritorContratoApi> = metadataJson;

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const chaveConfiguracao = (textoNormalizado: string) =>
  textoNormalizado.replaceAll("_", "").toLowerCase();

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

export function obterCamposContrato(name: string): CampoContratoApi[] {
  const metadadosContrato = metadata[name];

  if (!metadadosContrato) {
    throw new Error(`Contrato desconhecido: ${name}`);
  }

  return [
    ...(metadadosContrato.base ? obterCamposContrato(metadadosContrato.base) : []),
    ...metadadosContrato.fields,
  ];
}

function defaultValue(campoContrato: CampoContratoApi): unknown {
  if (campoContrato.default === "[]") {
    return [];
  }

  if (campoContrato.default?.startsWith("new")) {
    return {};
  }

  if (campoContrato.default === "string.Empty") {
    return "";
  }

  if (campoContrato.default) {
    try {
      return JSON.parse(campoContrato.default);
    } catch {
      /* handled below */
    }
  }

  if (campoContrato.nullable) {
    return null;
  }

  if (campoContrato.array) {
    return [];
  }

  if (campoContrato.type === "Guid") {
    return EMPTY_UUID;
  }

  if (campoContrato.type === "string") {
    return "";
  }

  if (campoContrato.type === "DateTimeOffset") {
    return "0001-01-01T00:00:00+00:00";
  }

  if (campoContrato.type === "bool") {
    return false;
  }

  if (["int", "long", "decimal", "double"].includes(campoContrato.type)) {
    return 0;
  }

  return null;
}

const invalid = () =>
  new ErroRegraNegocioHttp("Confira os campos informados e envie uma requisição válida.");

function convert(
  campoContrato: CampoContratoApi,
  value: unknown,
  input: boolean,
  query: boolean,
): unknown {
  if (value === undefined) {
    value = defaultValue(campoContrato);
  }

  if (value === null) {
    if (campoContrato.nullable || !input) {
      return null;
    }

    throw invalid();
  }

  if (campoContrato.array) {
    if (!Array.isArray(value)) {
      throw invalid();
    }

    const item = campoContrato.item!;

    return value.map((valorAtual) =>
      convert(
        {
          ...campoContrato,
          array: false,
          type: item.replace("?", ""),
          nullable: item.endsWith("?"),
          default: null,
        },
        valorAtual,
        input,
        query,
      ),
    );
  }

  if (metadata[campoContrato.type]) {
    return decode(campoContrato.type, value, input, query);
  }

  if (!input) {
    if (["int", "long", "decimal", "double"].includes(campoContrato.type)) {
      return Number(value);
    }

    return value instanceof Date ? value.toISOString() : value;
  }

  switch (campoContrato.type) {
    case "string":
      if (typeof value !== "string" || (campoContrato.required && !value.trim())) {
        throw invalid();
      }
      return value;
    case "Guid":
      if (typeof value !== "string" || !uuidPattern.test(value)) {
        throw invalid();
      }
      return value.toLowerCase();
    case "bool":
      if (query && typeof value === "string" && /^(true|false)$/i.test(value)) {
        return value.toLowerCase() === "true";
      }
      if (typeof value !== "boolean") {
        throw invalid();
      }
      return value;
    case "int":
    case "long":
    case "decimal":
    case "double": {
      if (query && typeof value === "string" && value.trim()) {
        value = Number(value);
      }

      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (["int", "long"].includes(campoContrato.type) && !Number.isSafeInteger(value)) ||
        (campoContrato.type === "int" && (value < -2147483648 || value > 2147483647))
      ) {
        throw invalid();
      }

      return value;
    }
    case "DateOnly":
      if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value
      ) {
        throw invalid();
      }
      return value;
    case "DateTimeOffset":
      if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
        throw invalid();
      }
      return value;
    default:
      return value;
  }
}

function decode(name: string, value: unknown, input: boolean, query: boolean): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid();
  }

  const entries = Object.entries(value).map(([chaveAtual, valorAtual]) => [
    chaveConfiguracao(input ? chaveAtual : (dates[chaveAtual] ?? chaveAtual)),
    valorAtual,
  ]);

  const source = Object.fromEntries(entries) as Record<string, unknown>;

  const camposConvertidosContrato: Record<string, unknown> = {};

  for (const campoContrato of obterCamposContrato(name)) {
    camposConvertidosContrato[campoContrato.name] = convert(
      campoContrato,
      source[chaveConfiguracao(campoContrato.name)],
      input,
      query,
    );
  }

  if (name === "QuestaoPublicaResponseModel" || name === "QuestaoResponseModel") {
    camposConvertidosContrato.revisaoPendente =
      !camposConvertidosContrato.idProva ||
      !camposConvertidosContrato.idTema ||
      camposConvertidosContrato.numero === null;
  }

  return camposConvertidosContrato;
}

export function vincularRequisicaoAoContrato<K extends keyof MapaModelosContratosApi>(
  name: K,
  value: unknown,
  query = false,
): MapaModelosContratosApi[K] {
  return decode(name, value, true, query) as MapaModelosContratosApi[K];
}

export function projetarRespostaPeloContrato<K extends keyof MapaModelosContratosApi>(
  name: K,
  value: unknown,
): MapaModelosContratosApi[K] {
  return decode(name, value, false, false) as MapaModelosContratosApi[K];
}
