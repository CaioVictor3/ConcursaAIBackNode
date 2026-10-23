import type { SupabaseClient } from "@supabase/supabase-js";
import tableJson from "../contracts/mapeamento-tabelas-postgresql.json" with { type: "json" };
import type { MapaModelosContratosApi } from "../contracts/modelos-requisicoes-respostas-api.js";
import { projetarRespostaPeloContrato } from "../contracts/validacao-conversao-contratos-api.js";
import { ErroRegraNegocioHttp } from "../domain/erros-validacoes-respostas-api.js";
import type { IdentidadeUsuarioAutenticado } from "./conexao-transacoes-postgresql.js";
import type {
  FiltroConsultaPostgreSql,
  NomeTabelaDominioPostgreSql,
  ParametrosConsultaPostgreSql,
  RepositorioConsultasNegocio,
} from "./repositorio-consultas-postgresql.js";
import { criarClienteSupabaseAdministrativo } from "../utils/supabase/admin.js";

export class RepositorioConsultasNegocioSupabase implements RepositorioConsultasNegocio {
  constructor(
    readonly supabase: SupabaseClient,
    readonly user: IdentidadeUsuarioAutenticado,
  ) {}

  private coluna(tabela: NomeTabelaDominioPostgreSql, nome: string) {
    const mapa = tableJson[tabela];
    const campo = mapa.select.split(",").find((item) => item.split(":")[0] === nome);
    const fisica = campo?.split(":")[1] ?? nome;
    if (!(fisica in mapa.columns)) throw new Error("Coluna não mapeada.");
    return fisica;
  }

  async consultarPaginaRegistros<K extends keyof MapaModelosContratosApi>(
    tabela: NomeTabelaDominioPostgreSql,
    modelo: K,
    parametros: ParametrosConsultaPostgreSql = {},
  ): Promise<{ itens: MapaModelosContratosApi[K][]; total: number }> {
    const limite = parametros.limit ?? 1000;
    const inicio = parametros.offset ?? 0;
    if (inicio < 0 || limite < 1 || limite > 1000)
      throw new Error("Intervalo de consulta inválido.");
    const mapa = tableJson[tabela];
    let consulta = this.supabase.from(mapa.table).select(mapa.select, { count: "exact" });
    const escapar = (valor: unknown) => String(valor).replace(/[\\%_]/g, "\\$&");
    for (const filtro of parametros.filters ?? []) {
      const coluna = this.coluna(tabela, filtro.column);
      if (filtro.value === null)
        consulta =
          filtro.op === "ne" ? consulta.not(coluna, "is", null) : consulta.is(coluna, null);
      else if (filtro.op === "in") consulta = consulta.in(coluna, filtro.value as string[]);
      else if (filtro.op === "contains")
        consulta = consulta.ilike(coluna, "%" + escapar(filtro.value) + "%");
      else if (filtro.op === "ieq") consulta = consulta.ilike(coluna, escapar(filtro.value));
      else if (filtro.op === "ne") consulta = consulta.neq(coluna, filtro.value);
      else consulta = consulta.eq(coluna, filtro.value);
    }
    if (parametros.or?.length) {
      const condicao = (filtro: FiltroConsultaPostgreSql) => {
        const coluna = this.coluna(tabela, filtro.column);
        const operador =
          filtro.value === null
            ? filtro.op === "ne"
              ? "not.is"
              : "is"
            : filtro.op === "ne"
              ? "neq"
              : ["contains", "ieq"].includes(filtro.op)
                ? "ilike"
                : "eq";
        const valor =
          filtro.value === null
            ? "null"
            : filtro.op === "contains"
              ? "%" + escapar(filtro.value) + "%"
              : filtro.op === "ieq"
                ? escapar(filtro.value)
                : String(filtro.value);
        return `${coluna}.${operador}."${valor.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      };
      consulta = consulta.or(parametros.or.map(condicao).join(","));
    }
    for (const [nome, descendente] of parametros.order ?? [[mapa.key, false]])
      consulta = consulta.order(this.coluna(tabela, nome), { ascending: !descendente });
    const { data, error, count } = await consulta.range(inicio, inicio + limite - 1);
    if (error) throw error;
    return {
      itens: (data ?? []).map((item) => projetarRespostaPeloContrato(modelo, item)),
      total: count ?? 0,
    };
  }

  async obterRegistroObrigatorio<K extends keyof MapaModelosContratosApi>(
    tabela: NomeTabelaDominioPostgreSql,
    modelo: K,
    filters: FiltroConsultaPostgreSql[],
    mensagem = "Registro não encontrado.",
    or?: FiltroConsultaPostgreSql[],
  ) {
    const { itens } = await this.consultarPaginaRegistros(tabela, modelo, {
      filters,
      or,
      limit: 2,
    });
    if (itens.length !== 1) throw new ErroRegraNegocioHttp(mensagem, 404);
    return itens[0]!;
  }

  async obterRegistroOpcional<K extends keyof MapaModelosContratosApi>(
    tabela: NomeTabelaDominioPostgreSql,
    modelo: K,
    filters: FiltroConsultaPostgreSql[],
  ) {
    return (
      (await this.consultarPaginaRegistros(tabela, modelo, { filters, limit: 1 })).itens[0] ?? null
    );
  }

  async existeRegistro(tabela: NomeTabelaDominioPostgreSql, filters: FiltroConsultaPostgreSql[]) {
    return (
      (
        await this.consultarPaginaRegistros(tabela, "VerificarSistemaRequestModel", {
          filters,
          limit: 1,
        })
      ).total > 0
    );
  }

  async listarRegistros<K extends keyof MapaModelosContratosApi>(
    tabela: NomeTabelaDominioPostgreSql,
    modelo: K,
    parametros: ParametrosConsultaPostgreSql = {},
  ) {
    const itens: MapaModelosContratosApi[K][] = [];
    for (let offset = 0; ; offset += 500) {
      const pagina = await this.consultarPaginaRegistros(tabela, modelo, {
        ...parametros,
        offset,
        limit: 500,
      });
      itens.push(...pagina.itens);
      if (itens.length >= pagina.total) return itens;
      if (!pagina.itens.length)
        throw new ErroRegraNegocioHttp("A consulta foi alterada. Tente novamente.", 409);
    }
  }

  async executarMutacaoRegistro(
    tabela: NomeTabelaDominioPostgreSql,
    operacao: "insert" | "update" | "delete",
    id: string,
    dados: Record<string, unknown> = {},
  ) {
    if (!["Questao", "Concurso", "Assunto", "Banca", "Disciplina"].includes(tabela))
      throw new Error("Esta tabela só pode ser alterada pelas funções autorizadas do banco.");
    const mapa = tableJson[tabela];
    const valores = Object.fromEntries(
      Object.entries(dados).map(([nome, valor]) => [this.coluna(tabela, nome), valor]),
    );
    if (operacao === "insert" && valores[mapa.key] !== id)
      throw new Error("Identidade de registro inválida.");
    if (operacao === "update" && (!Object.keys(valores).length || mapa.key in valores))
      throw new Error("Campos de atualização inválidos.");
    const base = this.supabase.from(mapa.table);
    const consulta =
      operacao === "insert"
        ? base.insert(valores)
        : operacao === "update"
          ? base.update(valores).eq(mapa.key, id)
          : base.delete().eq(mapa.key, id);
    const { data, error } = await consulta.select(mapa.key);
    if (error) throw error;
    if (data?.length !== 1)
      throw new ErroRegraNegocioHttp("O registro não existe ou não pôde ser alterado.", 404);
  }

  async executarFuncaoPostgreSql<T>(
    nome: string,
    parametros: Record<string, unknown> = {},
    _lista = false,
  ): Promise<T> {
    if (!/^[a-z_]+$/.test(nome)) throw new Error("Identificador de função inválido.");
    const camposJson = new Set([
      "p_pessoa",
      "p_simulado",
      "p_questao",
      "p_alternativas",
      "p_gabarito",
      "p_assuntos",
      "p_cotas_temas",
      "p_conteudo",
      "p_dados",
    ]);
    parametros = Object.fromEntries(
      Object.entries(parametros).map(([chave, valor]) => [
        chave,
        camposJson.has(chave) && typeof valor === "string" ? JSON.parse(valor) : valor,
      ]),
    );
    if (["salvar_analise_backend_com_consumo", "salvar_pergunta_contextual_ia"].includes(nome)) {
      const { data, error } = await criarClienteSupabaseAdministrativo().rpc(
        "concluir_geracao_ia_backend",
        {
          p_idusuario: this.user.id,
          p_tipo: nome === "salvar_analise_backend_com_consumo" ? "analise" : "pergunta",
          p_dados: parametros,
        },
      );
      if (error) throw error;
      return data as T;
    }
    const { data, error } = await this.supabase.rpc(nome, parametros);
    if (error) throw error;
    return data as T;
  }

  async executarFuncaoPostgreSqlComContrato<K extends keyof MapaModelosContratosApi>(
    nome: string,
    modelo: K,
    parametros: Record<string, unknown> = {},
  ) {
    const dados = await this.executarFuncaoPostgreSql<unknown>(nome, parametros);
    return dados === null ? null : projetarRespostaPeloContrato(modelo, dados);
  }
}
