import type { NextRequest } from "next/server";
import { atualizarSessao } from "./utils/supabase/middleware.js";

export function proxy(request: NextRequest) {
  return atualizarSessao(request);
}

// A API atualiza os próprios cookies em seus Route Handlers. O Proxy atende
// apenas a página Next e não intercepta o frontend React/Vite.
export const config = { matcher: "/" };
