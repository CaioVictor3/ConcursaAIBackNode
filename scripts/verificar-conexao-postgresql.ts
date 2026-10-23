import { ConexaoTransacoesPostgreSql } from "../src/infrastructure/conexao-transacoes-postgresql.js";
import { carregarConfiguracoesAmbiente } from "../src/config/configuracoes-ambiente.js";

const conexaoPostgreSql = new ConexaoTransacoesPostgreSql(carregarConfiguracoesAmbiente());

try {
  const result = await conexaoPostgreSql.executarConsultaSqlParametrizada<{
    user: string;
    version: string;
    count: string;
  }>(
    `select current_user as user,current_setting('server_version') as version,(select count(*) from information_schema.tables where table_schema in ('public','identidade','comunicacao')) as count`,
  );

  console.log(
    JSON.stringify({
      reachable: true,
      restrictedRole: result.rows[0]!.user.split(".")[0] === "concursa_backend",
      postgres: result.rows[0]!.version,
      visibleTables: Number(result.rows[0]!.count),
    }),
  );
} catch (error) {
  const erroConexao = error as { code?: string; name?: string };

  const tempoConexaoEsgotado =
    error instanceof Error && error.message === "Connection terminated due to connection timeout";

  console.log(
    JSON.stringify({
      reachable: false,
      errorType: erroConexao.name,
      code: erroConexao.code ?? (tempoConexaoEsgotado ? "CONNECTION_TIMEOUT" : "CONFIGURATION"),
    }),
  );

  process.exitCode = 1;
} finally {
  await conexaoPostgreSql.encerrarPoolConexoes();
}
