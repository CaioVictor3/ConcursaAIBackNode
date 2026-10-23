import { createClient } from "@supabase/supabase-js";
import { obterConfiguracaoPublicaSupabase } from "./config.js";
import { ErroRegraNegocioHttp } from "../../domain/erros-validacoes-respostas-api.js";

export function criarClienteSupabaseAdministrativo() {
  const { url } = obterConfiguracaoPublicaSupabase();
  const chave = process.env.SUPABASE_SECRET_KEY;
  if (!chave)
    throw new ErroRegraNegocioHttp(
      "A integração administrativa com o banco precisa ser configurada no servidor.",
      503,
    );
  return createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
