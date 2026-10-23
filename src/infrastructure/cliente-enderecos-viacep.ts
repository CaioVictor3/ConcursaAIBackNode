import { ErroRegraNegocioHttp } from "../domain/erros-validacoes-respostas-api.js";
import {
  criarSinalCancelamentoComPrazo,
  validarUrlHttps,
  type HttpFetch,
} from "./seguranca-requisicoes-https.js";

export async function consultarEnderecoViaCep(
  cep: string | null,
  url: string,
  clienteHttp: HttpFetch = fetch,
  sinalCancelamento?: AbortSignal,
) {
  const digits = (cep ?? "").replace(/[^0-9]/g, "");

  if (digits.length !== 8 || /[^0-9 -]/.test(cep ?? "")) {
    throw new ErroRegraNegocioHttp("Informe um CEP de 8 dígitos.");
  }

  if (!validarUrlHttps(url)) {
    throw new ErroRegraNegocioHttp(
      "A consulta de CEP ainda precisa ser configurada no servidor.",
      503,
    );
  }

  const response = await clienteHttp(url.replace(/\/+$/, "") + "/" + digits + "/json/", {
    redirect: "error",
    signal: criarSinalCancelamentoComPrazo(10000, sinalCancelamento),
  });

  if (!response.ok) {
    throw new ErroRegraNegocioHttp("Não foi possível consultar o CEP. Tente novamente.", 503);
  }

  try {
    const dadosPersistencia = (await response.json()) as Record<string, unknown>;

    if (
      !dadosPersistencia ||
      typeof dadosPersistencia !== "object" ||
      Array.isArray(dadosPersistencia)
    ) {
      throw new Error();
    }

    const textoNormalizado = (chaveAtual: string) =>
      typeof dadosPersistencia[chaveAtual] === "string"
        ? (dadosPersistencia[chaveAtual] as string)
        : "";

    if (
      dadosPersistencia.erro === true ||
      !textoNormalizado("localidade").trim() ||
      !textoNormalizado("uf").trim()
    ) {
      throw new ErroRegraNegocioHttp("CEP não encontrado.", 404);
    }

    return {
      cep: digits,
      logradouro: textoNormalizado("logradouro"),
      bairro: textoNormalizado("bairro"),
      cidade: textoNormalizado("localidade"),
      uf: textoNormalizado("uf"),
    };
  } catch (error) {
    if (error instanceof ErroRegraNegocioHttp) {
      throw error;
    }

    throw new ErroRegraNegocioHttp("Não foi possível consultar o CEP. Tente novamente.", 503);
  }
}
