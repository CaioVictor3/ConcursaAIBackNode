import { config } from "dotenv";

// npm executa os comandos na raiz do backend. A API, os scripts e os workers
// compartilham o mesmo arquivo; variáveis da hospedagem têm precedência.
config({ path: ".env", quiet: true });
