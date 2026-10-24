import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import type { Logger } from "pino";
import type { ConfiguracoesAmbiente } from "../config/configuracoes-ambiente.js";
import type * as ContratosApi from "../contracts/modelos-requisicoes-respostas-api.js";
import { ErroRegraNegocioHttp } from "../domain/erros-validacoes-respostas-api.js";
import { ConexaoTransacoesPostgreSql } from "./conexao-transacoes-postgresql.js";
import {
  consultasSqlEmailsTransacionais,
  type NomeConsultaEmailTransacional,
} from "./consultas-sql-emails-transacionais.js";
import {
  calcularHashToken,
  descriptografarConteudoAutenticado,
  criptografarConteudoAutenticado,
} from "./criptografia-senhas-tokens-links.js";
import type { PendingEmail } from "./repositorio-contas-sessoes-postgresql.js";
import { validarUrlHttps, type HttpFetch } from "./seguranca-requisicoes-https.js";
import type { PersistenciaWorkerEmailsSupabase } from "./persistencia-worker-emails-supabase.js";

interface EmailTransacionalReservado {
  idEmailTransacional: string;
  tipo_evento: string;
  idUsuario: string | null;
  email_destinatario: string;
  assunto: string;
  dados_template: string;
  link_protegido: string | null;
  validade_link_em: Date | null;
  quantidade_tentativas: number;
  maximo_tentativas: number;
  chave_idempotencia: string;
  identificador_processamento: string;
}

export const tiposEventoEmailTransacional = [
  "EMAIL_VERIFICATION",
  "WELCOME_EMAIL",
  "PASSWORD_RESET",
  "USER_INACTIVE",
  "SUBSCRIPTION_EXPIRING",
] as const;

type TipoEventoEmailTransacional = (typeof tiposEventoEmailTransacional)[number];

export class FalhaEntregaEmailTransacional extends Error {
  constructor(
    code: string,
    readonly permanent: boolean,
  ) {
    super(code);
  }
}

export function prepararParametrosSqlNomeados(sql: string, params: Record<string, unknown>) {
  const keys: string[] = [];

  const consultaSqlParametrizada = sql.replace(
    /@(\w+)/g,
    (_correspondencia, nomeParametro: string) => {
      if (!(nomeParametro in params)) {
        throw new Error("Parâmetro ausente: " + nomeParametro);
      }

      if (!keys.includes(nomeParametro)) {
        keys.push(nomeParametro);
      }

      return "$" + (keys.indexOf(nomeParametro) + 1);
    },
  );

  return {
    text: consultaSqlParametrizada,
    values: keys.map((nomeParametro) => params[nomeParametro]),
  };
}

const escaparHtmlMensagemEmail = (textoNormalizado: string) =>
  textoNormalizado.replace(
    /[&<>"']/g,
    (caractereHtml) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[caractereHtml]!,
  );

export class ServicoEnvioEmailsTransacionaisResend {
  constructor(
    readonly conexaoPostgreSql: ConexaoTransacoesPostgreSql,
    readonly config: ConfiguracoesAmbiente,
    readonly clienteHttp: HttpFetch = fetch,
    readonly persistenciaSupabase?: PersistenciaWorkerEmailsSupabase,
  ) {}

  get estaDisponivel() {
    return !!this.config.email.key && !!this.config.email.from && this.config.auth.key.length >= 64;
  }

  exigirConfiguracaoEnvioEmails() {
    if (!this.estaDisponivel) {
      throw new ErroRegraNegocioHttp(
        "O envio de e-mails ainda não está disponível. Entre em contato com o suporte.",
        503,
      );
    }
  }

  async fluxoEstaHabilitado(type: string) {
    if (!tiposEventoEmailTransacional.includes(type as TipoEventoEmailTransacional)) {
      return false;
    }
    if (this.persistenciaSupabase) {
      return (
        (await this.listarFluxosEmail()).find((fluxo) => fluxo.tipoEvento === type)?.habilitado ??
        false
      );
    }

    const resultadoAtualizacaoFluxoEmail =
      await this.conexaoPostgreSql.executarConsultaSqlParametrizada<{
        habilitado: boolean;
      }>("select habilitado from comunicacao.workflows where tipo_evento=$1", [type]);

    return (
      resultadoAtualizacaoFluxoEmail.rows[0]?.habilitado ??
      this.config.email.workflows[type as TipoEventoEmailTransacional]
    );
  }

  async listarFluxosEmail(): Promise<ContratosApi.FluxoEmailResponseModel[]> {
    const fluxosEmailPersistidos = (
      await (this.persistenciaSupabase
        ? this.persistenciaSupabase.executar<{
            tipo_evento: string;
            habilitado: boolean;
            atualizado_em: Date;
          }>("listarFluxos")
        : this.conexaoPostgreSql.executarConsultaSqlParametrizada<{
            tipo_evento: string;
            habilitado: boolean;
            atualizado_em: Date;
          }>("select tipo_evento,habilitado,atualizado_em from comunicacao.workflows"))
    ).rows;

    return tiposEventoEmailTransacional.map((type) => {
      const registroBanco = fluxosEmailPersistidos.find(
        (registroAtual) => registroAtual.tipo_evento === type,
      );

      return {
        tipoEvento: type,
        habilitado: registroBanco?.habilitado ?? this.config.email.workflows[type],
        dataHoraAtualizacao: registroBanco?.atualizado_em.toISOString() ?? null,
      };
    });
  }

  async atualizarFluxoEmail(
    type: string,
    enabled: boolean,
  ): Promise<ContratosApi.FluxoEmailResponseModel> {
    const registroBanco = (
      await this.conexaoPostgreSql.executarConsultaSqlParametrizada<{ atualizado_em: Date }>(
        "insert into comunicacao.workflows(tipo_evento,habilitado,atualizado_em) values($1,$2,now()) on conflict(tipo_evento) do update set habilitado=excluded.habilitado,atualizado_em=now() returning atualizado_em",
        [type, enabled],
      )
    ).rows[0]!;

    return {
      tipoEvento: type,
      habilitado: enabled,
      dataHoraAtualizacao: registroBanco.atualizado_em.toISOString(),
    };
  }

  prepararMensagemEmail(
    userId: string,
    to: string,
    name: string,
    purpose: string,
    link: string,
  ): PendingEmail {
    this.exigirConfiguracaoEnvioEmails();

    const type = purpose === "confirmacao" ? "EMAIL_VERIFICATION" : "PASSWORD_RESET";

    const identificadorEmail = randomUUID();

    return {
      id: identificadorEmail,
      type,
      userId,
      to,
      subject:
        type === "EMAIL_VERIFICATION"
          ? "Confirme seu e-mail — ConcursaAI"
          : "Recupere seu acesso — ConcursaAI",
      template: JSON.stringify({ nome: name.slice(0, 200) }),
      link: criptografarConteudoAutenticado(link, this.config.auth.key),
      attempts: this.config.email.attempts,
      idempotency: type + "/" + identificadorEmail,
    };
  }

  async executarConsultaEmail(
    nomeConsulta: NomeConsultaEmailTransacional,
    params: Record<string, unknown> = {},
    client?: PoolClient,
  ) {
    if (this.persistenciaSupabase) return this.persistenciaSupabase.executar(nomeConsulta, params);
    const sql = consultasSqlEmailsTransacionais[nomeConsulta];

    if (!sql) {
      throw new Error("Consulta de email desconhecida: " + nomeConsulta);
    }

    const solicitacaoSql = prepararParametrosSqlNomeados(sql, params);

    return client
      ? client.query(solicitacaoSql)
      : this.conexaoPostgreSql.executarConsultaSqlParametrizada(
          solicitacaoSql.text,
          solicitacaoSql.values,
        );
  }

  async obterPreferenciaEmail(identificadorEmail: string) {
    return (
      await this.conexaoPostgreSql.executarConsultaSqlParametrizada<{ value: boolean }>(
        'select coalesce((select receber_inatividade from comunicacao.preferencias where "idUsuario"=$1),false) as value',
        [identificadorEmail],
      )
    ).rows[0]!.value;
  }

  async atualizarPreferenciaEmail(identificadorEmail: string, receive: boolean) {
    await this.conexaoPostgreSql.executarTransacao(async (clienteTransacaoPostgreSql) => {
      await clienteTransacaoPostgreSql.query(
        'insert into comunicacao.preferencias("idUsuario",receber_inatividade,atualizado_em) values($1,$2,now()) on conflict("idUsuario") do update set receber_inatividade=excluded.receber_inatividade,atualizado_em=now()',
        [identificadorEmail, receive],
      );

      if (!receive) {
        await clienteTransacaoPostgreSql.query(
          `update comunicacao.emails_transacionais set status='cancelado',identificador_processamento=null,expiracao_reserva_em=null where "idUsuario"=$1 and tipo_evento='USER_INACTIVE' and status in ('pendente','processando')`,
          [identificadorEmail],
        );
      }
    });
  }

  async listarHistoricoEmails(
    solicitacaoListarEmailsTransacionais: ContratosApi.ListarEmailsTransacionaisRequestModel,
  ) {
    const where = `from comunicacao.emails_transacionais where ($1::uuid is null or "idUsuario"=$1) and ($2::text is null or tipo_evento=$2) and ($3::text is null or status=$3) and ($4::timestamptz is null or criado_em>=$4) and ($5::timestamptz is null or criado_em<=$5)`;

    const values = [
      solicitacaoListarEmailsTransacionais.idUsuario,
      solicitacaoListarEmailsTransacionais.tipoEvento,
      solicitacaoListarEmailsTransacionais.status,
      solicitacaoListarEmailsTransacionais.de,
      solicitacaoListarEmailsTransacionais.ate,
    ];

    const total = Number(
      (
        await this.conexaoPostgreSql.executarConsultaSqlParametrizada<{ total: string }>(
          "select count(*) as total " + where,
          values,
        )
      ).rows[0]!.total,
    );

    const emailsPersistidos = (
      await this.conexaoPostgreSql.executarConsultaSqlParametrizada(
        `select "idEmailTransacional","idUsuario",tipo_evento,email_destinatario,status,quantidade_tentativas,maximo_tentativas,criado_em,enviado_em,entregue_em,mensagem_erro ${where} order by criado_em desc,"idEmailTransacional" desc limit $6 offset $7`,
        [
          ...values,
          solicitacaoListarEmailsTransacionais.quantidade,
          (solicitacaoListarEmailsTransacionais.pagina - 1) *
            solicitacaoListarEmailsTransacionais.quantidade,
        ],
      )
    ).rows;

    const itens: ContratosApi.EmailTransacionalResponseModel[] = emailsPersistidos.map(
      (registroAtual) => ({
        idEmailTransacional: registroAtual.idEmailTransacional as string,
        idUsuario: registroAtual.idUsuario as string | null,
        tipoEvento: registroAtual.tipo_evento as string,
        emailDestinatario: registroAtual.email_destinatario as string,
        status: registroAtual.status as string,
        quantidadeTentativas: registroAtual.quantidade_tentativas as number,
        maximoTentativas: registroAtual.maximo_tentativas as number,
        dataHoraCriacao: (registroAtual.criado_em as Date).toISOString(),
        dataHoraEnvio: (registroAtual.enviado_em as Date | null)?.toISOString() ?? null,
        dataHoraEntrega: (registroAtual.entregue_em as Date | null)?.toISOString() ?? null,
        codigoErro: registroAtual.mensagem_erro as string | null,
      }),
    );

    return { itens, total, pagina: solicitacaoListarEmailsTransacionais.pagina };
  }

  async obterMetricasEmails(): Promise<ContratosApi.MetricasEmailsResponseModel> {
    const resultadoConsultaPostgreSql = (
      await this.conexaoPostgreSql.executarConsultaSqlParametrizada<Record<string, string>>(
        `select count(*) filter(where status='pendente') as pendentes,count(*) filter(where status='processando') as processando,count(*) filter(where status='aceito') as aceitos,count(*) filter(where status='entregue') as entregues,count(*) filter(where status='falha') as falhas,count(*) filter(where status='bounce') as bounces from comunicacao.emails_transacionais`,
      )
    ).rows[0]!;

    return {
      pendentes: Number(resultadoConsultaPostgreSql.pendentes),
      processando: Number(resultadoConsultaPostgreSql.processando),
      aceitos: Number(resultadoConsultaPostgreSql.aceitos),
      entregues: Number(resultadoConsultaPostgreSql.entregues),
      falhas: Number(resultadoConsultaPostgreSql.falhas),
      bounces: Number(resultadoConsultaPostgreSql.bounces),
    };
  }

  async reprocessarEmailComFalha(identificadorEmail: string) {
    return (
      (
        await this.executarConsultaEmail("reprocessarEmailFalho", {
          id: identificadorEmail,
        })
      ).rowCount === 1
    );
  }

  validarAssinaturaWebhook(
    identificadorEmail: string,
    timestamp: string,
    signatures: string,
    body: Buffer,
  ) {
    const secret = this.config.email.webhookSecret;

    if (
      !secret.startsWith("whsec_") ||
      !/^\d+$/.test(timestamp) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
      !identificadorEmail ||
      identificadorEmail.length > 200 ||
      body.length > 65536
    ) {
      return false;
    }

    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(secret.slice(6))) {
      return false;
    }

    const expected = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
      .update(identificadorEmail + "." + timestamp + ".")
      .update(body)
      .digest();

    return signatures.split(" ").some((textoNormalizado) => {
      if (!textoNormalizado.startsWith("v1,")) {
        return false;
      }

      const actual = Buffer.from(textoNormalizado.slice(3), "base64");

      return actual.length === expected.length && timingSafeEqual(actual, expected);
    });
  }

  async registrarEventoWebhook(webhook: string, identificadorEmail: string, event: string) {
    if (
      !["email.delivered", "email.bounced", "email.complained", "email.failed"].includes(event) ||
      webhook.length > 200 ||
      identificadorEmail.length > 200
    ) {
      return;
    }
    if (this.persistenciaSupabase) {
      await this.persistenciaSupabase.registrarWebhook(webhook, identificadorEmail, event);
      return;
    }

    await this.conexaoPostgreSql.executarTransacao(async (clienteTransacaoPostgreSql) => {
      await this.executarConsultaEmail(
        "registrarEventoProvedorEmail",
        { webhook, id: identificadorEmail, evento: event },
        clienteTransacaoPostgreSql,
      );

      await this.executarConsultaEmail(
        "aplicarEventosRecebidosEmail",
        { id: identificadorEmail },
        clienteTransacaoPostgreSql,
      );
    });
  }

  async reservarLoteEmails(): Promise<EmailTransacionalReservado[]> {
    const types = (await this.listarFluxosEmail())
      .filter((registroAtual) => registroAtual.habilitado)
      .map((registroAtual) => registroAtual.tipoEvento);

    if (!types.length) {
      return [];
    }

    await this.executarConsultaEmail("encerrarReservasExpiradas");

    return (
      await this.executarConsultaEmail("reservarLoteEmailsPendentes", {
        limite: this.config.email.batch,
        tipos: types,
        reserva: randomUUID(),
        segundos: this.config.email.reservation,
      })
    ).rows as EmailTransacionalReservado[];
  }

  async podeEnviarEmail(email: EmailTransacionalReservado) {
    if (email.validade_link_em && email.validade_link_em.getTime() <= Date.now()) {
      return false;
    }

    const params = {
      id: email.idEmailTransacional,
      reserva: email.identificador_processamento,
    };

    if (
      !Object.values(
        (await this.executarConsultaEmail("consultarReservaEmail", params)).rows[0] ?? {},
      )[0]
    ) {
      return false;
    }

    if (email.tipo_evento === "USER_INACTIVE") {
      return !!Object.values(
        (
          await this.executarConsultaEmail("consultarPreferenciaInatividade", {
            id: email.idUsuario,
            email: email.idEmailTransacional,
          })
        ).rows[0] ?? {},
      )[0];
    }

    if (!email.link_protegido) {
      return true;
    }

    const url = new URL(
      descriptografarConteudoAutenticado(email.link_protegido, this.config.auth.key),
    );

    const token = new URLSearchParams(url.hash.slice(1)).get("token");

    if (!token) {
      return false;
    }

    return !!Object.values(
      (
        await this.executarConsultaEmail("validarElegibilidadeEnvioEmail", {
          hash: calcularHashToken(token),
          id: email.idUsuario,
          finalidade: email.tipo_evento === "EMAIL_VERIFICATION" ? "confirmacao" : "recuperacao",
        })
      ).rows[0] ?? {},
    )[0];
  }

  renderizarConteudoEmail(email: EmailTransacionalReservado) {
    const dadosEmail = JSON.parse(email.dados_template) as { nome?: string };

    const name = dadosEmail.nome ?? "";

    const actions: Record<string, [string, string, string]> = {
      EMAIL_VERIFICATION: [
        "Confirme seu e-mail",
        "Ative sua conta para começar a estudar. Este link vale por 24 horas.",
        "Confirmar e-mail",
      ],
      PASSWORD_RESET: [
        "Redefina sua senha",
        "Você solicitou a troca da senha. Este link vale por 30 minutos.",
        "Criar nova senha",
      ],
      WELCOME_EMAIL: [
        "Bem-vindo ao ConcursaAI",
        "Sua conta está pronta. Continue sua jornada de estudos com foco.",
        "Acessar plataforma",
      ],
      USER_INACTIVE: [
        "Seu estudo continua aqui",
        "Que tal retomar seus simulados e acompanhar sua evolução?",
        "Voltar a estudar",
      ],
      SUBSCRIPTION_EXPIRING: [
        "Acompanhe a vigência do seu Premium",
        "Sua assinatura está próxima do vencimento ou acabou de vencer. Consulte Minha Assinatura para conferir a data e renovar, se desejar. O pagamento é antecipado e não há renovação automática.",
        "Minha Assinatura",
      ],
    };

    const action = actions[email.tipo_evento];

    if (!action) {
      throw new Error("Tipo de e-mail não reconhecido.");
    }

    const origin = new URL(this.config.auth.clientUrl);

    const link = email.link_protegido
      ? descriptografarConteudoAutenticado(email.link_protegido, this.config.auth.key)
      : this.config.auth.clientUrl.replace(/\/+$/, "") +
        (email.tipo_evento === "SUBSCRIPTION_EXPIRING"
          ? "/estudante/minha-assinatura"
          : email.tipo_evento === "USER_INACTIVE"
            ? "/minha-conta"
            : "/entrar");

    const destination = new URL(link);

    if (
      email.link_protegido &&
      (destination.origin !== origin.origin || !destination.pathname.startsWith("/autenticacao/"))
    ) {
      throw new Error("Link do e-mail fora da origem configurada.");
    }

    const [title, description, button] = action.map(escaparHtmlMensagemEmail);

    const safeLink = escaparHtmlMensagemEmail(link);

    const greeting = name.trim() ? `Olá, ${escaparHtmlMensagemEmail(name)}!` : "Olá!";

    const notice = ["EMAIL_VERIFICATION", "PASSWORD_RESET"].includes(email.tipo_evento)
      ? '<p style="color:#64748b;font-size:13px">Se você não solicitou este e-mail, pode ignorá-lo.</p>'
      : "";

    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f7ff;font-family:Arial,sans-serif;color:#18213e"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="100%" style="max-width:560px;background:white;border-radius:20px"><tr><td style="padding:32px"><p style="color:#4034a5;font-weight:700">${escaparHtmlMensagemEmail(this.config.email.appName)}</p><h1 style="font-size:27px">${title}</h1><p>${greeting}</p><p>${description}</p><p style="margin:32px 0"><a href="${safeLink}" style="background:#28216d;color:white;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:700">${button}</a></p><p style="font-size:13px;overflow-wrap:anywhere">Se o botão não abrir, use este endereço:<br><a href="${safeLink}">${safeLink}</a></p>${notice}${email.tipo_evento === "USER_INACTIVE" ? '<p style="font-size:13px">Você pode desativar estes lembretes em Minha conta.</p>' : ""}</td></tr></table></td></tr></table></body></html>`;

    return {
      html,
      text: `${name},\n\n${action[1]}\n\n${link}\n\n${email.tipo_evento === "USER_INACTIVE" ? "Desative estes lembretes em Minha conta." : "Se não solicitou este e-mail, ignore-o."}\n\n${this.config.email.appName}`,
    };
  }

  async enviarEmailResend(email: EmailTransacionalReservado, sinalCancelamento?: AbortSignal) {
    const configuracoesServico = this.config.email;

    if (!configuracoesServico.key || !configuracoesServico.from) {
      throw new FalhaEntregaEmailTransacional("provedor_nao_configurado", false);
    }

    if (!validarUrlHttps(configuracoesServico.url)) {
      throw new FalhaEntregaEmailTransacional("provedor_nao_configurado", true);
    }

    const content = this.renderizarConteudoEmail(email);

    try {
      const response = await this.clienteHttp(new URL("emails", configuracoesServico.url), {
        method: "POST",
        headers: {
          Authorization: "Bearer " + configuracoesServico.key,
          "Idempotency-Key": email.chave_idempotencia,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${configuracoesServico.fromName} <${configuracoesServico.from}>`,
          to: [email.email_destinatario],
          subject: email.assunto,
          ...content,
        }),
        redirect: "error",
        signal: sinalCancelamento
          ? AbortSignal.any([sinalCancelamento, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
      });

      if (!response.ok) {
        throw new FalhaEntregaEmailTransacional(
          "resend_http_" + response.status,
          response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status),
        );
      }

      const body = (await response.json()) as { id?: string };

      if (!body.id) {
        throw new FalhaEntregaEmailTransacional("resend_resposta_ambigua", false);
      }

      return body.id;
    } catch (erroCapturado) {
      if (erroCapturado instanceof FalhaEntregaEmailTransacional) {
        throw erroCapturado;
      }

      if (sinalCancelamento?.aborted) {
        throw erroCapturado;
      }

      throw new FalhaEntregaEmailTransacional(
        erroCapturado instanceof SyntaxError
          ? "resend_resposta_ambigua"
          : erroCapturado instanceof Error && erroCapturado.name === "TimeoutError"
            ? "resend_timeout"
            : "resend_conexao",
        false,
      );
    }
  }

  async processarEmailReservado(
    email: EmailTransacionalReservado,
    registradorEventos: Logger,
    sinalCancelamento: AbortSignal,
  ) {
    const params = {
      id: email.idEmailTransacional,
      reserva: email.identificador_processamento,
    };

    try {
      if (!(await this.fluxoEstaHabilitado(email.tipo_evento))) {
        await this.executarConsultaEmail("devolverEmailAguardandoAtivacao", params);

        return;
      }

      if (!(await this.podeEnviarEmail(email))) {
        await this.executarConsultaEmail("cancelarEmailTransacional", {
          ...params,
          motivo: "link_expirado_ou_preferencia_desativada",
        });

        return;
      }

      const identificadorEmail = await this.enviarEmailResend(email, sinalCancelamento);

      if (this.persistenciaSupabase) {
        await this.persistenciaSupabase.confirmarEnvio({ ...params, provedor: identificadorEmail });
      } else
        await this.conexaoPostgreSql.executarTransacao(async (clienteTransacaoPostgreSql) => {
          const resultadoRegistroEventoEmail = await this.executarConsultaEmail(
            "marcarEmailAceitoProvedor",
            { ...params, provedor: identificadorEmail },
            clienteTransacaoPostgreSql,
          );

          if (resultadoRegistroEventoEmail.rowCount === 1) {
            await this.executarConsultaEmail(
              "aplicarEventosRecebidosEmail",
              { id: identificadorEmail },
              clienteTransacaoPostgreSql,
            );
          }
        });

      registradorEventos.info(
        { emailId: email.idEmailTransacional, type: email.tipo_evento },
        "Email aceito pelo provedor",
      );
    } catch (error) {
      if (sinalCancelamento.aborted) {
        return;
      }

      const permanent = error instanceof FalhaEntregaEmailTransacional && error.permanent;

      const definitive = permanent || email.quantidade_tentativas >= email.maximo_tentativas;

      const code =
        error instanceof FalhaEntregaEmailTransacional ? error.message : "processamento_interno";

      const base = this.config.email.retryBase;

      const tamanhoMaximo = Math.max(base, this.config.email.retryMax);

      const seconds = Math.min(
        tamanhoMaximo,
        base * 2 ** Math.min(email.quantidade_tentativas - 1, 16),
      );

      await this.executarConsultaEmail("marcarFalhaProcessamentoEmail", {
        ...params,
        status: definitive ? "falha" : "pendente",
        proxima: definitive
          ? null
          : new Date(Date.now() + 1000 * (seconds + Math.random() * Math.min(30, seconds * 0.25))),
        erro: code.slice(0, 100),
        definitiva: definitive,
      });

      registradorEventos.warn(
        { emailId: email.idEmailTransacional, code },
        "Falha no processamento de email",
      );
    }
  }

  async executarCicloWorker(
    registradorEventos: Logger,
    sinalCancelamento: AbortSignal,
    maintenance: boolean,
  ) {
    if (maintenance) {
      await this.executarConsultaEmail("limparHistoricoEmailsAntigos", {
        dias: this.config.email.retention,
      });

      await this.executarConsultaEmail("limparEventosEmailAntigos", {
        dias: this.config.email.retention,
      });

      if (
        (await this.fluxoEstaHabilitado("USER_INACTIVE")) &&
        this.config.email.inactivityDays.length
      ) {
        await this.executarConsultaEmail("enfileirarEmailsUsuariosInativos", {
          dias: [...new Set(this.config.email.inactivityDays)].sort(
            (primeiroPrazoDias, segundoPrazoDias) => primeiroPrazoDias - segundoPrazoDias,
          ),
          maximo: this.config.email.attempts,
          limite: this.config.email.batch,
        });
      }
    }

    if (this.config.email.key && this.config.email.from) {
      for (const email of await this.reservarLoteEmails()) {
        if (sinalCancelamento.aborted) {
          break;
        }

        await this.processarEmailReservado(email, registradorEventos, sinalCancelamento);
      }
    }
  }
}
