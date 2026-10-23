import type { RespostaPadraoApi } from "../contracts/modelos-requisicoes-respostas-api.js";

export class ErroRegraNegocioHttp extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export const criarRespostaSucesso = <T>(
  dadosPersistencia: T,
  message: string,
): RespostaPadraoApi<T> => ({
  success: true,
  message,
  statusCode: 200,
  data: dadosPersistencia,
});

export const criarRespostaErro = (
  statusCode: number,
  message: string,
): RespostaPadraoApi<never> => ({
  success: false,
  message,
  statusCode,
  data: null,
});

export function classificarErroAplicacao(error: unknown): {
  status: number;
  message: string;
} {
  if (error instanceof ErroRegraNegocioHttp) {
    return { status: error.status, message: error.message };
  }

  const erroCapturado = error as {
    code?: string;
    message?: string;
    name?: string;
    type?: string;
    status?: number;
  };

  const messages: Record<string, [number, string]> = {
    "23505": [409, "Já existe um registro com esses dados."],
    "23503": [409, "O registro possui vínculos ou uma referência informada não existe."],
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

  if (erroCapturado.code && messages[erroCapturado.code]) {
    const [status, message] = messages[erroCapturado.code]!;

    return { status, message };
  }

  if (erroCapturado.code === "P0001") {
    return {
      status: erroCapturado.message?.includes("limite de 20")
        ? 429
        : erroCapturado.message?.includes("já está sendo analisada")
          ? 409
          : 400,
      message: erroCapturado.message ?? "Operação inválida.",
    };
  }

  if (erroCapturado.type === "entity.parse.failed" || erroCapturado.type === "entity.too.large") {
    return {
      status: 400,
      message: "Confira os campos informados e envie uma requisição válida.",
    };
  }

  if (erroCapturado.name === "TimeoutError" || erroCapturado.name === "AbortError") {
    return {
      status: 504,
      message: "A operação demorou mais que o esperado. Tente novamente.",
    };
  }

  if (erroCapturado.message === "Connection terminated due to connection timeout") {
    return {
      status: 503,
      message: "O banco está indisponível. Confira a configuração da conexão ou tente novamente mais tarde.",
    };
  }

  if (
    erroCapturado.code &&
    (/^[0-9A-Z]{5}$/.test(erroCapturado.code) ||
      /ECONN|ENOTFOUND|ETIMEDOUT|CERT/.test(erroCapturado.code))
  ) {
    return {
      status: 503,
      message:
        "O banco está indisponível. Confira a configuração da conexão ou tente novamente mais tarde.",
    };
  }

  if (error instanceof TypeError && error.message === "fetch failed") {
    return {
      status: 503,
      message: "Não foi possível conectar ao serviço externo. Tente novamente mais tarde.",
    };
  }

  return {
    status: 500,
    message: "Não foi possível concluir a operação. Entre em contato com o suporte.",
  };
}

export const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

export function validarIdentificador(
  value: string | null | undefined,
  label: string,
): asserts value is string {
  if (!value || value === EMPTY_UUID) {
    throw new ErroRegraNegocioHttp(`Informe ${label} válido.`);
  }
}

export function validarTexto(
  value: string | null | undefined,
  label: string,
  tamanhoMinimo = 1,
  tamanhoMaximo = 5000,
) {
  const valorAtual = value?.trim() ?? "";

  if (valorAtual.length < tamanhoMinimo || valorAtual.length > tamanhoMaximo) {
    throw new ErroRegraNegocioHttp(
      `${label} deve ter entre ${tamanhoMinimo} e ${tamanhoMaximo} caracteres.`,
    );
  }

  return valorAtual;
}

export function validarPaginacao(paginaRegistros: number, size: number) {
  if (paginaRegistros < 1 || paginaRegistros > 100000 || size < 1 || size > 100) {
    throw new ErroRegraNegocioHttp("Informe página positiva e entre 1 e 100 itens por página.");
  }
}

export function validarAno(value: number | null) {
  if (value !== null && (value < 1000 || value > 9999)) {
    throw new ErroRegraNegocioHttp("Informe um ano positivo com quatro dígitos.");
  }
}
