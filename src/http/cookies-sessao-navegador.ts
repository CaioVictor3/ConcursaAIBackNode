import type { Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import type { ConfiguracoesAmbiente } from "../config/configuracoes-ambiente.js";
import type {
  FluxoGoogleResponseModel,
  SessaoResponseModel,
} from "../contracts/modelos-requisicoes-respostas-api.js";
import {
  ErroRegraNegocioHttp,
  criarRespostaSucesso,
} from "../domain/erros-validacoes-respostas-api.js";
import {
  descriptografarConteudoAutenticado,
  criptografarConteudoAutenticado,
} from "../infrastructure/criptografia-senhas-tokens-links.js";

export interface TokensSessaoNavegador {
  accessToken: string;
  refreshToken: string;
}

export class GerenciadorCookiesSessaoNavegador {
  constructor(readonly config: ConfiguracoesAmbiente) {}

  obterNomeCookie(kind: "sessao" | "google") {
    return (this.config.production ? "__Host-" : "") + "concursa-" + kind;
  }

  private lerCookieHttp(requisicaoHttp: Request, name: string) {
    const pairs = (requisicaoHttp.headers.cookie ?? "")
      .split(";")
      .map((parteResposta) => parteResposta.trim().split("="));

    const obterReadCookie = (indiceAtual: string) =>
      pairs
        .find((parteResposta) => parteResposta[0] === indiceAtual)
        ?.slice(1)
        .join("=");

    let valorAtual = obterReadCookie(name);

    if (valorAtual?.startsWith("chunks-")) {
      const count = Number(valorAtual.slice(7));

      if (!Number.isInteger(count) || count < 1 || count > 20) {
        return undefined;
      }

      valorAtual = Array.from(
        { length: count },
        (_, indiceAtual) => obterReadCookie(name + "C" + (indiceAtual + 1)) ?? "",
      ).join("");
    }

    return valorAtual ? decodeURIComponent(valorAtual) : undefined;
  }

  lerCookieCriptografado<T>(requisicaoHttp: Request, kind: "sessao" | "google"): T | null {
    try {
      if (this.config.auth.key.length < 64) {
        return null;
      }

      const valorAtual = this.lerCookieHttp(requisicaoHttp, this.obterNomeCookie(kind));

      if (!valorAtual) {
        return null;
      }

      const dadosPersistencia = JSON.parse(
        descriptografarConteudoAutenticado(
          valorAtual,
          this.config.auth.key,
          "ConcursaAI/node-cookie/" + kind + "/v1",
        ),
      ) as { expires: number; data: T };

      return dadosPersistencia.expires > Date.now() ? dadosPersistencia.data : null;
    } catch {
      return null;
    }
  }

  gravarCookieCriptografado(
    respostaHttp: Response,
    kind: "sessao" | "google",
    dadosPersistencia: unknown,
  ) {
    const valorAtual = criptografarConteudoAutenticado(
      JSON.stringify({
        expires: Date.now() + (kind === "google" ? 600000 : 604800000),
        data: dadosPersistencia,
      }),
      this.config.auth.key,
      "ConcursaAI/node-cookie/" + kind + "/v1",
    );

    const options = {
      httpOnly: true,
      secure: this.config.production,
      sameSite: kind === "google" ? ("lax" as const) : ("strict" as const),
      path: "/",
      ...(kind === "google" ? { maxAge: 600000 } : {}),
    };

    const name = this.obterNomeCookie(kind);

    if (valorAtual.length > 3800) {
      const chunks = valorAtual.match(/.{1,3800}/g)!;

      respostaHttp.cookie(name, "chunks-" + chunks.length, options);

      chunks.forEach((chunk, indiceAtual) =>
        respostaHttp.cookie(name + "C" + (indiceAtual + 1), chunk, options),
      );
    } else {
      respostaHttp.cookie(name, valorAtual, options);
    }
  }

  removerCookie(respostaHttp: Response, kind: "sessao" | "google") {
    const options = {
      httpOnly: true,
      secure: this.config.production,
      sameSite: kind === "google" ? ("lax" as const) : ("strict" as const),
      path: "/",
    };

    respostaHttp.clearCookie(this.obterNomeCookie(kind), options);

    for (let indiceAtual = 1; indiceAtual <= 20; indiceAtual++) {
      respostaHttp.clearCookie(this.obterNomeCookie(kind) + "C" + indiceAtual, options);
    }
  }

  gravarCookiesSessao(respostaHttp: Response, sessaoAutenticada: SessaoResponseModel) {
    this.gravarCookieCriptografado(respostaHttp, "sessao", {
      accessToken: sessaoAutenticada.accessToken,
      refreshToken: sessaoAutenticada.refreshToken,
    });

    return criarRespostaSucesso(
      { usuario: sessaoAutenticada.usuario, expiresIn: sessaoAutenticada.expiresIn },
      "Acesso realizado.",
    );
  }

  consumirEstadoGoogleCookie(requisicaoHttp: Request, respostaHttp: Response, state: string) {
    const flow = this.lerCookieCriptografado<FluxoGoogleResponseModel>(requisicaoHttp, "google");

    this.removerCookie(respostaHttp, "google");

    if (!flow || !state?.trim() || state.length > 100) {
      throw new ErroRegraNegocioHttp("A confirmação do Google expirou. Inicie novamente.");
    }

    const registroAtual = Buffer.from(flow.estado);

    const corpoResposta = Buffer.from(state);

    if (
      registroAtual.length !== corpoResposta.length ||
      !timingSafeEqual(registroAtual, corpoResposta)
    ) {
      throw new ErroRegraNegocioHttp("Confirmação do Google inválida. Inicie novamente.");
    }

    return flow;
  }
}
