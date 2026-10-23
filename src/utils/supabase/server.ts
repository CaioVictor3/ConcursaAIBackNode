import { createServerClient } from "@supabase/ssr";
import { createClient as criarCliente } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { obterConfiguracaoPublicaSupabase } from "./config.js";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, chave } = obterConfiguracaoPublicaSupabase();
  return createServerClient(url, chave, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
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
  const token = requisicao.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (token) {
    const cliente = criarCliente(url, chave, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const getUser = cliente.auth.getUser.bind(cliente.auth);
    cliente.auth.getUser = () => getUser(token);
    return cliente;
  }
  return createServerClient(url, chave, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
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
