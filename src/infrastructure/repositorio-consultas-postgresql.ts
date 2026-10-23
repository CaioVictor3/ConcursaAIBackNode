import tableJson from "../contracts/mapeamento-tabelas-postgresql.json" with { type: "json" };
import type { MapaModelosContratosApi } from "../contracts/modelos-requisicoes-respostas-api.js";
import { projetarRespostaPeloContrato } from "../contracts/validacao-conversao-contratos-api.js";
import { ErroRegraNegocioHttp } from "../domain/erros-validacoes-respostas-api.js";
import {
  ConexaoTransacoesPostgreSql,
  protegerIdentificadorSql,
  type IdentidadeUsuarioAutenticado,
} from "./conexao-transacoes-postgresql.js";

export type NomeTabelaDominioPostgreSql = keyof typeof tableJson;

interface MapeamentoTabelaDominioPostgreSql {
  table: string;
  key: string;
  select: string;
  columns: Record<string, string>;
}

const tables: Record<NomeTabelaDominioPostgreSql, MapeamentoTabelaDominioPostgreSql> = tableJson;

export interface FiltroConsultaPostgreSql {
  column: string;
  op: "eq" | "ne" | "contains" | "ieq" | "in";
  value: unknown;
}

export const criarFiltroIgualdade = (column: string, value: unknown): FiltroConsultaPostgreSql => ({
  column,
  op: "eq",
  value,
});

export const criarFiltroDiferenca = (column: string, value: unknown): FiltroConsultaPostgreSql => ({
  column,
  op: "ne",
  value,
});

export const criarFiltroContemTexto = (
  column: string,
  value: string,
): FiltroConsultaPostgreSql => ({
  column,
  op: "contains",
  value: value.trim(),
});

export const criarFiltroIgualdadeSemDiferenciarMaiusculas = (
  column: string,
  value: string,
): FiltroConsultaPostgreSql => ({
  column,
  op: "ieq",
  value,
});

export const criarFiltroValorDentroLista = (
  column: string,
  value: readonly string[],
): FiltroConsultaPostgreSql => ({
  column,
  op: "in",
  value,
});

export interface ParametrosConsultaPostgreSql {
  filters?: FiltroConsultaPostgreSql[];
  or?: FiltroConsultaPostgreSql[];
  order?: [string, boolean?][];
  offset?: number;
  limit?: number;
}

export type RepositorioConsultasNegocio = Pick<
  RepositorioConsultasNegocioPostgreSql,
  | "user"
  | "consultarPaginaRegistros"
  | "obterRegistroObrigatorio"
  | "obterRegistroOpcional"
  | "existeRegistro"
  | "listarRegistros"
  | "executarMutacaoRegistro"
  | "executarFuncaoPostgreSql"
  | "executarFuncaoPostgreSqlComContrato"
>;

export class RepositorioConsultasNegocioPostgreSql {
  constructor(
    readonly conexaoPostgreSql: ConexaoTransacoesPostgreSql,
    readonly user: IdentidadeUsuarioAutenticado,
  ) {}

  private obterColunaMapeada(map: MapeamentoTabelaDominioPostgreSql, name: string) {
    const alias = map.select
      .split(",")
      .map((registroAtual) => registroAtual.split(":"))
      .find((parteResposta) => parteResposta[0] === name && parteResposta.length === 2);

    const physical = alias?.[1] ?? name;

    if (!map.columns[physical]) {
      throw new Error("Coluna não mapeada.");
    }

    return physical;
  }

  async consultarPaginaRegistros<K extends keyof MapaModelosContratosApi>(
    table: NomeTabelaDominioPostgreSql,
    model: K,
    request: ParametrosConsultaPostgreSql = {},
  ): Promise<{ itens: MapaModelosContratosApi[K][]; total: number }> {
    const limit = request.limit ?? 1000;

    const offset = request.offset ?? 0;

    if (offset < 0 || limit < 1 || limit > 1000) {
      throw new Error("Intervalo de consulta inválido.");
    }

    return this.conexaoPostgreSql.executarComoUsuarioAutenticado(this.user, async (client) => {
      const map = tables[table];

      const params: unknown[] = [];

      const param = (valorAtual: unknown) => {
        params.push(valorAtual);

        return "$" + params.length;
      };

      const condition = (campoContrato: FiltroConsultaPostgreSql) => {
        const col = protegerIdentificadorSql(this.obterColunaMapeada(map, campoContrato.column));

        if (campoContrato.value === null) {
          return `${col} is ${campoContrato.op === "ne" ? "not " : ""}null`;
        }

        let valorFiltro = campoContrato.value;

        if (campoContrato.op === "contains" || campoContrato.op === "ieq") {
          valorFiltro = String(valorFiltro).replace(/[\\%_]/g, "\\$&");

          if (campoContrato.op === "contains") {
            valorFiltro = "%" + valorFiltro + "%";
          }
        }

        const parteResposta = param(valorFiltro);

        return campoContrato.op === "in"
          ? `${col}=any(${parteResposta}::uuid[])`
          : `${col}${campoContrato.op === "ne" ? "<>" : campoContrato.op === "contains" || campoContrato.op === "ieq" ? " ilike " : "="}${parteResposta}`;
      };

      const parts = (request.filters ?? []).map(condition);

      if (request.or?.length) {
        parts.push("(" + request.or.map(condition).join(" or ") + ")");
      }

      const where = parts.length ? " where " + parts.join(" and ") : "";

      const selection = map.select
        .split(",")
        .map((registroAtual) => {
          const [alias, physical] = registroAtual.split(":");

          return physical
            ? protegerIdentificadorSql(physical) + " as " + protegerIdentificadorSql(alias!)
            : protegerIdentificadorSql(alias!);
        })
        .join(",");

      const order = request.order?.length
        ? request.order
            .map(
              ([registroAtual, desc]) =>
                protegerIdentificadorSql(this.obterColunaMapeada(map, registroAtual)) +
                (desc ? " desc" : " asc"),
            )
            .join(",")
        : protegerIdentificadorSql(map.key);

      const lim = param(limit);

      const off = param(offset);

      const sql = `select jsonb_build_object('itens',coalesce((select jsonb_agg(to_jsonb(x)) from (select ${selection} from public.${protegerIdentificadorSql(map.table)}${where} order by ${order} limit ${lim} offset ${off}) x),'[]'::jsonb),'total',(select count(*) from public.${protegerIdentificadorSql(map.table)}${where})) as value`;

      const resultadoConsultaPostgreSql = await client.query<{
        value: { itens: unknown[]; total: number };
      }>(sql, params);

      const dadosPersistencia = resultadoConsultaPostgreSql.rows[0]!.value;

      return {
        itens: dadosPersistencia.itens.map((registroAtual) =>
          projetarRespostaPeloContrato(model, registroAtual),
        ),
        total: dadosPersistencia.total,
      };
    });
  }

  async obterRegistroObrigatorio<K extends keyof MapaModelosContratosApi>(
    table: NomeTabelaDominioPostgreSql,
    model: K,
    filters: FiltroConsultaPostgreSql[],
    message = "Registro não encontrado.",
    or?: FiltroConsultaPostgreSql[],
  ): Promise<MapaModelosContratosApi[K]> {
    const paginaRegistros = await this.consultarPaginaRegistros(table, model, {
      filters,
      or,
      limit: 2,
    });

    if (paginaRegistros.itens.length !== 1) {
      throw new ErroRegraNegocioHttp(message, 404);
    }

    return paginaRegistros.itens[0]!;
  }

  async obterRegistroOpcional<K extends keyof MapaModelosContratosApi>(
    table: NomeTabelaDominioPostgreSql,
    model: K,
    filters: FiltroConsultaPostgreSql[],
  ): Promise<MapaModelosContratosApi[K] | null> {
    return (
      (await this.consultarPaginaRegistros(table, model, { filters, limit: 2 })).itens[0] ?? null
    );
  }

  async existeRegistro(table: NomeTabelaDominioPostgreSql, filters: FiltroConsultaPostgreSql[]) {
    return (
      (
        await this.consultarPaginaRegistros(table, "VerificarSistemaRequestModel", {
          filters,
          limit: 1,
        })
      ).total > 0
    );
  }

  async listarRegistros<K extends keyof MapaModelosContratosApi>(
    table: NomeTabelaDominioPostgreSql,
    model: K,
    request: ParametrosConsultaPostgreSql = {},
  ): Promise<MapaModelosContratosApi[K][]> {
    const registrosEncontrados: MapaModelosContratosApi[K][] = [];

    for (let offset = 0; ; offset += 500) {
      const paginaRegistros = await this.consultarPaginaRegistros(table, model, {
        ...request,
        offset,
        limit: 500,
      });

      registrosEncontrados.push(...paginaRegistros.itens);

      if (registrosEncontrados.length >= paginaRegistros.total) {
        return registrosEncontrados;
      }

      if (!paginaRegistros.itens.length) {
        throw new ErroRegraNegocioHttp("A consulta foi alterada. Tente novamente.", 409);
      }
    }
  }

  async executarMutacaoRegistro(
    table: NomeTabelaDominioPostgreSql,
    operation: "insert" | "update" | "delete",
    identificadorRegistro: string,
    dadosPersistencia: Record<string, unknown> = {},
  ) {
    if (!["Questao", "Concurso", "Assunto", "Banca", "Disciplina"].includes(table)) {
      throw new Error("Esta tabela só pode ser alterada pelas funções autorizadas do banco.");
    }

    return this.conexaoPostgreSql.executarComoUsuarioAutenticado(this.user, async (client) => {
      const map = tables[table];

      const values: unknown[] = [identificadorRegistro];

      const keys = Object.keys(dadosPersistencia).map((chaveAtual) =>
        this.obterColunaMapeada(map, chaveAtual),
      );

      const adicionarParametroSql = (valorAtual: unknown) => {
        values.push(valorAtual);

        return "$" + values.length;
      };

      let sql: string;

      if (operation === "delete") {
        sql = `delete from public.${protegerIdentificadorSql(map.table)} where ${protegerIdentificadorSql(map.key)}=$1`;
      } else if (operation === "insert") {
        values.length = 0;

        if (dadosPersistencia[map.key] !== identificadorRegistro) {
          throw new Error("Identidade de registro inválida.");
        }

        sql = `insert into public.${protegerIdentificadorSql(map.table)} (${keys.map(protegerIdentificadorSql).join(",")}) values (${Object.values(dadosPersistencia).map(adicionarParametroSql).join(",")})`;
      } else {
        if (!keys.length || keys.includes(map.key)) {
          throw new Error("Campos de atualização inválidos.");
        }

        sql = `update public.${protegerIdentificadorSql(map.table)} set ${keys.map((chaveAtual, indiceAtual) => protegerIdentificadorSql(chaveAtual) + "=" + adicionarParametroSql(Object.values(dadosPersistencia)[indiceAtual])).join(",")} where ${protegerIdentificadorSql(map.key)}=$1`;
      }

      const resultadoMutacaoPostgreSql = await client.query(
        sql + " returning " + protegerIdentificadorSql(map.key),
        values,
      );

      if (resultadoMutacaoPostgreSql.rowCount !== 1) {
        throw new ErroRegraNegocioHttp("O registro não existe ou não pôde ser alterado.", 404);
      }
    });
  }

  async executarFuncaoPostgreSql<T>(
    name: string,
    params: Record<string, unknown> = {},
    obterListaAmbiente = false,
  ): Promise<T> {
    if (
      !/^[a-z_]+$/.test(name) ||
      Object.keys(params).some((chaveAtual) => !/^[a-z_]+$/.test(chaveAtual))
    ) {
      throw new Error("Identificador de função inválido.");
    }

    return this.conexaoPostgreSql.executarComoUsuarioAutenticado(this.user, async (client) => {
      const values = Object.values(params).map((valorAtual) =>
        valorAtual !== null && typeof valorAtual === "object" && !Array.isArray(valorAtual)
          ? JSON.stringify(valorAtual)
          : valorAtual,
      );

      const args = Object.keys(params)
        .map(
          (chaveAtual, indiceAtual) =>
            protegerIdentificadorSql(chaveAtual) + "=> $" + (indiceAtual + 1),
        )
        .join(",");

      const call = `public.${protegerIdentificadorSql(name)}(${args})`;

      const sql = obterListaAmbiente
        ? `select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) as value from ${call} x`
        : `select to_jsonb(${call}) as value`;

      return (await client.query<{ value: T }>(sql, values)).rows[0]!.value;
    });
  }

  async executarFuncaoPostgreSqlComContrato<K extends keyof MapaModelosContratosApi>(
    name: string,
    model: K,
    params: Record<string, unknown> = {},
  ) {
    const retornoFuncaoPostgreSql = await this.executarFuncaoPostgreSql<unknown>(name, params);

    return retornoFuncaoPostgreSql === null
      ? null
      : projetarRespostaPeloContrato(model, retornoFuncaoPostgreSql);
  }
}
