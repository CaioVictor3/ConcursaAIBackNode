import "dotenv/config";
import { ServicoPagamentosAssinaturas } from "./application/pagamentos-assinaturas.service.js";
import { carregarMercadoPago } from "./config/configuracoes-mercado-pago.js";
import { ClienteMercadoPago } from "./infrastructure/cliente-mercado-pago.js";
import { RepositorioPagamentosSupabase } from "./infrastructure/repositorio-pagamentos-supabase.js";
import { criarClienteSupabaseAdministrativo } from "./utils/supabase/admin.js";

try {
  const servico = new ServicoPagamentosAssinaturas(
    new RepositorioPagamentosSupabase(criarClienteSupabaseAdministrativo()),
    new ClienteMercadoPago(carregarMercadoPago()),
  );
  const resultado = await servico.executarManutencao();
  console.info(JSON.stringify({ evento: "manutencao_financeira", ...resultado }));
  if (resultado.falhas > 0 || resultado.conciliados < resultado.consultados) process.exitCode = 1;
} catch {
  console.error(
    "Não foi possível executar a manutenção financeira. Confira a configuração e a conectividade.",
  );
  process.exitCode = 1;
}
