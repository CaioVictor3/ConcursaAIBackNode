import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import type { Logger } from "pino";
import type { PoolClient } from "pg";
import { Database } from "./database.js";
import { decrypt, encrypt, tokenHash } from "./crypto.js";
import type { PendingEmail } from "./accounts.js";
import type { Config } from "../config/config.js";
import type * as M from "../contracts/models.js";
import { ServiceError } from "../domain/errors.js";
import sqlJson from "./email-sql.json" with { type: "json" };
import { httpsUrl, type HttpFetch } from "./providers.js";
interface ProcessingEmail {
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
const queries: Record<string, Record<string, string>> = sqlJson;
export const emailTypes = [
  "EMAIL_VERIFICATION",
  "WELCOME_EMAIL",
  "PASSWORD_RESET",
  "USER_INACTIVE",
] as const;
type EmailType = (typeof emailTypes)[number];
export class EmailFailure extends Error {
  constructor(
    code: string,
    readonly permanent: boolean,
  ) {
    super(code);
  }
}
export function namedSql(sql: string, params: Record<string, unknown>) {
  const keys: string[] = [];
  const text = sql.replace(/@(\w+)/g, (_, name: string) => {
    if (!(name in params)) throw new Error("Parâmetro ausente: " + name);
    if (!keys.includes(name)) keys.push(name);
    return "$" + (keys.indexOf(name) + 1);
  });
  return { text, values: keys.map((k) => params[k]) };
}
const htmlEscape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export class Emails {
  constructor(
    readonly db: Database,
    readonly config: Config,
    readonly http: HttpFetch = fetch,
  ) {}
  get available() {
    return (
      !!this.config.email.key &&
      !!this.config.email.from &&
      this.config.auth.key.length >= 64
    );
  }
  require() {
    if (!this.available)
      throw new ServiceError(
        "O envio de e-mails ainda não está disponível. Entre em contato com o suporte.",
        503,
      );
  }
  async enabled(type: string) {
    if (!emailTypes.includes(type as EmailType)) return false;
    const result = await this.db.query<{ habilitado: boolean }>(
      "select habilitado from comunicacao.workflows where tipo_evento=$1",
      [type],
    );
    return (
      result.rows[0]?.habilitado ??
      this.config.email.workflows[type as EmailType]
    );
  }
  async workflows(): Promise<M.FluxoEmailResponseModel[]> {
    const rows = (
      await this.db.query<{
        tipo_evento: string;
        habilitado: boolean;
        atualizado_em: Date;
      }>(
        "select tipo_evento,habilitado,atualizado_em from comunicacao.workflows",
      )
    ).rows;
    return emailTypes.map((type) => {
      const row = rows.find((x) => x.tipo_evento === type);
      return {
        tipoEvento: type,
        habilitado: row?.habilitado ?? this.config.email.workflows[type],
        dataHoraAtualizacao: row?.atualizado_em.toISOString() ?? null,
      };
    });
  }
  async workflow(
    type: string,
    enabled: boolean,
  ): Promise<M.FluxoEmailResponseModel> {
    const row = (
      await this.db.query<{ atualizado_em: Date }>(
        "insert into comunicacao.workflows(tipo_evento,habilitado,atualizado_em) values($1,$2,now()) on conflict(tipo_evento) do update set habilitado=excluded.habilitado,atualizado_em=now() returning atualizado_em",
        [type, enabled],
      )
    ).rows[0]!;
    return {
      tipoEvento: type,
      habilitado: enabled,
      dataHoraAtualizacao: row.atualizado_em.toISOString(),
    };
  }
  prepare(
    userId: string,
    to: string,
    name: string,
    purpose: string,
    link: string,
  ): PendingEmail {
    this.require();
    const type =
        purpose === "confirmacao" ? "EMAIL_VERIFICATION" : "PASSWORD_RESET",
      id = randomUUID();
    return {
      id,
      type,
      userId,
      to,
      subject:
        type === "EMAIL_VERIFICATION"
          ? "Confirme seu e-mail — ConcursaAI"
          : "Recupere seu acesso — ConcursaAI",
      template: JSON.stringify({ nome: name.slice(0, 200) }),
      link: encrypt(link, this.config.auth.key),
      attempts: this.config.email.attempts,
      idempotency: type + "/" + id,
    };
  }
  async sql(
    method: string,
    variable: string,
    params: Record<string, unknown> = {},
    client?: PoolClient,
  ) {
    const sql = queries[method]?.[variable];
    if (!sql)
      throw new Error(
        "Consulta de email desconhecida: " + method + "." + variable,
      );
    const q = namedSql(sql, params);
    return client ? client.query(q) : this.db.query(q.text, q.values);
  }
  async preference(id: string) {
    return (
      await this.db.query<{ value: boolean }>(
        'select coalesce((select receber_inatividade from comunicacao.preferencias where "idUsuario"=$1),false) as value',
        [id],
      )
    ).rows[0]!.value;
  }
  async setPreference(id: string, receive: boolean) {
    await this.db.transaction(async (c) => {
      await c.query(
        'insert into comunicacao.preferencias("idUsuario",receber_inatividade,atualizado_em) values($1,$2,now()) on conflict("idUsuario") do update set receber_inatividade=excluded.receber_inatividade,atualizado_em=now()',
        [id, receive],
      );
      if (!receive)
        await c.query(
          `update comunicacao.emails_transacionais set status='cancelado',identificador_processamento=null,expiracao_reserva_em=null where "idUsuario"=$1 and tipo_evento='USER_INACTIVE' and status in ('pendente','processando')`,
          [id],
        );
    });
  }
  async history(q: M.ListarEmailsTransacionaisRequestModel) {
    const where = `from comunicacao.emails_transacionais where ($1::uuid is null or "idUsuario"=$1) and ($2::text is null or tipo_evento=$2) and ($3::text is null or status=$3) and ($4::timestamptz is null or criado_em>=$4) and ($5::timestamptz is null or criado_em<=$5)`;
    const values = [q.idUsuario, q.tipoEvento, q.status, q.de, q.ate];
    const total = Number(
      (
        await this.db.query<{ total: string }>(
          "select count(*) as total " + where,
          values,
        )
      ).rows[0]!.total,
    );
    const rows = (
      await this.db.query(
        `select "idEmailTransacional","idUsuario",tipo_evento,email_destinatario,status,quantidade_tentativas,maximo_tentativas,criado_em,enviado_em,entregue_em,mensagem_erro ${where} order by criado_em desc,"idEmailTransacional" desc limit $6 offset $7`,
        [...values, q.quantidade, (q.pagina - 1) * q.quantidade],
      )
    ).rows;
    const itens: M.EmailTransacionalResponseModel[] = rows.map((x) => ({
      idEmailTransacional: x.idEmailTransacional as string,
      idUsuario: x.idUsuario as string | null,
      tipoEvento: x.tipo_evento as string,
      emailDestinatario: x.email_destinatario as string,
      status: x.status as string,
      quantidadeTentativas: x.quantidade_tentativas as number,
      maximoTentativas: x.maximo_tentativas as number,
      dataHoraCriacao: (x.criado_em as Date).toISOString(),
      dataHoraEnvio: (x.enviado_em as Date | null)?.toISOString() ?? null,
      dataHoraEntrega: (x.entregue_em as Date | null)?.toISOString() ?? null,
      codigoErro: x.mensagem_erro as string | null,
    }));
    return { itens, total, pagina: q.pagina };
  }
  async metrics(): Promise<M.MetricasEmailsResponseModel> {
    const r = (
      await this.db.query<Record<string, string>>(
        `select count(*) filter(where status='pendente') as pendentes,count(*) filter(where status='processando') as processando,count(*) filter(where status='aceito') as aceitos,count(*) filter(where status='entregue') as entregues,count(*) filter(where status='falha') as falhas,count(*) filter(where status='bounce') as bounces from comunicacao.emails_transacionais`,
      )
    ).rows[0]!;
    return {
      pendentes: Number(r.pendentes),
      processando: Number(r.processando),
      aceitos: Number(r.aceitos),
      entregues: Number(r.entregues),
      falhas: Number(r.falhas),
      bounces: Number(r.bounces),
    };
  }
  async reprocess(id: string) {
    return (
      (await this.sql("ReprocessarFalhaAsync", "comando", { id })).rowCount ===
      1
    );
  }
  verifyWebhook(
    id: string,
    timestamp: string,
    signatures: string,
    body: Buffer,
  ) {
    const secret = this.config.email.webhookSecret;
    if (
      !secret.startsWith("whsec_") ||
      !/^\d+$/.test(timestamp) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
      !id ||
      id.length > 200 ||
      body.length > 65536
    )
      return false;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(secret.slice(6))) return false;
    const expected = createHmac(
      "sha256",
      Buffer.from(secret.slice(6), "base64"),
    )
      .update(id + "." + timestamp + ".")
      .update(body)
      .digest();
    return signatures.split(" ").some((s) => {
      if (!s.startsWith("v1,")) return false;
      const actual = Buffer.from(s.slice(3), "base64");
      return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
      );
    });
  }
  async event(webhook: string, id: string, event: string) {
    if (
      ![
        "email.delivered",
        "email.bounced",
        "email.complained",
        "email.failed",
      ].includes(event) ||
      webhook.length > 200 ||
      id.length > 200
    )
      return;
    await this.db.transaction(async (c) => {
      await this.sql(
        "RegistrarEventoProvedorAsync",
        "comando",
        { webhook, id, evento: event },
        c,
      );
      await this.sql("AplicarEventosRecebidosAsync", "comando", { id }, c);
    });
  }
  async reserve(): Promise<ProcessingEmail[]> {
    const types = (await this.workflows())
      .filter((x) => x.habilitado)
      .map((x) => x.tipoEvento);
    if (!types.length) return [];
    await this.sql("ReservarLoteAsync", "encerrar");
    return (
      await this.sql("ReservarLoteAsync", "comando", {
        limite: this.config.email.batch,
        tipos: types,
        reserva: randomUUID(),
        segundos: this.config.email.reservation,
      })
    ).rows as ProcessingEmail[];
  }
  async canSend(email: ProcessingEmail) {
    if (
      email.validade_link_em &&
      email.validade_link_em.getTime() <= Date.now()
    )
      return false;
    const params = {
      id: email.idEmailTransacional,
      reserva: email.identificador_processamento,
    };
    if (
      !Object.values(
        (await this.sql("PodeEnviarAsync", "reserva", params)).rows[0] ?? {},
      )[0]
    )
      return false;
    if (email.tipo_evento === "USER_INACTIVE")
      return !!Object.values(
        (
          await this.sql("PodeEnviarAsync", "preferencia", {
            id: email.idUsuario,
            email: email.idEmailTransacional,
          })
        ).rows[0] ?? {},
      )[0];
    if (!email.link_protegido) return true;
    const url = new URL(decrypt(email.link_protegido, this.config.auth.key)),
      token = new URLSearchParams(url.hash.slice(1)).get("token");
    if (!token) return false;
    return !!Object.values(
      (
        await this.sql("PodeEnviarAsync", "validar", {
          hash: tokenHash(token),
          id: email.idUsuario,
          finalidade:
            email.tipo_evento === "EMAIL_VERIFICATION"
              ? "confirmacao"
              : "recuperacao",
        })
      ).rows[0] ?? {},
    )[0];
  }
  render(email: ProcessingEmail) {
    const data = JSON.parse(email.dados_template) as { nome?: string },
      name = data.nome ?? "";
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
    };
    const action = actions[email.tipo_evento];
    if (!action) throw new Error("Tipo de e-mail não reconhecido.");
    const origin = new URL(this.config.auth.clientUrl);
    const link = email.link_protegido
      ? decrypt(email.link_protegido, this.config.auth.key)
      : this.config.auth.clientUrl.replace(/\/+$/, "") +
        (email.tipo_evento === "USER_INACTIVE" ? "/minha-conta" : "/entrar");
    const destination = new URL(link);
    if (
      email.link_protegido &&
      (destination.origin !== origin.origin ||
        !destination.pathname.startsWith("/autenticacao/"))
    )
      throw new Error("Link do e-mail fora da origem configurada.");
    const [title, description, button] = action.map(htmlEscape),
      safeLink = htmlEscape(link),
      greeting = name.trim() ? `Olá, ${htmlEscape(name)}!` : "Olá!";
    const notice = ["EMAIL_VERIFICATION", "PASSWORD_RESET"].includes(
      email.tipo_evento,
    )
      ? '<p style="color:#64748b;font-size:13px">Se você não solicitou este e-mail, pode ignorá-lo.</p>'
      : "";
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f7ff;font-family:Arial,sans-serif;color:#18213e"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="100%" style="max-width:560px;background:white;border-radius:20px"><tr><td style="padding:32px"><p style="color:#4034a5;font-weight:700">${htmlEscape(this.config.email.appName)}</p><h1 style="font-size:27px">${title}</h1><p>${greeting}</p><p>${description}</p><p style="margin:32px 0"><a href="${safeLink}" style="background:#28216d;color:white;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:700">${button}</a></p><p style="font-size:13px;overflow-wrap:anywhere">Se o botão não abrir, use este endereço:<br><a href="${safeLink}">${safeLink}</a></p>${notice}${email.tipo_evento === "USER_INACTIVE" ? '<p style="font-size:13px">Você pode desativar estes lembretes em Minha conta.</p>' : ""}</td></tr></table></td></tr></table></body></html>`;
    return {
      html,
      text: `${name},\n\n${action[1]}\n\n${link}\n\n${email.tipo_evento === "USER_INACTIVE" ? "Desative estes lembretes em Minha conta." : "Se não solicitou este e-mail, ignore-o."}\n\n${this.config.email.appName}`,
    };
  }
  async send(email: ProcessingEmail, signal?: AbortSignal) {
    const o = this.config.email;
    if (!o.key || !o.from)
      throw new EmailFailure("provedor_nao_configurado", false);
    if (!httpsUrl(o.url))
      throw new EmailFailure("provedor_nao_configurado", true);
    const content = this.render(email);
    try {
      const response = await this.http(new URL("emails", o.url), {
        method: "POST",
        headers: {
          Authorization: "Bearer " + o.key,
          "Idempotency-Key": email.chave_idempotencia,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${o.fromName} <${o.from}>`,
          to: [email.email_destinatario],
          subject: email.assunto,
          ...content,
        }),
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
      });
      if (!response.ok)
        throw new EmailFailure(
          "resend_http_" + response.status,
          response.status >= 400 &&
            response.status < 500 &&
            ![408, 429].includes(response.status),
        );
      const body = (await response.json()) as { id?: string };
      if (!body.id) throw new EmailFailure("resend_resposta_ambigua", false);
      return body.id;
    } catch (e) {
      if (e instanceof EmailFailure) throw e;
      if (signal?.aborted) throw e;
      throw new EmailFailure(
        e instanceof SyntaxError
          ? "resend_resposta_ambigua"
          : e instanceof Error && e.name === "TimeoutError"
            ? "resend_timeout"
            : "resend_conexao",
        false,
      );
    }
  }
  async process(email: ProcessingEmail, logger: Logger, signal: AbortSignal) {
    const params = {
      id: email.idEmailTransacional,
      reserva: email.identificador_processamento,
    };
    try {
      if (!(await this.enabled(email.tipo_evento))) {
        await this.sql("DevolverAguardandoAtivacaoAsync", "comando", params);
        return;
      }
      if (!(await this.canSend(email))) {
        await this.sql("CancelarAsync", "comando", {
          ...params,
          motivo: "link_expirado_ou_preferencia_desativada",
        });
        return;
      }
      const id = await this.send(email, signal);
      await this.db.transaction(async (c) => {
        const result = await this.sql(
          "MarcarAceitoAsync",
          "comando",
          { ...params, provedor: id },
          c,
        );
        if (result.rowCount === 1)
          await this.sql("AplicarEventosRecebidosAsync", "comando", { id }, c);
      });
      logger.info(
        { emailId: email.idEmailTransacional, type: email.tipo_evento },
        "Email aceito pelo provedor",
      );
    } catch (error) {
      if (signal.aborted) return;
      const permanent = error instanceof EmailFailure && error.permanent,
        definitive =
          permanent || email.quantidade_tentativas >= email.maximo_tentativas,
        code =
          error instanceof EmailFailure
            ? error.message
            : "processamento_interno";
      const base = this.config.email.retryBase,
        max = Math.max(base, this.config.email.retryMax),
        seconds = Math.min(
          max,
          base * 2 ** Math.min(email.quantidade_tentativas - 1, 16),
        );
      await this.sql("MarcarFalhaAsync", "comando", {
        ...params,
        status: definitive ? "falha" : "pendente",
        proxima: definitive
          ? null
          : new Date(
              Date.now() +
                1000 * (seconds + Math.random() * Math.min(30, seconds * 0.25)),
            ),
        erro: code.slice(0, 100),
        definitiva: definitive,
      });
      logger.warn(
        { emailId: email.idEmailTransacional, code },
        "Falha no processamento de email",
      );
    }
  }
  async cycle(logger: Logger, signal: AbortSignal, maintenance: boolean) {
    if (maintenance) {
      await this.sql("LimparHistoricoAsync", "emails", {
        dias: this.config.email.retention,
      });
      await this.sql("LimparHistoricoAsync", "eventos", {
        dias: this.config.email.retention,
      });
      if (
        (await this.enabled("USER_INACTIVE")) &&
        this.config.email.inactivityDays.length
      )
        await this.sql("EnfileirarInativosAsync", "comando", {
          dias: [...new Set(this.config.email.inactivityDays)].sort(
            (a, b) => a - b,
          ),
          maximo: this.config.email.attempts,
          limite: this.config.email.batch,
        });
    }
    if (this.config.email.key && this.config.email.from)
      for (const email of await this.reserve()) {
        if (signal.aborted) break;
        await this.process(email, logger, signal);
      }
  }
}
export function startEmailWorker(emails: Emails, logger: Logger) {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined,
    lastMaintenance = 0,
    inflight: Promise<void> = Promise.resolve();
  const tick = () => {
    inflight = (async () => {
      try {
        const maintenance = Date.now() - lastMaintenance >= 3600000;
        await emails.cycle(logger, controller.signal, maintenance);
        if (maintenance) lastMaintenance = Date.now();
      } catch {
        logger.error("Falha no ciclo do worker de emails");
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(tick, emails.config.email.interval * 1000);
      }
    })();
  };
  tick();
  return async () => {
    controller.abort();
    if (timer) clearTimeout(timer);
    await inflight;
  };
}
