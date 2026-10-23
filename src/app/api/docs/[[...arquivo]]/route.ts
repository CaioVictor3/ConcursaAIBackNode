import { atenderDocumentacaoSwagger } from "../../../../http/interface-swagger.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  contexto: { params: Promise<{ arquivo?: string[] }> },
) {
  const { arquivo } = await contexto.params;
  return atenderDocumentacaoSwagger(arquivo);
}
