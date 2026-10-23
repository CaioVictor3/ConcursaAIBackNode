import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import type { ConfiguracoesAmbiente } from "../config/configuracoes-ambiente.js";
import { ErroRegraNegocioHttp } from "../domain/erros-validacoes-respostas-api.js";
import {
  criarSinalCancelamentoComPrazo,
  validarUrlHttps,
  type HttpFetch,
} from "./seguranca-requisicoes-https.js";

export class ClienteAutenticacaoGoogle {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    readonly config: ConfiguracoesAmbiente,
    readonly clienteHttp: HttpFetch = fetch,
  ) {}

  get estaDisponivel() {
    return !!(this.config.auth.googleClientId && this.config.auth.googleClientSecret);
  }

  exigirConfiguracaoGoogle() {
    if (
      !this.estaDisponivel ||
      !validarUrlHttps(this.config.auth.googleAuthorizationUrl) ||
      !validarUrlHttps(this.config.auth.googleTokenUrl) ||
      !validarUrlHttps(this.config.auth.googleDiscoveryUrl)
    ) {
      throw new ErroRegraNegocioHttp(
        "O acesso com Google ainda não está disponível. Entre com seu e-mail e senha.",
        503,
      );
    }
  }

  gerarUrlAutorizacaoGoogle(state: string, challenge: string, nonce: string, redirect: string) {
    this.exigirConfiguracaoGoogle();

    const contaUsuario = this.config.auth;

    return (
      contaUsuario.googleAuthorizationUrl +
      "?" +
      new URLSearchParams({
        client_id: contaUsuario.googleClientId,
        redirect_uri: redirect,
        response_type: "code",
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      }).toString()
    );
  }

  async confirmarCodigoAutorizacaoGoogle(
    code: string,
    verifier: string,
    nonce: string,
    redirect: string,
    sinalCancelamento?: AbortSignal,
  ) {
    this.exigirConfiguracaoGoogle();

    const contaUsuario = this.config.auth;

    const response = await this.clienteHttp(contaUsuario.googleTokenUrl, {
      method: "POST",
      body: new URLSearchParams({
        code,
        code_verifier: verifier,
        redirect_uri: redirect,
        client_id: contaUsuario.googleClientId,
        client_secret: contaUsuario.googleClientSecret,
        grant_type: "authorization_code",
      }),
      redirect: "error",
      signal: criarSinalCancelamentoComPrazo(20000, sinalCancelamento),
    });

    if (!response.ok) {
      throw new ErroRegraNegocioHttp(
        "Não foi possível confirmar o Google. Inicie o acesso novamente.",
        response.status >= 500 ? 503 : 401,
      );
    }

    const invalid = () =>
      new ErroRegraNegocioHttp(
        "O Google não confirmou uma identidade válida. Inicie o acesso novamente.",
        401,
      );

    let token: unknown;

    try {
      const corpoResposta = (await response.json()) as { id_token?: unknown };

      token = corpoResposta.id_token;
    } catch {
      throw invalid();
    }

    if (typeof token !== "string" || token.length < 1 || token.length >= 20000) {
      throw invalid();
    }

    if (!this.jwks) {
      const discovery = await this.clienteHttp(contaUsuario.googleDiscoveryUrl, {
        redirect: "error",
        signal: criarSinalCancelamentoComPrazo(15000, sinalCancelamento),
      });

      if (!discovery.ok) {
        throw invalid();
      }

      const doc = (await discovery.json()) as { jwks_uri?: string };

      if (!doc.jwks_uri || !validarUrlHttps(doc.jwks_uri)) {
        throw invalid();
      }

      this.jwks = createRemoteJWKSet(new URL(doc.jwks_uri), {
        timeoutDuration: 15000,
        [customFetch]: (url, options) => this.clienteHttp(url, options),
      });
    }

    try {
      const { payload: perfilUsuario } = await jwtVerify(token, this.jwks, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: contaUsuario.googleClientId,
        algorithms: ["RS256"],
        clockTolerance: 30,
        requiredClaims: ["exp", "sub"],
      });

      if (
        !perfilUsuario.sub ||
        perfilUsuario.sub.length > 255 ||
        typeof perfilUsuario.email !== "string" ||
        !perfilUsuario.email ||
        perfilUsuario.email.length > 254 ||
        perfilUsuario.email_verified !== true ||
        perfilUsuario.nonce !== nonce ||
        (perfilUsuario.azp && perfilUsuario.azp !== contaUsuario.googleClientId)
      ) {
        throw invalid();
      }

      return {
        subject: perfilUsuario.sub,
        email: perfilUsuario.email,
        name:
          typeof perfilUsuario.name === "string"
            ? perfilUsuario.name
            : perfilUsuario.email.split("@")[0]!,
      };
    } catch {
      throw invalid();
    }
  }
}
