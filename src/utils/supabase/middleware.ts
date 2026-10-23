import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { obterConfiguracaoPublicaSupabase } from "./config.js";

export async function atualizarSessao(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, chave } = obterConfiguracaoPublicaSupabase();
  const supabase = createServerClient(url, chave, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (valores, cabecalhos) => {
        valores.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        valores.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(cabecalhos).forEach(([nome, valor]) => response.headers.set(nome, valor));
      },
    },
  });
  await supabase.auth.getClaims();
  return response;
}
