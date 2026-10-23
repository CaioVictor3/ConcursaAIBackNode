export type HttpFetch = typeof fetch;

export const criarSinalCancelamentoComPrazo = (
  milliseconds: number,
  sinalCancelamento?: AbortSignal,
) =>
  sinalCancelamento
    ? AbortSignal.any([sinalCancelamento, AbortSignal.timeout(milliseconds)])
    : AbortSignal.timeout(milliseconds);

export function validarUrlHttps(url: string) {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
