import { cpSync, existsSync } from "node:fs";
import { config } from "dotenv";

const standalone = ".next/standalone";
if (!existsSync(`${standalone}/server.js`)) {
  console.error("Execute npm run build antes de iniciar a API em produção.");
  process.exit(1);
}

cpSync(".next/static", `${standalone}/.next/static`, { recursive: true });
if (existsSync("public")) cpSync("public", `${standalone}/public`, { recursive: true });

// O servidor standalone muda o diretório de trabalho ao iniciar.
config({ path: [".env.production.local", ".env.local", ".env.production", ".env"], quiet: true });
await import("../.next/standalone/server.js");
