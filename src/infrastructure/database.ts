import pg, { type PoolClient, type PoolConfig, type QueryResultRow } from "pg";
import type { Config } from "../config/config.js";
import { ServiceError } from "../domain/errors.js";
export interface UserContext {
  id: string;
  sessionId: string;
  token: string;
}
export const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
export function connectionOptions(config: Config): PoolConfig {
  let url: URL;
  try {
    url = new URL(config.databaseUrl);
  } catch {
    throw new ServiceError(
      "A conexão do backend com o banco ainda não foi configurada.",
      503,
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    decodeURIComponent(url.username).split(".")[0] !== "concursa_backend"
  )
    throw new Error(
      "Use o usuário restrito concursa_backend na conexão do backend.",
    );
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!local && url.searchParams.get("sslmode") !== "verify-full")
    throw new Error(
      "A conexão remota com o PostgreSQL exige sslmode=verify-full.",
    );
  const hostname = url.hostname;
  url.searchParams.delete("sslmode");
  url.searchParams.delete("sslrootcert");
  return {
    connectionString: url.toString(),
    ssl: local
      ? false
      : {
          rejectUnauthorized: true,
          ca: config.databaseCa,
          servername: hostname,
        },
    max: config.poolMax,
    connectionTimeoutMillis: config.databaseTimeout,
    statement_timeout: config.databaseCommandTimeout,
    idleTimeoutMillis: 30000,
  };
}
export class Database {
  private pool?: pg.Pool;
  constructor(readonly config: Config) {}
  get configured() {
    return !!this.config.databaseUrl;
  }
  private source() {
    if (!this.pool) {
      this.pool = new pg.Pool(connectionOptions(this.config));
      this.pool.on("error", () =>
        process.stderr.write(
          "PostgreSQL: conexão ociosa encerrada; o pool tentará reconectar.\n",
        ),
      );
    }
    return this.pool;
  }
  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ) {
    return this.source().query<T>(sql, params);
  }
  async transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.source().connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async asUser<T>(
    user: UserContext,
    operation: (client: PoolClient) => Promise<T>,
  ) {
    if (!user.id || !user.token)
      throw new ServiceError("Entre na sua conta para continuar.", 401);
    return this.transaction(async (client) => {
      await client.query("SET LOCAL ROLE concursa_dados");
      await client.query(
        "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
        [user.id, JSON.stringify({ sub: user.id, role: "authenticated" })],
      );
      return operation(client);
    });
  }
  async close() {
    await this.pool?.end();
  }
}
