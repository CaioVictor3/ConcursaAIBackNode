"use client";

import { createBrowserClient } from "@supabase/ssr";
import { obterConfiguracaoPublicaSupabase } from "./config.js";

export function createClient() {
  const { url, chave } = obterConfiguracaoPublicaSupabase();
  return createBrowserClient(url, chave);
}
