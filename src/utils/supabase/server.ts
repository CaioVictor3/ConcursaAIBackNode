import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { obterConfiguracaoPublicaSupabase } from "./config.js";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, chave } = obterConfiguracaoPublicaSupabase();
  return createServerClient(url, chave, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (valores, _cabecalhos) => {
        try {
          valores.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components não podem gravar cookies; o Proxy atualiza a sessão.
        }
      },
    },
  });
}

export type CookieSupabasePendente = {
  nome: string;
  valor: string;
  opcoes: Record<string, unknown>;
};

export function criarClienteSupabaseRequisicao(
  requisicao: NextRequest,
  registrar: (cookies: CookieSupabasePendente[], cabecalhos: Record<string, string>) => void,
) {
  const { url, chave } = obterConfiguracaoPublicaSupabase();
  return createServerClient(url, chave, {
    cookies: {
      getAll: () => requisicao.cookies.getAll(),
      setAll: (valores, cabecalhos) => {
        valores.forEach(({ name, value }) => requisicao.cookies.set(name, value));
        registrar(
          valores.map(({ name, value, options }) => ({
            nome: name,
            valor: value,
            opcoes: options,
          })),
          cabecalhos,
        );
      },
    },
  });
}
