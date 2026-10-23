import { SignJWT, jwtVerify } from "jose";
import { createHash, randomUUID } from "node:crypto";
import type { ConfiguracoesAmbiente } from "../config/configuracoes-ambiente.js";
import type * as ContratosApi from "../contracts/modelos-requisicoes-respostas-api.js";
import { uuidPattern } from "../contracts/validacao-conversao-contratos-api.js";
import {
  ErroRegraNegocioHttp,
  criarRespostaSucesso,
} from "../domain/erros-validacoes-respostas-api.js";
import { validarDadosPessoais } from "../domain/validacao-dados-pessoais.js";
import { ClienteAutenticacaoGoogle } from "../infrastructure/cliente-autenticacao-google.js";
import type { IdentidadeUsuarioAutenticado } from "../infrastructure/conexao-transacoes-postgresql.js";
import {
  calcularHashToken,
  gerarTokenAleatorioSeguro,
  gerarHashSenhaCompativel,
  verificarSenhaHashPersistido,
} from "../infrastructure/criptografia-senhas-tokens-links.js";
import { ServicoEnvioEmailsTransacionaisResend } from "../infrastructure/envio-emails-transacionais-resend.js";
import {
  RepositorioContasSessoesPostgreSql,
  projetarPerfilUsuario,
  type Account,
  type Session,
} from "../infrastructure/repositorio-contas-sessoes-postgresql.js";

const invalidCredentials = "E-mail ou senha incorretos. Confira seus dados e tente novamente.";

const message = (sessaoAutenticada: string) =>
  criarRespostaSucesso({ mensagem: sessaoAutenticada }, sessaoAutenticada);

function email(value: string) {
  const valorAtual = value?.trim() ?? "";

  if (
    valorAtual.length > 254 ||
    !/^\S+@[^\s@]+\.[^\s@]+$/.test(valorAtual) ||
    /[<>\r\n]/.test(valorAtual)
  ) {
    throw new ErroRegraNegocioHttp("Informe um e-mail válido.");
  }

  return valorAtual.toLowerCase();
}

function password(value: string) {
  if (!value?.trim() || value.length < 8 || value.length > 128) {
    throw new ErroRegraNegocioHttp("A senha deve ter entre 8 e 128 caracteres.");
  }
}

function token(value: string) {
  if (!value?.trim() || value.length < 32 || value.length > 200) {
    throw new ErroRegraNegocioHttp("A confirmação expirou. Inicie novamente.", 401);
  }
}

export class ServicoAutenticacaoContasSessoes {
  constructor(
    readonly config: ConfiguracoesAmbiente,
    readonly accounts: RepositorioContasSessoesPostgreSql,
    readonly servicoEmailsTransacionais: ServicoEnvioEmailsTransacionaisResend,
    readonly google: ClienteAutenticacaoGoogle,
  ) {}

  exigirConfiguracaoAutenticacao() {
    if (this.config.auth.key.length < 64) {
      throw new ErroRegraNegocioHttp(
        "A autenticação ainda precisa ser configurada no servidor.",
        503,
      );
    }
  }

  validarOrigemRetornoAutenticacao(value: string | null) {
    const valorAtual = (value ?? this.config.auth.clientUrl).replace(/\/+$/, "");

    try {
      const url = new URL(valorAtual);

      if (
        !this.config.origins.some(
          (configuracoesServico) => configuracoesServico.toLowerCase() === valorAtual.toLowerCase(),
        ) ||
        url.origin !== valorAtual ||
        url.username ||
        !["https:", "http:"].includes(url.protocol) ||
        (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.protocol !== "https:")
      ) {
        throw new Error();
      }

      return valorAtual;
    } catch {
      throw new ErroRegraNegocioHttp("Origem de acesso não autorizada.", 403);
    }
  }

  private exigirContaAtivaComEmailConfirmado(contaUsuario: Account) {
    if (!contaUsuario.email_confirmado_em) {
      throw new ErroRegraNegocioHttp(
        "Confirme seu e-mail antes de entrar. Verifique também a pasta de spam.",
        403,
      );
    }

    if (projetarPerfilUsuario(contaUsuario).estadoCadastro !== "ativo") {
      throw new ErroRegraNegocioHttp("A conta não está disponível para acesso.", 403);
    }
  }

  async autenticarTokenAcessoJwt(accessToken: string): Promise<IdentidadeUsuarioAutenticado> {
    let identificadorUsuario: string;

    let sessionId: string;

    try {
      this.exigirConfiguracaoAutenticacao();

      const { payload: perfilUsuario } = await jwtVerify(accessToken, this.config.auth.key, {
        issuer: this.config.auth.issuer,
        audience: this.config.auth.audience,
        algorithms: ["HS256"],
        clockTolerance: 30,
        requiredClaims: ["exp", "sub", "sid"],
      });

      if (
        typeof perfilUsuario.sub !== "string" ||
        !uuidPattern.test(perfilUsuario.sub) ||
        typeof perfilUsuario.sid !== "string" ||
        !uuidPattern.test(perfilUsuario.sid)
      ) {
        throw new Error();
      }

      identificadorUsuario = perfilUsuario.sub;

      sessionId = perfilUsuario.sid;
    } catch {
      throw new ErroRegraNegocioHttp("Entre na sua conta para continuar.", 401);
    }

    if (!(await this.accounts.validarSessaoPersistida(sessionId, identificadorUsuario))) {
      throw new ErroRegraNegocioHttp("Entre na sua conta para continuar.", 401);
    }

    return { id: identificadorUsuario, sessionId, token: accessToken };
  }

  private async criarRespostaSessaoComTokenJwt(
    contaUsuario: Account,
    sessaoAutenticada: Session,
    refresh: string,
  ): Promise<ContratosApi.RespostaPadraoApi<ContratosApi.SessaoResponseModel>> {
    this.exigirConfiguracaoAutenticacao();

    const now = Math.floor(Date.now() / 1000);

    const exp = Math.min(
      now + this.config.auth.accessMinutes * 60,
      Math.floor(new Date(sessaoAutenticada.expira_em).getTime() / 1000),
    );

    if (exp <= now) {
      throw new ErroRegraNegocioHttp("Sua sessão expirou. Entre novamente.", 401);
    }

    const access = await new SignJWT({
      sub: contaUsuario.idUsuario,
      sid: sessaoAutenticada.idSessao,
      jti: randomUUID(),
      tipo: projetarPerfilUsuario(contaUsuario).tipo,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(this.config.auth.issuer)
      .setAudience(this.config.auth.audience)
      .setNotBefore(now - 5)
      .setExpirationTime(exp)
      .sign(this.config.auth.key);

    return criarRespostaSucesso(
      {
        accessToken: access,
        refreshToken: refresh,
        expiresIn: exp - now,
        tokenType: "bearer",
        usuario: projetarPerfilUsuario(contaUsuario),
      },
      "Acesso realizado.",
    );
  }

  private async criarSessaoAutenticadaPersistida(contaUsuario: Account) {
    this.exigirConfiguracaoAutenticacao();

    this.exigirContaAtivaComEmailConfirmado(contaUsuario);

    const refresh = gerarTokenAleatorioSeguro();

    const sessaoAutenticada: Session = {
      idSessao: randomUUID(),
      idUsuario: contaUsuario.idUsuario,
      expira_em: new Date(Date.now() + this.config.auth.sessionDays * 86400000),
    };

    if (
      !(await this.accounts.criarSessaoPersistida(
        sessaoAutenticada,
        calcularHashToken(refresh),
        contaUsuario.versao_credenciais,
      ))
    ) {
      throw new ErroRegraNegocioHttp("Sua conta foi atualizada. Entre novamente.", 401);
    }

    const reloaded = await this.accounts.buscarContaPorIdentificador("id", contaUsuario.idUsuario);

    if (!reloaded) {
      throw new ErroRegraNegocioHttp("Conta indisponível.", 401);
    }

    return this.criarRespostaSessaoComTokenJwt(reloaded, sessaoAutenticada, refresh);
  }

  private async enfileirarTokenConfirmacaoOuRecuperacaoSenha(
    contaUsuario: Account,
    purpose: string,
    checked = false,
  ) {
    const type = purpose === "confirmacao" ? "EMAIL_VERIFICATION" : "PASSWORD_RESET";

    if (!checked && !(await this.servicoEmailsTransacionais.fluxoEstaHabilitado(type))) {
      throw new ErroRegraNegocioHttp(
        "Este envio de e-mail está temporariamente indisponível.",
        503,
      );
    }

    const tokenConfirmacaoOuRecuperacao = gerarTokenAleatorioSeguro();

    const perfilUsuario = projetarPerfilUsuario(contaUsuario);

    const link =
      this.validarOrigemRetornoAutenticacao(null) +
      (purpose === "confirmacao"
        ? "/autenticacao/confirmar-email"
        : "/autenticacao/redefinir-senha") +
      "#tipo=" +
      purpose +
      "&token=" +
      encodeURIComponent(tokenConfirmacaoOuRecuperacao);

    const pending = this.servicoEmailsTransacionais.prepararMensagemEmail(
      contaUsuario.idUsuario,
      perfilUsuario.email,
      perfilUsuario.nomeCompleto,
      purpose,
      link,
    );

    await this.accounts.registrarTokenEmail(
      contaUsuario.idUsuario,
      purpose,
      calcularHashToken(tokenConfirmacaoOuRecuperacao),
      new Date(Date.now() + (purpose === "confirmacao" ? 1440 : 30) * 60000),
      pending,
    );
  }

  criarOperacoesAutenticacaoUsuario(
    user: IdentidadeUsuarioAutenticado,
    sinalCancelamento?: AbortSignal,
  ) {
    const thisAuth = this;

    const requireUser = () => {
      if (!user.id || !user.sessionId) {
        throw new ErroRegraNegocioHttp("Entre na sua conta para continuar.", 401);
      }
    };

    const login = async (
      solicitacaoEntrarEstudante: ContratosApi.EntrarEstudanteRequestModel,
      type: string,
    ) => {
      this.exigirConfiguracaoAutenticacao();

      const normalized = email(solicitacaoEntrarEstudante.email);

      if (
        !solicitacaoEntrarEstudante.senha?.trim() ||
        solicitacaoEntrarEstudante.senha.length > 128
      ) {
        throw new ErroRegraNegocioHttp(invalidCredentials, 401);
      }

      const contaUsuario = await this.accounts.buscarContaPorIdentificador("email", normalized);

      const blocked =
        !!contaUsuario?.bloqueado_ate && Date.parse(contaUsuario.bloqueado_ate) > Date.now();

      const check = await verificarSenhaHashPersistido(
        blocked ? null : (contaUsuario?.senha_hash ?? null),
        contaUsuario?.formato_senha ?? null,
        solicitacaoEntrarEstudante.senha,
      );

      if (!check.valid || !contaUsuario) {
        if (contaUsuario && !blocked) {
          await this.accounts.registrarSenhaIncorreta(contaUsuario.idUsuario);
        }

        throw new ErroRegraNegocioHttp(invalidCredentials, 401);
      }

      if (projetarPerfilUsuario(contaUsuario).tipo !== type) {
        throw new ErroRegraNegocioHttp(invalidCredentials, 401);
      }

      if (
        check.rehash &&
        !(await this.accounts.atualizarHashSenhaLegada(
          contaUsuario.idUsuario,
          contaUsuario.senha_hash!,
          await gerarHashSenhaCompativel(solicitacaoEntrarEstudante.senha),
        ))
      ) {
        throw new ErroRegraNegocioHttp(invalidCredentials, 401);
      }

      return this.criarSessaoAutenticadaPersistida(contaUsuario);
    };

    const flow = async (origin: string | null, link: string | null) => {
      this.exigirConfiguracaoAutenticacao();

      const verificador = gerarTokenAleatorioSeguro();

      const estado = gerarTokenAleatorioSeguro();

      const nonce = gerarTokenAleatorioSeguro();

      const redirectUri = this.validarOrigemRetornoAutenticacao(origin) + "/autenticacao/google";

      return criarRespostaSucesso(
        {
          url: this.google.gerarUrlAutorizacaoGoogle(
            estado,
            createHash("sha256").update(verificador, "ascii").digest("base64url"),
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
      entrarEstudante: (solicitacaoEntrarEstudante: ContratosApi.EntrarEstudanteRequestModel) =>
        login(solicitacaoEntrarEstudante, "estudante"),

      entrarAdministrador: (
        solicitacaoEntrarAdministrador: ContratosApi.EntrarAdministradorRequestModel,
      ) => login(solicitacaoEntrarAdministrador, "administrador"),

      async cadastrarEstudante(
        solicitacaoCadastrarEstudante: ContratosApi.CadastrarEstudanteRequestModel,
      ) {
        const normalized = email(solicitacaoCadastrarEstudante.email);

        password(solicitacaoCadastrarEstudante.senha);

        const perfilUsuario = validarDadosPessoais(solicitacaoCadastrarEstudante.pessoa);

        thisAuth.servicoEmailsTransacionais.exigirConfiguracaoEnvioEmails();

        if (
          !(await thisAuth.servicoEmailsTransacionais.fluxoEstaHabilitado("EMAIL_VERIFICATION"))
        ) {
          throw new ErroRegraNegocioHttp(
            "Este envio de e-mail está temporariamente indisponível.",
            503,
          );
        }

        const registroAnterior = await thisAuth.accounts.buscarContaPorIdentificador(
          "email",
          normalized,
        );

        const response = (identificadorUsuario: string) =>
          criarRespostaSucesso(
            { idUsuario: identificadorUsuario, confirmacaoEmailNecessaria: true },
            "Cadastro recebido. Confira seu e-mail para continuar.",
          );

        if (registroAnterior) {
          if (!registroAnterior.email_confirmado_em) {
            await thisAuth.enfileirarTokenConfirmacaoOuRecuperacaoSenha(
              registroAnterior,
              "confirmacao",
              true,
            );
          }

          return response(randomUUID());
        }

        const identificadorUsuario = randomUUID();

        try {
          await thisAuth.accounts.criarContaUsuario(
            identificadorUsuario,
            normalized,
            await gerarHashSenhaCompativel(solicitacaoCadastrarEstudante.senha),
            null,
            perfilUsuario,
            true,
          );
        } catch (erroCapturado) {
          if ((erroCapturado as { code?: string }).code !== "23505") {
            throw erroCapturado;
          }

          if (await thisAuth.accounts.buscarContaPorIdentificador("email", normalized)) {
            return response(randomUUID());
          }

          throw new ErroRegraNegocioHttp(
            "Já existe um cadastro com os dados pessoais informados.",
            409,
          );
        }

        const contaUsuario = await thisAuth.accounts.buscarContaPorIdentificador(
          "id",
          identificadorUsuario,
        );

        if (!contaUsuario) {
          throw new ErroRegraNegocioHttp("Não foi possível carregar o cadastro.", 503);
        }

        await thisAuth.enfileirarTokenConfirmacaoOuRecuperacaoSenha(
          contaUsuario,
          "confirmacao",
          true,
        );

        return response(identificadorUsuario);
      },

      renovarSessao: async (solicitacaoRenovarSessao: ContratosApi.RenovarSessaoRequestModel) => {
        this.exigirConfiguracaoAutenticacao();

        token(solicitacaoRenovarSessao.refreshToken);

        const refresh = gerarTokenAleatorioSeguro();

        const sessaoAutenticada = await this.accounts.renovarSessaoPersistida(
          calcularHashToken(solicitacaoRenovarSessao.refreshToken),
          calcularHashToken(refresh),
        );

        if (!sessaoAutenticada) {
          throw new ErroRegraNegocioHttp("Sua sessão expirou. Entre novamente.", 401);
        }

        const contaUsuario = await this.accounts.buscarContaPorIdentificador(
          "id",
          sessaoAutenticada.idUsuario,
        );

        if (!contaUsuario) {
          throw new ErroRegraNegocioHttp("Conta indisponível.", 401);
        }

        this.exigirContaAtivaComEmailConfirmado(contaUsuario);

        return this.criarRespostaSessaoComTokenJwt(contaUsuario, sessaoAutenticada, refresh);
      },

      solicitarRecuperacaoSenha: async (
        solicitacaoSolicitarRecuperacaoSenha: ContratosApi.SolicitarRecuperacaoSenhaRequestModel,
      ) => {
        const normalized = email(solicitacaoSolicitarRecuperacaoSenha.email);

        this.servicoEmailsTransacionais.exigirConfiguracaoEnvioEmails();

        const contaUsuario = await this.accounts.buscarContaPorIdentificador("email", normalized);

        if (contaUsuario?.email_confirmado_em) {
          await this.enfileirarTokenConfirmacaoOuRecuperacaoSenha(contaUsuario, "recuperacao");
        }

        return message(
          "Se houver uma conta para este e-mail, você receberá as instruções de recuperação.",
        );
      },

      reenviarConfirmacao: async (
        solicitacaoReenviarConfirmacao: ContratosApi.ReenviarConfirmacaoRequestModel,
      ) => {
        const normalized = email(solicitacaoReenviarConfirmacao.email);

        this.servicoEmailsTransacionais.exigirConfiguracaoEnvioEmails();

        const contaUsuario = await this.accounts.buscarContaPorIdentificador("email", normalized);

        if (contaUsuario && !contaUsuario.email_confirmado_em) {
          await this.enfileirarTokenConfirmacaoOuRecuperacaoSenha(contaUsuario, "confirmacao");
        }

        return message("Se necessário, uma nova confirmação será enviada ao e-mail informado.");
      },

      confirmarEmail: async (
        solicitacaoConfirmarEmailAutenticacao: ContratosApi.ConfirmarEmailAutenticacaoRequestModel,
      ) => {
        token(solicitacaoConfirmarEmailAutenticacao.token);

        if (
          !(await this.accounts.consumirTokenEmail(
            calcularHashToken(solicitacaoConfirmarEmailAutenticacao.token),
            "confirmacao",
            null,
            await this.servicoEmailsTransacionais.fluxoEstaHabilitado("WELCOME_EMAIL"),
          ))
        ) {
          throw new ErroRegraNegocioHttp(
            "O link de confirmação expirou ou já foi utilizado. Solicite um novo e-mail.",
          );
        }

        return message("E-mail confirmado. Entre na sua conta para continuar.");
      },

      redefinirSenha: async (
        solicitacaoRedefinirSenha: ContratosApi.RedefinirSenhaRequestModel,
      ) => {
        token(solicitacaoRedefinirSenha.token);

        password(solicitacaoRedefinirSenha.senha);

        if (
          !(await this.accounts.consumirTokenEmail(
            calcularHashToken(solicitacaoRedefinirSenha.token),
            "recuperacao",
            await gerarHashSenhaCompativel(solicitacaoRedefinirSenha.senha),
          ))
        ) {
          throw new ErroRegraNegocioHttp(
            "O link de recuperação expirou ou já foi utilizado. Solicite um novo e-mail.",
          );
        }

        return message("Senha alterada. Entre com sua nova senha.");
      },

      sairSessao: async (
        solicitacaoSairSessaoNaoUtilizada: ContratosApi.SairSessaoRequestModel,
      ) => {
        requireUser();

        await this.accounts.revogarSessaoPersistida(user.id, user.sessionId);

        return message("Sessão encerrada.");
      },

      atualizarSenha: async (
        solicitacaoAtualizarSenha: ContratosApi.AtualizarSenhaRequestModel,
      ) => {
        requireUser();

        password(solicitacaoAtualizarSenha.senha);

        await this.accounts.atualizarSenhaUsuario(
          user.id,
          await gerarHashSenhaCompativel(solicitacaoAtualizarSenha.senha),
          user.sessionId,
        );

        return message("Senha atualizada. As outras sessões foram encerradas.");
      },

      obterConfiguracaoAcesso: async (
        solicitacaoObterConfiguracaoAcessoNaoUtilizada: ContratosApi.ObterConfiguracaoAcessoRequestModel,
      ) =>
        criarRespostaSucesso(
          {
            googleDisponivel: this.google.estaDisponivel,
            envioEmailDisponivel: this.servicoEmailsTransacionais.estaDisponivel,
          },
          "Opções de acesso consultadas.",
        ),

      obterVinculoGoogle: async (
        solicitacaoObterVinculoGoogleNaoUtilizada: ContratosApi.ObterVinculoGoogleRequestModel,
      ) => {
        requireUser();

        return criarRespostaSucesso(
          { vinculado: await this.accounts.possuiVinculoGoogle(user.id) },
          "Vínculo consultado.",
        );
      },

      iniciarGoogle: (solicitacaoIniciarGoogle: ContratosApi.IniciarGoogleRequestModel) =>
        flow(solicitacaoIniciarGoogle.origemFrontend, null),

      iniciarVinculoGoogle: (
        solicitacaoIniciarVinculoGoogle: ContratosApi.IniciarVinculoGoogleRequestModel,
      ) => {
        requireUser();

        return flow(solicitacaoIniciarVinculoGoogle.origemFrontend, user.id);
      },

      trocarCodigoGoogle: async (
        solicitacaoTrocarCodigoGoogle: ContratosApi.TrocarCodigoGoogleRequestModel,
      ) => {
        this.exigirConfiguracaoAutenticacao();

        if (
          !solicitacaoTrocarCodigoGoogle.codigo?.trim() ||
          solicitacaoTrocarCodigoGoogle.codigo.length > 2000 ||
          solicitacaoTrocarCodigoGoogle.verificador.length < 43 ||
          solicitacaoTrocarCodigoGoogle.verificador.length > 128 ||
          solicitacaoTrocarCodigoGoogle.nonce.length < 32 ||
          solicitacaoTrocarCodigoGoogle.nonce.length > 128
        ) {
          throw new ErroRegraNegocioHttp("A confirmação do Google expirou. Inicie novamente.");
        }

        let origin: string;

        try {
          origin = new URL(solicitacaoTrocarCodigoGoogle.redirectUri).origin;
        } catch {
          throw new ErroRegraNegocioHttp("O retorno do Google não é válido.");
        }

        if (
          this.validarOrigemRetornoAutenticacao(origin) + "/autenticacao/google" !==
          solicitacaoTrocarCodigoGoogle.redirectUri
        ) {
          throw new ErroRegraNegocioHttp("O retorno do Google não é válido.");
        }

        if (
          solicitacaoTrocarCodigoGoogle.idUsuarioVinculo !== null &&
          (!user.sessionId || solicitacaoTrocarCodigoGoogle.idUsuarioVinculo !== user.id)
        ) {
          throw new ErroRegraNegocioHttp("Entre novamente na conta para vincular o Google.", 401);
        }

        const identity = await this.google.confirmarCodigoAutorizacaoGoogle(
          solicitacaoTrocarCodigoGoogle.codigo,
          solicitacaoTrocarCodigoGoogle.verificador,
          solicitacaoTrocarCodigoGoogle.nonce,
          solicitacaoTrocarCodigoGoogle.redirectUri,
          sinalCancelamento,
        );

        let contaUsuario = await this.accounts.buscarContaPorIdentificador(
          "google",
          identity.subject,
        );

        const needLink = () =>
          new ErroRegraNegocioHttp(
            "Já existe uma conta com este e-mail. Entre com e-mail e senha e vincule o Google em Minha conta.",
            409,
          );

        if (solicitacaoTrocarCodigoGoogle.idUsuarioVinculo) {
          if (
            contaUsuario &&
            contaUsuario.idUsuario !== solicitacaoTrocarCodigoGoogle.idUsuarioVinculo
          ) {
            throw new ErroRegraNegocioHttp(
              "Essa conta Google já está vinculada a outra conta.",
              409,
            );
          }

          try {
            await this.accounts.vincularIdentidadeGoogle(
              solicitacaoTrocarCodigoGoogle.idUsuarioVinculo,
              identity.subject,
              email(identity.email),
            );
          } catch (erroCapturado) {
            if ((erroCapturado as { code?: string }).code === "23505") {
              throw new ErroRegraNegocioHttp("Esta conta já possui um vínculo com o Google.", 409);
            }

            throw erroCapturado;
          }

          contaUsuario = await this.accounts.buscarContaPorIdentificador(
            "id",
            solicitacaoTrocarCodigoGoogle.idUsuarioVinculo,
          );
        } else if (!contaUsuario) {
          const normalized = email(identity.email);

          if (await this.accounts.buscarContaPorIdentificador("email", normalized)) {
            throw needLink();
          }

          const identificadorUsuario = randomUUID();

          try {
            await this.accounts.criarContaUsuario(
              identificadorUsuario,
              normalized,
              null,
              new Date().toISOString(),
              { nome_completo: identity.name.slice(0, 200) },
              false,
              identity.subject,
            );
          } catch (erroCapturado) {
            if ((erroCapturado as { code?: string }).code !== "23505") {
              throw erroCapturado;
            }

            contaUsuario = await this.accounts.buscarContaPorIdentificador(
              "google",
              identity.subject,
            );

            if (!contaUsuario) {
              throw needLink();
            }
          }

          contaUsuario ??= await this.accounts.buscarContaPorIdentificador(
            "id",
            identificadorUsuario,
          );
        }

        if (!contaUsuario) {
          throw new ErroRegraNegocioHttp("Conta indisponível.", 503);
        }

        return this.criarSessaoAutenticadaPersistida(contaUsuario);
      },
    };
  }
}
