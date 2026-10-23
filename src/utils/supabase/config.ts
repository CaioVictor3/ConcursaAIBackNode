export function obterConfiguracaoPublicaSupabase() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave =
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !chave) {
    throw new ErroRegraNegocioHttp(
      "Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no servidor.",
      503,
    );
  }
  const normalizada = url.replace(/\/+$/, "");
  try {
    const endereco = new URL(normalizada);
    if (
      endereco.pathname !== "/" ||
      endereco.search ||
      endereco.hash ||
      endereco.username ||
      endereco.password ||
      (endereco.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(endereco.hostname))
    )
      throw new Error();
  } catch {
    throw new ErroRegraNegocioHttp(
      "SUPABASE_URL deve conter a URL raiz do projeto, sem /rest/v1.",
      503,
    );
  }
  return { url: normalizada, chave };
}
import { ErroRegraNegocioHttp } from "../../domain/erros-validacoes-respostas-api.js";
