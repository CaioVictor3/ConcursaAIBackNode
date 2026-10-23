import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { UsuarioResponseModel } from "../contracts/modelos-requisicoes-respostas-api.js";
import { projetarRespostaPeloContrato } from "../contracts/validacao-conversao-contratos-api.js";
import { ErroRegraNegocioHttp } from "../domain/erros-validacoes-respostas-api.js";
import { ConexaoTransacoesPostgreSql } from "./conexao-transacoes-postgresql.js";

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

export const projetarPerfilUsuario = (account: Account): UsuarioResponseModel =>
  projetarRespostaPeloContrato("UsuarioResponseModel", account.perfil);

export class RepositorioContasSessoesPostgreSql {
  constructor(readonly conexaoPostgreSql: ConexaoTransacoesPostgreSql) {}

  async buscarContaPorIdentificador(
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
      (
        await this.conexaoPostgreSql.executarConsultaSqlParametrizada<{ value: Account }>(
          accountSql + where,
          [value],
        )
      ).rows[0]?.value ?? null
    );
  }

  async criarContaUsuario(
    identificadorUsuario: string,
    email: string,
    hash: string | null,
    confirmed: string | null,
    person: unknown,
    complete: boolean,
    googleSub?: string,
  ) {
    await this.conexaoPostgreSql.executarTransacao(async (clienteTransacaoPostgreSql) => {
      await clienteTransacaoPostgreSql.query(
        "select identidade.criar_conta($1::uuid,$2::text,$3::text,$4::text,$5::timestamptz,$6::jsonb,$7::boolean)",
        [
          identificadorUsuario,
          email,
          hash,
          hash ? "aspnet" : null,
          confirmed,
          JSON.stringify(person),
          complete,
        ],
      );

      if (googleSub) {
        await this.vincularIdentidadeGoogle(
          identificadorUsuario,
          googleSub,
          email,
          clienteTransacaoPostgreSql,
        );
      }
    });
  }

  async vincularIdentidadeGoogle(
    identificadorUsuario: string,
    sub: string,
    email: string,
    clienteTransacaoPostgreSql?: PoolClient,
  ) {
    const sql = `insert into identidade.identidades_externas(provedor,sujeito,"idUsuario",email_verificado) values('google',$1,$2,$3) on conflict(provedor,sujeito) do update set email_verificado=excluded.email_verificado where identidade.identidades_externas."idUsuario"=excluded."idUsuario" returning "idUsuario"`;

    const resultadoConsultaPostgreSql = clienteTransacaoPostgreSql
      ? await clienteTransacaoPostgreSql.query(sql, [sub, identificadorUsuario, email])
      : await this.conexaoPostgreSql.executarConsultaSqlParametrizada(sql, [
          sub,
          identificadorUsuario,
          email,
        ]);

    if (!resultadoConsultaPostgreSql.rowCount) {
      throw new ErroRegraNegocioHttp("Essa conta Google já está vinculada a outra conta.", 409);
    }
  }

  async possuiVinculoGoogle(identificadorUsuario: string) {
    return (
      await this.conexaoPostgreSql.executarConsultaSqlParametrizada<{ value: boolean }>(
        `select exists(select 1 from identidade.identidades_externas where "idUsuario"=$1 and provedor='google') as value`,
        [identificadorUsuario],
      )
    ).rows[0]!.value;
  }

  async registrarSenhaIncorreta(identificadorUsuario: string) {
    await this.conexaoPostgreSql.executarConsultaSqlParametrizada(
      `update identidade.contas set falhas_senha=case when bloqueado_ate<now() then 1 else falhas_senha+1 end,bloqueado_ate=case when falhas_senha>=4 and (bloqueado_ate is null or bloqueado_ate>now()) then now()+interval '10 minutes' else null end where "idUsuario"=$1`,
      [identificadorUsuario],
    );
  }

  async atualizarHashSenhaLegada(identificadorUsuario: string, previous: string, next: string) {
    return (
      (
        await this.conexaoPostgreSql.executarConsultaSqlParametrizada(
          `update identidade.contas set senha_hash=$1,formato_senha='aspnet',atualizado_em=now() where "idUsuario"=$2 and senha_hash=$3`,
          [next, identificadorUsuario, previous],
        )
      ).rowCount === 1
    );
  }

  async criarSessaoPersistida(sessaoAutenticada: Session, hash: string, version: number) {
    return this.conexaoPostgreSql.executarTransacao(async (clienteTransacaoPostgreSql) => {
      const resultadoConsultaPostgreSql = await clienteTransacaoPostgreSql.query(
        `insert into identidade.sessoes("idSessao","idUsuario",refresh_hash,expira_em) select $1,c."idUsuario",$2,$3 from identidade.contas c join public.usuarios u using("idUsuario") where c."idUsuario"=$4 and c.versao_credenciais=$5 and c.email_confirmado_em is not null and u.estado_cadastro='ativo' returning "idSessao"`,
        [
          sessaoAutenticada.idSessao,
          hash,
          sessaoAutenticada.expira_em,
          sessaoAutenticada.idUsuario,
          version,
        ],
      );

      if (!resultadoConsultaPostgreSql.rowCount) {
        return false;
      }

      await clienteTransacaoPostgreSql.query(
        'update identidade.contas set falhas_senha=0,bloqueado_ate=null where "idUsuario"=$1',
        [sessaoAutenticada.idUsuario],
      );

      await clienteTransacaoPostgreSql.query(
        'update public.usuarios set ultimo_acesso_em=now() where "idUsuario"=$1',
        [sessaoAutenticada.idUsuario],
      );

      return true;
    });
  }

  async validarSessaoPersistida(identificadorUsuario: string, user: string) {
    return (
      await this.conexaoPostgreSql.executarConsultaSqlParametrizada<{ value: boolean }>(
        `select exists(select 1 from identidade.sessoes s join public.usuarios u using("idUsuario") where s."idSessao"=$1 and s."idUsuario"=$2 and s.revogada_em is null and s.expira_em>now() and u.estado_cadastro='ativo') as value`,
        [identificadorUsuario, user],
      )
    ).rows[0]!.value;
  }

  async renovarSessaoPersistida(registroAnterior: string, next: string): Promise<Session | null> {
    return this.conexaoPostgreSql.executarTransacao(async (clienteTransacaoPostgreSql) => {
      const sessaoAutenticada = (
        await clienteTransacaoPostgreSql.query<Session>(
          'select "idSessao","idUsuario",expira_em from identidade.sessoes where refresh_hash=$1 and revogada_em is null and expira_em>now() for update',
          [registroAnterior],
        )
      ).rows[0];

      if (!sessaoAutenticada) {
        await clienteTransacaoPostgreSql.query(
          'update identidade.sessoes set revogada_em=now() where "idSessao"=(select "idSessao" from identidade.renovacoes_usadas where refresh_hash=$1) and revogada_em is null',
          [registroAnterior],
        );

        return null;
      }

      await clienteTransacaoPostgreSql.query(
        'insert into identidade.renovacoes_usadas(refresh_hash,"idSessao") values($1,$2)',
        [registroAnterior, sessaoAutenticada.idSessao],
      );

      await clienteTransacaoPostgreSql.query(
        'update identidade.sessoes set refresh_hash=$1,renovada_em=now() where "idSessao"=$2',
        [next, sessaoAutenticada.idSessao],
      );

      return sessaoAutenticada;
    });
  }

  async revogarSessaoPersistida(user: string, session: string) {
    await this.conexaoPostgreSql.executarConsultaSqlParametrizada(
      'update identidade.sessoes set revogada_em=now() where "idUsuario"=$1 and "idSessao"=$2 and revogada_em is null',
      [user, session],
    );
  }

  private async changePassword(
    clienteTransacaoPostgreSql: PoolClient,
    identificadorUsuario: string,
    hash: string,
    preserve: string | null,
  ) {
    await clienteTransacaoPostgreSql.query(
      `update identidade.contas set senha_hash=$1,formato_senha='aspnet',versao_credenciais=versao_credenciais+1,falhas_senha=0,bloqueado_ate=null,atualizado_em=now() where "idUsuario"=$2`,
      [hash, identificadorUsuario],
    );

    await clienteTransacaoPostgreSql.query(
      'update identidade.sessoes set revogada_em=now() where "idUsuario"=$1 and ($2::uuid is null or "idSessao"<>$2) and revogada_em is null',
      [identificadorUsuario, preserve],
    );

    await clienteTransacaoPostgreSql.query(
      'update identidade.tokens_email set usado_em=now() where "idUsuario"=$1 and usado_em is null',
      [identificadorUsuario],
    );
  }

  async atualizarSenhaUsuario(identificadorUsuario: string, hash: string, preserve: string | null) {
    await this.conexaoPostgreSql.executarTransacao((clienteTransacaoPostgreSql) =>
      this.changePassword(clienteTransacaoPostgreSql, identificadorUsuario, hash, preserve),
    );
  }

  private async cancelEmails(
    clienteTransacaoPostgreSql: PoolClient,
    identificadorUsuario: string,
    type: string,
  ) {
    await clienteTransacaoPostgreSql.query(
      `update comunicacao.emails_transacionais set status='cancelado',link_protegido=null,identificador_processamento=null,expiracao_reserva_em=null where "idUsuario"=$1 and tipo_evento=$2 and status in ('pendente','processando')`,
      [identificadorUsuario, type],
    );
  }

  async registrarTokenEmail(
    identificadorUsuario: string,
    purpose: string,
    hash: string,
    expires: Date,
    email?: PendingEmail,
  ) {
    return this.conexaoPostgreSql.executarTransacao(async (clienteTransacaoPostgreSql) => {
      await clienteTransacaoPostgreSql.query(
        'select "idUsuario" from identidade.contas where "idUsuario"=$1 for update',
        [identificadorUsuario],
      );

      const recent = await clienteTransacaoPostgreSql.query<{ value: boolean }>(
        `select exists(select 1 from identidade.tokens_email where "idUsuario"=$1 and finalidade=$2 and criado_em>now()-interval '1 minute') as value`,
        [identificadorUsuario, purpose],
      );

      if (recent.rows[0]!.value) {
        return false;
      }

      await clienteTransacaoPostgreSql.query(
        'update identidade.tokens_email set usado_em=now() where "idUsuario"=$1 and finalidade=$2 and usado_em is null',
        [identificadorUsuario, purpose],
      );

      await clienteTransacaoPostgreSql.query(
        'insert into identidade.tokens_email(token_hash,"idUsuario",finalidade,email_normalizado,expira_em) select $1,"idUsuario",$2,email_normalizado,$3 from identidade.contas where "idUsuario"=$4',
        [hash, purpose, expires, identificadorUsuario],
      );

      if (email) {
        await this.cancelEmails(clienteTransacaoPostgreSql, identificadorUsuario, email.type);

        await clienteTransacaoPostgreSql.query(
          'insert into comunicacao.emails_transacionais("idEmailTransacional",tipo_evento,"idUsuario",email_destinatario,assunto,dados_template,link_protegido,validade_link_em,maximo_tentativas,chave_idempotencia,agendado_em) values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,now())',
          [
            email.id,
            email.type,
            identificadorUsuario,
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

  async consumirTokenEmail(hash: string, purpose: string, newHash: string | null, welcome = false) {
    return this.conexaoPostgreSql.executarTransacao(async (clienteTransacaoPostgreSql) => {
      const identificadorUsuario = (
        await clienteTransacaoPostgreSql.query<{ idUsuario: string }>(
          `select t."idUsuario" from identidade.tokens_email t join identidade.contas c using("idUsuario") where t.token_hash=$1 and t.finalidade=$2 and t.usado_em is null and t.expira_em>now() and t.email_normalizado=c.email_normalizado for update of t,c`,
          [hash, purpose],
        )
      ).rows[0]?.idUsuario;

      if (!identificadorUsuario) {
        return false;
      }

      await clienteTransacaoPostgreSql.query(
        "update identidade.tokens_email set usado_em=now() where token_hash=$1",
        [hash],
      );

      if (purpose === "confirmacao") {
        await clienteTransacaoPostgreSql.query(
          'update identidade.contas set email_confirmado_em=coalesce(email_confirmado_em,now()) where "idUsuario"=$1',
          [identificadorUsuario],
        );

        await clienteTransacaoPostgreSql.query(
          "update public.usuarios set estado_cadastro='ativo',atualizado_em=now() where \"idUsuario\"=$1",
          [identificadorUsuario],
        );

        if (welcome) {
          await clienteTransacaoPostgreSql.query(
            `insert into comunicacao.emails_transacionais("idEmailTransacional",tipo_evento,"idUsuario",email_destinatario,assunto,dados_template,maximo_tentativas,chave_idempotencia,agendado_em) select $1,'WELCOME_EMAIL',u."idUsuario",u.email,'Boas-vindas ao ConcursaAI',jsonb_build_object('nome',u.nome_completo),$2,'WELCOME_EMAIL/'||u."idUsuario"::text,now() from public.usuarios u where u."idUsuario"=$3 on conflict(chave_idempotencia) do nothing`,
            [randomUUID(), this.conexaoPostgreSql.config.email.attempts, identificadorUsuario],
          );
        }
      } else if (newHash) {
        await this.changePassword(clienteTransacaoPostgreSql, identificadorUsuario, newHash, null);
      } else {
        return false;
      }

      await this.cancelEmails(
        clienteTransacaoPostgreSql,
        identificadorUsuario,
        purpose === "confirmacao" ? "EMAIL_VERIFICATION" : "PASSWORD_RESET",
      );

      return true;
    });
  }
}
