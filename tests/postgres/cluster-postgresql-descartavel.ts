import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";

export async function cluster() {
  const diretorioTemporario = await mkdtemp(join(tmpdir(), "concursa-node-pg-"));

  const port = await new Promise<number>((resolve) => {
    const servidorTemporario = createServer();

    servidorTemporario.listen(0, "127.0.0.1", () => {
      const portaDisponivel = (servidorTemporario.address() as { port: number }).port;

      servidorTemporario.close(() => resolve(portaDisponivel));
    });
  });

  const password = randomBytes(24).toString("hex");

  const instance = new EmbeddedPostgres({
    databaseDir: join(diretorioTemporario, "data"),
    user: "postgres",
    password,
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });

  await instance.initialise();

  await instance.start();

  const admin = new pg.Pool({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password,
    database: "postgres",
  });

  admin.on("error", () => {});

  const stop = async () => {
    await admin.end();

    await instance.stop();

    await rm(diretorioTemporario, { recursive: true, force: true });
  };

  try {
    await admin.query(`create role anon;create role authenticated;create role service_role bypassrls;create role supabase_auth_admin;
      create schema extensions;create schema auth;
      create table auth.users(id uuid primary key,email text,encrypted_password text,email_confirmed_at timestamptz,invited_at timestamptz,last_sign_in_at timestamptz,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',created_at timestamptz default now());
      create table auth.identities(provider text,provider_id text,user_id uuid,identity_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      grant usage on schema public,auth,extensions to anon,authenticated,service_role;
      grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
      alter default privileges in schema public grant all on tables to authenticated,service_role;
      alter default privileges in schema public grant all on functions to authenticated,service_role;
    `);

    const migrations = await readdir("database/reference/migrations");

    for (const name of migrations.filter((nomeArquivo) => nomeArquivo.endsWith(".sql")).sort()) {
      try {
        await admin.query(await readFile(join("database/reference/migrations", name), "utf8"));
      } catch (erroCapturado) {
        throw new Error("Migration de teste falhou: " + name, { cause: erroCapturado });
      }
    }
    // This role is made login-capable only inside the disposable test cluster.

    await admin.query(`alter role concursa_backend login password '${password}'`);

    return {
      admin,
      port,
      url: `postgresql://concursa_backend:${password}@127.0.0.1:${port}/postgres`,
      stop,
    };
  } catch (erroCapturado) {
    await stop();

    throw erroCapturado;
  }
}
