import { consultarEnderecoViaCep } from "../src/infrastructure/cliente-enderecos-viacep.js";

try {
  const result = await consultarEnderecoViaCep("01001000", "https://viacep.com.br/ws/");

  console.log(
    JSON.stringify({
      provider: "ViaCEP",
      reachable: true,
      validContract: result.cep === "01001000" && !!result.cidade && !!result.uf,
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      provider: "ViaCEP",
      reachable: false,
      errorType: error instanceof Error ? error.name : "Unknown",
    }),
  );

  process.exitCode = 1;
}
