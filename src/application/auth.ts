import { randomUUID, createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type * as M from "../contracts/models.js";
import type { Config } from "../config/config.js";
import type { UserContext } from "../infrastructure/database.js";
import {
  Accounts,
  profile,
  type Account,
  type Session,
} from "../infrastructure/accounts.js";
import { Emails } from "../infrastructure/emails.js";
import { GoogleProvider } from "../infrastructure/providers.js";
import {
  hashPassword,
  verifyPassword,
  newToken,
  tokenHash,
} from "../infrastructure/crypto.js";
import { uuidPattern } from "../contracts/codec.js";
import { ServiceError, success } from "../domain/errors.js";
import { validatePerson } from "../domain/person.js";
const invalidCredentials =
  "E-mail ou senha incorretos. Confira seus dados e tente novamente.";
const message = (s: string) => success({ mensagem: s }, s);
function email(value: string) {
  const v = value?.trim() ?? "";
  if (v.length > 254 || !/^\S+@[^\s@]+\.[^\s@]+$/.test(v) || /[<>\r\n]/.test(v))
    throw new ServiceError("Informe um e-mail válido.");
  return v.toLowerCase();
}
function password(value: string) {
  if (!value?.trim() || value.length < 8 || value.length > 128)
    throw new ServiceError("A senha deve ter entre 8 e 128 caracteres.");
}
function token(value: string) {
  if (!value?.trim() || value.length < 32 || value.length > 200)
    throw new ServiceError("A confirmação expirou. Inicie novamente.", 401);
}
export class Auth {
  constructor(
    readonly config: Config,
    readonly accounts: Accounts,
    readonly emails: Emails,
    readonly google: GoogleProvider,
  ) {}
  require() {
    if (this.config.auth.key.length < 64)
      throw new ServiceError(
        "A autenticação ainda precisa ser configurada no servidor.",
        503,
      );
  }
  origin(value: string | null) {
    const v = (value ?? this.config.auth.clientUrl).replace(/\/+$/, "");
    try {
      const url = new URL(v);
      if (
        !this.config.origins.some((o) => o.toLowerCase() === v.toLowerCase()) ||
        url.origin !== v ||
        url.username ||
        !["https:", "http:"].includes(url.protocol) ||
        (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
          url.protocol !== "https:")
      )
        throw new Error();
      return v;
    } catch {
      throw new ServiceError("Origem de acesso não autorizada.", 403);
    }
  }
  private active(a: Account) {
    if (!a.email_confirmado_em)
      throw new ServiceError(
        "Confirme seu e-mail antes de entrar. Verifique também a pasta de spam.",
        403,
      );
    if (profile(a).estadoCadastro !== "ativo")
      throw new ServiceError("A conta não está disponível para acesso.", 403);
  }
  async authenticate(accessToken: string): Promise<UserContext> {
    let id: string, sessionId: string;
    try {
      this.require();
      const { payload: p } = await jwtVerify(
        accessToken,
        this.config.auth.key,
        {
          issuer: this.config.auth.issuer,
          audience: this.config.auth.audience,
          algorithms: ["HS256"],
          clockTolerance: 30,
          requiredClaims: ["exp", "sub", "sid"],
        },
      );
      if (
        typeof p.sub !== "string" ||
        !uuidPattern.test(p.sub) ||
        typeof p.sid !== "string" ||
        !uuidPattern.test(p.sid)
      )
        throw new Error();
      id = p.sub;
      sessionId = p.sid;
    } catch {
      throw new ServiceError("Entre na sua conta para continuar.", 401);
    }
    if (!(await this.accounts.validSession(sessionId, id)))
      throw new ServiceError("Entre na sua conta para continuar.", 401);
    return { id, sessionId, token: accessToken };
  }
  private async response(
    a: Account,
    s: Session,
    refresh: string,
  ): Promise<M.ApiResponse<M.SessaoResponseModel>> {
    this.require();
    const now = Math.floor(Date.now() / 1000),
      exp = Math.min(
        now + this.config.auth.accessMinutes * 60,
        Math.floor(new Date(s.expira_em).getTime() / 1000),
      );
    if (exp <= now)
      throw new ServiceError("Sua sessão expirou. Entre novamente.", 401);
    const access = await new SignJWT({
      sub: a.idUsuario,
      sid: s.idSessao,
      jti: randomUUID(),
      tipo: profile(a).tipo,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(this.config.auth.issuer)
      .setAudience(this.config.auth.audience)
      .setNotBefore(now - 5)
      .setExpirationTime(exp)
      .sign(this.config.auth.key);
    return success(
      {
        accessToken: access,
        refreshToken: refresh,
        expiresIn: exp - now,
        tokenType: "bearer",
        usuario: profile(a),
      },
      "Acesso realizado.",
    );
  }
  private async session(a: Account) {
    this.require();
    this.active(a);
    const refresh = newToken(),
      s: Session = {
        idSessao: randomUUID(),
        idUsuario: a.idUsuario,
        expira_em: new Date(
          Date.now() + this.config.auth.sessionDays * 86400000,
        ),
      };
    if (
      !(await this.accounts.createSession(
        s,
        tokenHash(refresh),
        a.versao_credenciais,
      ))
    )
      throw new ServiceError("Sua conta foi atualizada. Entre novamente.", 401);
    const reloaded = await this.accounts.get("id", a.idUsuario);
    if (!reloaded) throw new ServiceError("Conta indisponível.", 401);
    return this.response(reloaded, s, refresh);
  }
  private async sendToken(a: Account, purpose: string, checked = false) {
    const type =
      purpose === "confirmacao" ? "EMAIL_VERIFICATION" : "PASSWORD_RESET";
    if (!checked && !(await this.emails.enabled(type)))
      throw new ServiceError(
        "Este envio de e-mail está temporariamente indisponível.",
        503,
      );
    const t = newToken(),
      p = profile(a),
      link =
        this.origin(null) +
        (purpose === "confirmacao"
          ? "/autenticacao/confirmar-email"
          : "/autenticacao/redefinir-senha") +
        "#tipo=" +
        purpose +
        "&token=" +
        encodeURIComponent(t);
    const pending = this.emails.prepare(
      a.idUsuario,
      p.email,
      p.nomeCompleto,
      purpose,
      link,
    );
    await this.accounts.emailToken(
      a.idUsuario,
      purpose,
      tokenHash(t),
      new Date(Date.now() + (purpose === "confirmacao" ? 1440 : 30) * 60000),
      pending,
    );
  }
  handlers(user: UserContext, signal?: AbortSignal) {
    const thisAuth = this;
    const requireUser = () => {
      if (!user.id || !user.sessionId)
        throw new ServiceError("Entre na sua conta para continuar.", 401);
    };
    const login = async (q: M.EntrarEstudanteRequestModel, type: string) => {
      this.require();
      const normalized = email(q.email);
      if (!q.senha?.trim() || q.senha.length > 128)
        throw new ServiceError(invalidCredentials, 401);
      const a = await this.accounts.get("email", normalized),
        blocked =
          !!a?.bloqueado_ate && Date.parse(a.bloqueado_ate) > Date.now();
      const check = await verifyPassword(
        blocked ? null : (a?.senha_hash ?? null),
        a?.formato_senha ?? null,
        q.senha,
      );
      if (!check.valid || !a) {
        if (a && !blocked) await this.accounts.failedPassword(a.idUsuario);
        throw new ServiceError(invalidCredentials, 401);
      }
      if (profile(a).tipo !== type)
        throw new ServiceError(invalidCredentials, 401);
      if (
        check.rehash &&
        !(await this.accounts.rehash(
          a.idUsuario,
          a.senha_hash!,
          await hashPassword(q.senha),
        ))
      )
        throw new ServiceError(invalidCredentials, 401);
      return this.session(a);
    };
    const flow = async (origin: string | null, link: string | null) => {
      this.require();
      const verificador = newToken(),
        estado = newToken(),
        nonce = newToken(),
        redirectUri = this.origin(origin) + "/autenticacao/google";
      return success(
        {
          url: this.google.url(
            estado,
            createHash("sha256")
              .update(verificador, "ascii")
              .digest("base64url"),
            nonce,
            redirectUri,
          ),
          estado,
          verificador,
          nonce,
          redirectUri,
          idUsuarioVinculo: link,
        },
        "Continue no Google.",
      );
    };
    return {
      entrarEstudante: (q: M.EntrarEstudanteRequestModel) =>
        login(q, "estudante"),
      entrarAdministrador: (q: M.EntrarAdministradorRequestModel) =>
        login(q, "administrador"),
      async cadastrarEstudante(q: M.CadastrarEstudanteRequestModel) {
        const normalized = email(q.email);
        password(q.senha);
        const p = validatePerson(q.pessoa);
        thisAuth.emails.require();
        if (!(await thisAuth.emails.enabled("EMAIL_VERIFICATION")))
          throw new ServiceError(
            "Este envio de e-mail está temporariamente indisponível.",
            503,
          );
        const old = await thisAuth.accounts.get("email", normalized);
        const response = (id: string) =>
          success(
            { idUsuario: id, confirmacaoEmailNecessaria: true },
            "Cadastro recebido. Confira seu e-mail para continuar.",
          );
        if (old) {
          if (!old.email_confirmado_em)
            await thisAuth.sendToken(old, "confirmacao", true);
          return response(randomUUID());
        }
        const id = randomUUID();
        try {
          await thisAuth.accounts.create(
            id,
            normalized,
            await hashPassword(q.senha),
            null,
            p,
            true,
          );
        } catch (e) {
          if ((e as { code?: string }).code !== "23505") throw e;
          if (await thisAuth.accounts.get("email", normalized))
            return response(randomUUID());
          throw new ServiceError(
            "Já existe um cadastro com os dados pessoais informados.",
            409,
          );
        }
        const a = await thisAuth.accounts.get("id", id);
        if (!a)
          throw new ServiceError("Não foi possível carregar o cadastro.", 503);
        await thisAuth.sendToken(a, "confirmacao", true);
        return response(id);
      },
      renovarSessao: async (q: M.RenovarSessaoRequestModel) => {
        this.require();
        token(q.refreshToken);
        const refresh = newToken(),
          s = await this.accounts.refresh(
            tokenHash(q.refreshToken),
            tokenHash(refresh),
          );
        if (!s)
          throw new ServiceError("Sua sessão expirou. Entre novamente.", 401);
        const a = await this.accounts.get("id", s.idUsuario);
        if (!a) throw new ServiceError("Conta indisponível.", 401);
        this.active(a);
        return this.response(a, s, refresh);
      },
      solicitarRecuperacaoSenha: async (
        q: M.SolicitarRecuperacaoSenhaRequestModel,
      ) => {
        const normalized = email(q.email);
        this.emails.require();
        const a = await this.accounts.get("email", normalized);
        if (a?.email_confirmado_em) await this.sendToken(a, "recuperacao");
        return message(
          "Se houver uma conta para este e-mail, você receberá as instruções de recuperação.",
        );
      },
      reenviarConfirmacao: async (q: M.ReenviarConfirmacaoRequestModel) => {
        const normalized = email(q.email);
        this.emails.require();
        const a = await this.accounts.get("email", normalized);
        if (a && !a.email_confirmado_em) await this.sendToken(a, "confirmacao");
        return message(
          "Se necessário, uma nova confirmação será enviada ao e-mail informado.",
        );
      },
      confirmarEmail: async (q: M.ConfirmarEmailAutenticacaoRequestModel) => {
        token(q.token);
        if (
          !(await this.accounts.consumeEmail(
            tokenHash(q.token),
            "confirmacao",
            null,
            await this.emails.enabled("WELCOME_EMAIL"),
          ))
        )
          throw new ServiceError(
            "O link de confirmação expirou ou já foi utilizado. Solicite um novo e-mail.",
          );
        return message("E-mail confirmado. Entre na sua conta para continuar.");
      },
      redefinirSenha: async (q: M.RedefinirSenhaRequestModel) => {
        token(q.token);
        password(q.senha);
        if (
          !(await this.accounts.consumeEmail(
            tokenHash(q.token),
            "recuperacao",
            await hashPassword(q.senha),
          ))
        )
          throw new ServiceError(
            "O link de recuperação expirou ou já foi utilizado. Solicite um novo e-mail.",
          );
        return message("Senha alterada. Entre com sua nova senha.");
      },
      sairSessao: async (_q: M.SairSessaoRequestModel) => {
        requireUser();
        await this.accounts.revoke(user.id, user.sessionId);
        return message("Sessão encerrada.");
      },
      atualizarSenha: async (q: M.AtualizarSenhaRequestModel) => {
        requireUser();
        password(q.senha);
        await this.accounts.password(
          user.id,
          await hashPassword(q.senha),
          user.sessionId,
        );
        return message("Senha atualizada. As outras sessões foram encerradas.");
      },
      obterConfiguracaoAcesso: async (
        _q: M.ObterConfiguracaoAcessoRequestModel,
      ) =>
        success(
          {
            googleDisponivel: this.google.available,
            envioEmailDisponivel: this.emails.available,
          },
          "Opções de acesso consultadas.",
        ),
      obterVinculoGoogle: async (_q: M.ObterVinculoGoogleRequestModel) => {
        requireUser();
        return success(
          { vinculado: await this.accounts.googleLinked(user.id) },
          "Vínculo consultado.",
        );
      },
      iniciarGoogle: (q: M.IniciarGoogleRequestModel) =>
        flow(q.origemFrontend, null),
      iniciarVinculoGoogle: (q: M.IniciarVinculoGoogleRequestModel) => {
        requireUser();
        return flow(q.origemFrontend, user.id);
      },
      trocarCodigoGoogle: async (q: M.TrocarCodigoGoogleRequestModel) => {
        this.require();
        if (
          !q.codigo?.trim() ||
          q.codigo.length > 2000 ||
          q.verificador.length < 43 ||
          q.verificador.length > 128 ||
          q.nonce.length < 32 ||
          q.nonce.length > 128
        )
          throw new ServiceError(
            "A confirmação do Google expirou. Inicie novamente.",
          );
        let origin: string;
        try {
          origin = new URL(q.redirectUri).origin;
        } catch {
          throw new ServiceError("O retorno do Google não é válido.");
        }
        if (this.origin(origin) + "/autenticacao/google" !== q.redirectUri)
          throw new ServiceError("O retorno do Google não é válido.");
        if (
          q.idUsuarioVinculo !== null &&
          (!user.sessionId || q.idUsuarioVinculo !== user.id)
        )
          throw new ServiceError(
            "Entre novamente na conta para vincular o Google.",
            401,
          );
        const identity = await this.google.confirm(
          q.codigo,
          q.verificador,
          q.nonce,
          q.redirectUri,
          signal,
        );
        let a = await this.accounts.get("google", identity.subject);
        const needLink = () =>
          new ServiceError(
            "Já existe uma conta com este e-mail. Entre com e-mail e senha e vincule o Google em Minha conta.",
            409,
          );
        if (q.idUsuarioVinculo) {
          if (a && a.idUsuario !== q.idUsuarioVinculo)
            throw new ServiceError(
              "Essa conta Google já está vinculada a outra conta.",
              409,
            );
          try {
            await this.accounts.linkGoogle(
              q.idUsuarioVinculo,
              identity.subject,
              email(identity.email),
            );
          } catch (e) {
            if ((e as { code?: string }).code === "23505")
              throw new ServiceError(
                "Esta conta já possui um vínculo com o Google.",
                409,
              );
            throw e;
          }
          a = await this.accounts.get("id", q.idUsuarioVinculo);
        } else if (!a) {
          const normalized = email(identity.email);
          if (await this.accounts.get("email", normalized)) throw needLink();
          const id = randomUUID();
          try {
            await this.accounts.create(
              id,
              normalized,
              null,
              new Date().toISOString(),
              { nome_completo: identity.name.slice(0, 200) },
              false,
              identity.subject,
            );
          } catch (e) {
            if ((e as { code?: string }).code !== "23505") throw e;
            a = await this.accounts.get("google", identity.subject);
            if (!a) throw needLink();
          }
          a ??= await this.accounts.get("id", id);
        }
        if (!a) throw new ServiceError("Conta indisponível.", 503);
        return this.session(a);
      },
    };
  }
}
