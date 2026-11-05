import { createClient } from "@supabase/supabase-js";
import { obterConfiguracaoPublicaSupabase } from "./config.js";
import { ErroRegraNegocioHttp } from "../../domain/erros-validacoes-respostas-api.js";

export function criarClienteSupabaseAdministrativo() {
  const { url, chave: chavePublicavel } = obterConfiguracaoPublicaSupabase();
  const chave = process.env.SUPABASE_SERVER_SECRET_API_KEY?.trim();
  if (!chave || chave === chavePublicavel || chave.startsWith("sb_publishable_"))
    throw new ErroRegraNegocioHttp(
      "A integração administrativa precisa da chave privada do Supabase no servidor.",
      503,
    );
  return createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
