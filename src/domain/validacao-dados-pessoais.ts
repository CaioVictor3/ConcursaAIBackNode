import type { DadosPessoaRequestModel } from "../contracts/modelos-requisicoes-respostas-api.js";
import { ErroRegraNegocioHttp } from "./erros-validacoes-respostas-api.js";

export function validarDadosPessoais(dadosPessoa: DadosPessoaRequestModel) {
  if (!dadosPessoa) {
    throw new ErroRegraNegocioHttp("Informe os dados pessoais.");
  }

  const name = dadosPessoa.nomeCompleto?.trim().replace(/\s+/g, " ") ?? "";

  if (name.length < 3 || name.length > 200 || !name.includes(" ")) {
    throw new ErroRegraNegocioHttp("Informe nome e sobrenome.");
  }

  if (
    !dadosPessoa.dataNascimento ||
    dadosPessoa.dataNascimento < "1900-01-01" ||
    dadosPessoa.dataNascimento > new Date().toISOString().slice(0, 10)
  ) {
    throw new ErroRegraNegocioHttp("Informe uma data de nascimento válida.");
  }

  const cpf = dadosPessoa.cpf?.replace(/\D/g, "") ?? "";

  let valid = cpf.length === 11 && !/^(.)\1+$/.test(cpf);

  for (let position = 9; valid && position <= 10; position++) {
    let quantidadeTotal = 0;

    for (let indiceAtual = 0; indiceAtual < position; indiceAtual++) {
      quantidadeTotal += Number(cpf[indiceAtual]) * (position + 1 - indiceAtual);
    }

    const rest = (quantidadeTotal * 10) % 11;

    valid = Number(cpf[position]) === (rest === 10 ? 0 : rest);
  }

  if (!valid) {
    throw new ErroRegraNegocioHttp("Informe um CPF válido.");
  }

  const cep = dadosPessoa.cep?.replace(/\D/g, "") ?? "";

  if (cep.length !== 8) {
    throw new ErroRegraNegocioHttp("Informe um CEP de oito dígitos.");
  }

  if (
    !dadosPessoa.logradouro?.trim() ||
    !dadosPessoa.numero?.trim() ||
    !dadosPessoa.bairro?.trim() ||
    !dadosPessoa.cidade?.trim() ||
    !/^[a-zA-Z]{2}$/.test(dadosPessoa.uf?.trim() ?? "")
  ) {
    throw new ErroRegraNegocioHttp("Complete o endereço.");
  }

  return {
    nome_completo: name,
    data_nascimento: dadosPessoa.dataNascimento,
    cpf,
    cep,
    logradouro: dadosPessoa.logradouro.trim(),
    numero: dadosPessoa.numero.trim(),
    complemento: dadosPessoa.complemento?.trim() ?? null,
    bairro: dadosPessoa.bairro.trim(),
    cidade: dadosPessoa.cidade.trim(),
    uf: dadosPessoa.uf.trim().toUpperCase(),
  };
}
