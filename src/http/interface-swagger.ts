import { readFile } from "node:fs/promises";
import { join } from "node:path";

const arquivosSwagger = {
  "swagger-ui.css": "text/css; charset=utf-8",
  "swagger-ui-bundle.js": "text/javascript; charset=utf-8",
} as const;

const paginaSwagger = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ConcursaAI API · Swagger</title>
    <link rel="icon" href="data:,">
    <link rel="stylesheet" href="/api/docs/swagger-ui.css">
  </head>
  <body>
    <div id="swagger-ui"></div>
    <noscript>Ative o JavaScript para consultar e testar as rotas da API ConcursaAI.</noscript>
    <script src="/api/docs/swagger-ui-bundle.js" defer></script>
    <script src="/api/docs/swagger-initializer.js" defer></script>
  </body>
</html>`;

const inicializacaoSwagger = `window.ui = SwaggerUIBundle({
  url: "/api/openapi.json",
  dom_id: "#swagger-ui",
  deepLinking: true,
  filter: true,
  docExpansion: "none",
  displayRequestDuration: true,
  defaultModelsExpandDepth: -1,
  persistAuthorization: false,
  validatorUrl: null,
  requestInterceptor: function (request) {
    var destino = new URL(request.url, window.location.origin);
    if (destino.origin === window.location.origin) {
      request.headers["X-Concursa-Client"] = "web";
      // As rotas Autenticacao usam Bearer; Navegador usa a sessão HttpOnly do frontend.
      request.credentials = destino.pathname.startsWith("/api/Navegador/")
        ? "same-origin" : "omit";
    }
    return request;
  }
});`;

export async function atenderDocumentacaoSwagger(arquivo: string[] = []) {
  const cabecalhos = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };

  if (arquivo.length === 0) {
    return new Response(paginaSwagger, {
      headers: {
        ...cabecalhos,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      },
    });
  }

  const nome = arquivo[0]!;
  if (arquivo.length === 1 && nome === "swagger-initializer.js") {
    return new Response(inicializacaoSwagger, {
      headers: { ...cabecalhos, "Content-Type": "text/javascript; charset=utf-8" },
    });
  }

  if (arquivo.length !== 1 || !Object.hasOwn(arquivosSwagger, nome)) {
    return new Response("Arquivo não encontrado.", { status: 404, headers: cabecalhos });
  }

  const conteudo = await readFile(join(process.cwd(), "node_modules", "swagger-ui-dist", nome));
  return new Response(new Uint8Array(conteudo), {
    headers: {
      ...cabecalhos,
      "Content-Type": arquivosSwagger[nome as keyof typeof arquivosSwagger],
    },
  });
}
