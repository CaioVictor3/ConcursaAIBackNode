import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { Database } from "./database.js";
import { project } from "../contracts/codec.js";
import type { UsuarioResponseModel } from "../contracts/models.js";
import { ServiceError } from "../domain/errors.js";
export interface Account {
  idUsuario: string;
  email_normalizado: string;
  senha_hash: string | null;
  formato_senha: string | null;
  email_confirmado_em: string | null;
  versao_credenciais: number;
  bloqueado_ate: string | null;
  perfil: Record<string, unknown>;
}
export interface Session {
  idSessao: string;
  idUsuario: string;
  expira_em: Date | string;
}
export interface PendingEmail {
  id: string;
  type: string;
  userId: string;
  to: string;
  subject: string;
  template: string;
  link: string;
  attempts: number;
  idempotency: string;
}
const accountSql = `select to_jsonb(c)||jsonb_build_object('perfil',to_jsonb(u)) as value from identidade.contas c join public.usuarios u using("idUsuario") where `;
export const profile = (account: Account): UsuarioResponseModel =>
  project("UsuarioResponseModel", account.perfil);
export class Accounts {
  constructor(readonly db: Database) {}
  async get(
    mode: "email" | "id" | "google",
    value: string,
  ): Promise<Account | null> {
    const where =
      mode === "email"
        ? "c.email_normalizado=$1"
        : mode === "id"
          ? 'c."idUsuario"=$1'
          : `c."idUsuario"=(select "idUsuario" from identidade.identidades_externas where provedor='google' and sujeito=$1)`;
    return (
      (await this.db.query<{ value: Account }>(accountSql + where, [value]))
        .rows[0]?.value ?? null
    );
  }
  async create(
    id: string,
    email: string,
    hash: string | null,
    confirmed: string | null,
    person: unknown,
    complete: boolean,
    googleSub?: string,
  ) {
    await this.db.transaction(async (c) => {
      await c.query(
        "select identidade.criar_conta($1::uuid,$2::text,$3::text,$4::text,$5::timestamptz,$6::jsonb,$7::boolean)",
        [
          id,
          email,
          hash,
          hash ? "aspnet" : null,
          confirmed,
          JSON.stringify(person),
          complete,
        ],
      );
      if (googleSub) await this.linkGoogle(id, googleSub, email, c);
    });
  }
  async linkGoogle(id: string, sub: string, email: string, c?: PoolClient) {
    const sql = `insert into identidade.identidades_externas(provedor,sujeito,"idUsuario",email_verificado) values('google',$1,$2,$3) on conflict(provedor,sujeito) do update set email_verificado=excluded.email_verificado where identidade.identidades_externas."idUsuario"=excluded."idUsuario" returning "idUsuario"`;
    const r = c
      ? await c.query(sql, [sub, id, email])
      : await this.db.query(sql, [sub, id, email]);
    if (!r.rowCount)
      throw new ServiceError(
        "Essa conta Google já está vinculada a outra conta.",
        409,
      );
  }
  async googleLinked(id: string) {
    return (
      await this.db.query<{ value: boolean }>(
        `select exists(select 1 from identidade.identidades_externas where "idUsuario"=$1 and provedor='google') as value`,
        [id],
      )
    ).rows[0]!.value;
  }
  async failedPassword(id: string) {
    await this.db.query(
      `update identidade.contas set falhas_senha=case when bloqueado_ate<now() then 1 else falhas_senha+1 end,bloqueado_ate=case when falhas_senha>=4 and (bloqueado_ate is null or bloqueado_ate>now()) then now()+interval '10 minutes' else null end where "idUsuario"=$1`,
      [id],
    );
  }
  async rehash(id: string, previous: string, next: string) {
    return (
      (
        await this.db.query(
          `update identidade.contas set senha_hash=$1,formato_senha='aspnet',atualizado_em=now() where "idUsuario"=$2 and senha_hash=$3`,
          [next, id, previous],
        )
      ).rowCount === 1
    );
  }
  async createSession(s: Session, hash: string, version: number) {
    return this.db.transaction(async (c) => {
      const r = await c.query(
        `insert into identidade.sessoes("idSessao","idUsuario",refresh_hash,expira_em) select $1,c."idUsuario",$2,$3 from identidade.contas c join public.usuarios u using("idUsuario") where c."idUsuario"=$4 and c.versao_credenciais=$5 and c.email_confirmado_em is not null and u.estado_cadastro='ativo' returning "idSessao"`,
        [s.idSessao, hash, s.expira_em, s.idUsuario, version],
      );
      if (!r.rowCount) return false;
      await c.query(
        'update identidade.contas set falhas_senha=0,bloqueado_ate=null where "idUsuario"=$1',
        [s.idUsuario],
      );
      await c.query(
        'update public.usuarios set ultimo_acesso_em=now() where "idUsuario"=$1',
        [s.idUsuario],
      );
      return true;
    });
  }
  async validSession(id: string, user: string) {
    return (
      await this.db.query<{ value: boolean }>(
        `select exists(select 1 from identidade.sessoes s join public.usuarios u using("idUsuario") where s."idSessao"=$1 and s."idUsuario"=$2 and s.revogada_em is null and s.expira_em>now() and u.estado_cadastro='ativo') as value`,
        [id, user],
      )
    ).rows[0]!.value;
  }
  async refresh(old: string, next: string): Promise<Session | null> {
    return this.db.transaction(async (c) => {
      const s = (
        await c.query<Session>(
          'select "idSessao","idUsuario",expira_em from identidade.sessoes where refresh_hash=$1 and revogada_em is null and expira_em>now() for update',
          [old],
        )
      ).rows[0];
      if (!s) {
        await c.query(
          'update identidade.sessoes set revogada_em=now() where "idSessao"=(select "idSessao" from identidade.renovacoes_usadas where refresh_hash=$1) and revogada_em is null',
          [old],
        );
        return null;
      }
      await c.query(
        'insert into identidade.renovacoes_usadas(refresh_hash,"idSessao") values($1,$2)',
        [old, s.idSessao],
      );
      await c.query(
        'update identidade.sessoes set refresh_hash=$1,renovada_em=now() where "idSessao"=$2',
        [next, s.idSessao],
      );
      return s;
    });
  }
  async revoke(user: string, session: string) {
    await this.db.query(
      'update identidade.sessoes set revogada_em=now() where "idUsuario"=$1 and "idSessao"=$2 and revogada_em is null',
      [user, session],
    );
  }
  private async changePassword(
    c: PoolClient,
    id: string,
    hash: string,
    preserve: string | null,
  ) {
    await c.query(
      `update identidade.contas set senha_hash=$1,formato_senha='aspnet',versao_credenciais=versao_credenciais+1,falhas_senha=0,bloqueado_ate=null,atualizado_em=now() where "idUsuario"=$2`,
      [hash, id],
    );
    await c.query(
      'update identidade.sessoes set revogada_em=now() where "idUsuario"=$1 and ($2::uuid is null or "idSessao"<>$2) and revogada_em is null',
      [id, preserve],
    );
    await c.query(
      'update identidade.tokens_email set usado_em=now() where "idUsuario"=$1 and usado_em is null',
      [id],
    );
  }
  async password(id: string, hash: string, preserve: string | null) {
    await this.db.transaction((c) =>
      this.changePassword(c, id, hash, preserve),
    );
  }
  private async cancelEmails(c: PoolClient, id: string, type: string) {
    await c.query(
      `update comunicacao.emails_transacionais set status='cancelado',link_protegido=null,identificador_processamento=null,expiracao_reserva_em=null where "idUsuario"=$1 and tipo_evento=$2 and status in ('pendente','processando')`,
      [id, type],
    );
  }
  async emailToken(
    id: string,
    purpose: string,
    hash: string,
    expires: Date,
    email?: PendingEmail,
  ) {
    return this.db.transaction(async (c) => {
      await c.query(
        'select "idUsuario" from identidade.contas where "idUsuario"=$1 for update',
        [id],
      );
      const recent = await c.query<{ value: boolean }>(
        `select exists(select 1 from identidade.tokens_email where "idUsuario"=$1 and finalidade=$2 and criado_em>now()-interval '1 minute') as value`,
        [id, purpose],
      );
      if (recent.rows[0]!.value) return false;
      await c.query(
        'update identidade.tokens_email set usado_em=now() where "idUsuario"=$1 and finalidade=$2 and usado_em is null',
        [id, purpose],
      );
      await c.query(
        'insert into identidade.tokens_email(token_hash,"idUsuario",finalidade,email_normalizado,expira_em) select $1,"idUsuario",$2,email_normalizado,$3 from identidade.contas where "idUsuario"=$4',
        [hash, purpose, expires, id],
      );
      if (email) {
        await this.cancelEmails(c, id, email.type);
        await c.query(
          'insert into comunicacao.emails_transacionais("idEmailTransacional",tipo_evento,"idUsuario",email_destinatario,assunto,dados_template,link_protegido,validade_link_em,maximo_tentativas,chave_idempotencia,agendado_em) values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,now())',
          [
            email.id,
            email.type,
            id,
            email.to,
            email.subject,
            email.template,
            email.link,
            expires,
            email.attempts,
            email.idempotency,
          ],
        );
      }
      return true;
    });
  }
  async consumeEmail(
    hash: string,
    purpose: string,
    newHash: string | null,
    welcome = false,
  ) {
    return this.db.transaction(async (c) => {
      const id = (
        await c.query<{ idUsuario: string }>(
          `select t."idUsuario" from identidade.tokens_email t join identidade.contas c using("idUsuario") where t.token_hash=$1 and t.finalidade=$2 and t.usado_em is null and t.expira_em>now() and t.email_normalizado=c.email_normalizado for update of t,c`,
          [hash, purpose],
        )
      ).rows[0]?.idUsuario;
      if (!id) return false;
      await c.query(
        "update identidade.tokens_email set usado_em=now() where token_hash=$1",
        [hash],
      );
      if (purpose === "confirmacao") {
        await c.query(
          'update identidade.contas set email_confirmado_em=coalesce(email_confirmado_em,now()) where "idUsuario"=$1',
          [id],
        );
        await c.query(
          "update public.usuarios set estado_cadastro='ativo',atualizado_em=now() where \"idUsuario\"=$1",
          [id],
        );
        if (welcome)
          await c.query(
            `insert into comunicacao.emails_transacionais("idEmailTransacional",tipo_evento,"idUsuario",email_destinatario,assunto,dados_template,maximo_tentativas,chave_idempotencia,agendado_em) select $1,'WELCOME_EMAIL',u."idUsuario",u.email,'Boas-vindas ao ConcursaAI',jsonb_build_object('nome',u.nome_completo),$2,'WELCOME_EMAIL/'||u."idUsuario"::text,now() from public.usuarios u where u."idUsuario"=$3 on conflict(chave_idempotencia) do nothing`,
            [randomUUID(), this.db.config.email.attempts, id],
          );
      } else if (newHash) await this.changePassword(c, id, newHash, null);
      else return false;
      await this.cancelEmails(
        c,
        id,
        purpose === "confirmacao" ? "EMAIL_VERIFICATION" : "PASSWORD_RESET",
      );
      return true;
    });
  }
}
