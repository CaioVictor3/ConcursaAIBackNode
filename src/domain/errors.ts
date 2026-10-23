import type { ApiResponse } from "../contracts/models.js";
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}
export const success = <T>(data: T, message: string): ApiResponse<T> => ({
  success: true,
  message,
  statusCode: 200,
  data,
});
export const failure = (
  statusCode: number,
  message: string,
): ApiResponse<never> => ({ success: false, message, statusCode, data: null });
export function classifyError(error: unknown): {
  status: number;
  message: string;
} {
  if (error instanceof ServiceError)
    return { status: error.status, message: error.message };
  const e = error as {
    code?: string;
    message?: string;
    name?: string;
    type?: string;
    status?: number;
  };
  const messages: Record<string, [number, string]> = {
    "23505": [409, "Já existe um registro com esses dados."],
    "23503": [
      409,
      "O registro possui vínculos ou uma referência informada não existe.",
    ],
    "42501": [403, "Você não possui permissão para esta operação."],
    "40001": [
      409,
      "Os dados foram alterados simultaneamente. Consulte novamente antes de repetir.",
    ],
    "40P01": [
      409,
      "Os dados foram alterados simultaneamente. Consulte novamente antes de repetir.",
    ],
  };
  if (e.code && messages[e.code]) {
    const [status, message] = messages[e.code]!;
    return { status, message };
  }
  if (e.code === "P0001")
    return {
      status: e.message?.includes("limite de 20")
        ? 429
        : e.message?.includes("já está sendo analisada")
          ? 409
          : 400,
      message: e.message ?? "Operação inválida.",
    };
  if (e.type === "entity.parse.failed" || e.type === "entity.too.large")
    return {
      status: 400,
      message: "Confira os campos informados e envie uma requisição válida.",
    };
  if (e.name === "TimeoutError" || e.name === "AbortError")
    return {
      status: 504,
      message: "A operação demorou mais que o esperado. Tente novamente.",
    };
  if (
    e.code &&
    (/^[0-9A-Z]{5}$/.test(e.code) ||
      /ECONN|ENOTFOUND|ETIMEDOUT|CERT/.test(e.code))
  )
    return {
      status: 503,
      message:
        "O banco está indisponível. Confira a configuração da conexão ou tente novamente mais tarde.",
    };
  if (error instanceof TypeError && error.message === "fetch failed")
    return {
      status: 503,
      message:
        "Não foi possível conectar ao serviço externo. Tente novamente mais tarde.",
    };
  return {
    status: 500,
    message:
      "Não foi possível concluir a operação. Entre em contato com o suporte.",
  };
}
export const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
export function identifier(
  value: string | null | undefined,
  label: string,
): asserts value is string {
  if (!value || value === EMPTY_UUID)
    throw new ServiceError(`Informe ${label} válido.`);
}
export function text(
  value: string | null | undefined,
  label: string,
  min = 1,
  max = 5000,
) {
  const v = value?.trim() ?? "";
  if (v.length < min || v.length > max)
    throw new ServiceError(
      `${label} deve ter entre ${min} e ${max} caracteres.`,
    );
  return v;
}
export function pagination(page: number, size: number) {
  if (page < 1 || page > 100000 || size < 1 || size > 100)
    throw new ServiceError(
      "Informe página positiva e entre 1 e 100 itens por página.",
    );
}
export function year(value: number | null) {
  if (value !== null && (value < 1000 || value > 9999))
    throw new ServiceError("Informe um ano positivo com quatro dígitos.");
}
