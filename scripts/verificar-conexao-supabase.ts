import { config } from "dotenv";
import { criarClienteSupabaseAdministrativo } from "../src/utils/supabase/admin.js";
config({ path: ".env.local" });
try {
  const { error } = await criarClienteSupabaseAdministrativo()
    .from("usuarios")
    .select("idUsuario", { head: true })
    .limit(1);
  if (error) throw error;
  console.log(JSON.stringify({ reachable: true, transport: "supabase-data-api" }));
} catch (erro) {
  console.log(
    JSON.stringify({ reachable: false, code: (erro as { code?: string }).code ?? "CONFIGURATION" }),
  );
  process.exitCode = 1;
}
