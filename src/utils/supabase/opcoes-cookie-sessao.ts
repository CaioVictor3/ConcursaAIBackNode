import type { CookieOptionsWithName } from "@supabase/ssr";

const nomeSessaoProducao = "__Host-concursaai-auth-token";

export function opcoesCookieSessaoSupabase(): CookieOptionsWithName {
  const producao = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    path: "/",
    secure: producao,
    sameSite: producao ? "none" : "lax",
    // Em HTTPS, a sessão fica vinculada ao site da interface que chamou a API.
    ...(producao ? { name: nomeSessaoProducao, partitioned: true } : {}),
  };
}

export function temCookieSessaoSupabase(cabecalho: string | null): boolean {
  return (cabecalho ?? "").split(";").some((cookie) => {
    const [nome = ""] = cookie.trim().split("=", 1);
    return (
      nome === nomeSessaoProducao ||
      nome.startsWith(`${nomeSessaoProducao}.`) ||
      /^sb-[^=]+-auth-token(?:\.\d+)?$/.test(nome)
    );
  });
}
