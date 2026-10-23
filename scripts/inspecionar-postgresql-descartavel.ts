import { cluster } from "../tests/postgres/cluster-postgresql-descartavel.js";

try {
  const clusterPostgreSql = await cluster();

  console.log("PostgreSQL isolado e migrations originais: OK");

  await clusterPostgreSql.stop();
} catch (erroCapturado) {
  let current: unknown = erroCapturado;

  while (current instanceof Error) {
    console.error(current.message);

    current = current.cause;
  }

  process.exitCode = 1;
}
