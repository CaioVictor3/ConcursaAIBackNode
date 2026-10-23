import type { Request } from "express";
import type { ServicoAutenticacaoContasSessoes } from "../application/autenticacao-contas-sessoes.service.js";
import { ErroRegraNegocioHttp } from "../domain/erros-validacoes-respostas-api.js";
import type {
  GerenciadorCookiesSessaoNavegador,
  TokensSessaoNavegador,
} from "./cookies-sessao-navegador.js";

export async function autenticarUsuarioRequisicaoHttp(
  requisicao: Request,
  servicoAutenticacao: ServicoAutenticacaoContasSessoes,
  gerenciadorCookiesNavegador: GerenciadorCookiesSessaoNavegador,
) {
  const autorizacao = requisicao.get("Authorization");
  const tokenAcesso =
    autorizacao?.match(/^Bearer\s+(.+)$/i)?.[1] ??
    (!autorizacao
      ? gerenciadorCookiesNavegador.lerCookieCriptografado<TokensSessaoNavegador>(
          requisicao,
          "sessao",
        )?.accessToken
      : undefined);

  if (!tokenAcesso) {
    throw new ErroRegraNegocioHttp("Entre na sua conta para continuar.", 401);
  }

  return servicoAutenticacao.autenticarTokenAcessoJwt(tokenAcesso);
}
