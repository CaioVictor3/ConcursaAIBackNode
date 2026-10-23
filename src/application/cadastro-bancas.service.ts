import { randomUUID } from "node:crypto";
import * as ContratosApi from "../contracts/modelos-requisicoes-respostas-api.js";
import { projetarRespostaPeloContrato } from "../contracts/validacao-conversao-contratos-api.js";
import {
  ErroRegraNegocioHttp,
  criarRespostaSucesso,
  validarIdentificador,
  validarPaginacao,
  validarTexto,
} from "../domain/erros-validacoes-respostas-api.js";
import {
  criarFiltroContemTexto,
  criarFiltroDiferenca,
  criarFiltroIgualdade,
  criarFiltroIgualdadeSemDiferenciarMaiusculas,
} from "../infrastructure/repositorio-consultas-postgresql.js";
import { ServicoAutorizacaoUsuarioAutenticado } from "./autorizacao-usuario-autenticado.js";

export function operacoesCadastroBancas(contextoAutorizacao: ServicoAutorizacaoUsuarioAutenticado) {
  const repositorioNegocio = contextoAutorizacao.repo;

  return {
    async listarBancas(solicitacaoListarBancas: ContratosApi.ListarBancasRequestModel) {
      await contextoAutorizacao.exigirUsuarioAtivo();

      validarPaginacao(solicitacaoListarBancas.pagina, solicitacaoListarBancas.quantidadePorPagina);

      const filtrosConsulta = [];

      if (solicitacaoListarBancas.busca?.trim()) {
        filtrosConsulta.push(criarFiltroContemTexto("nome", solicitacaoListarBancas.busca));
      }

      const paginaRegistros = await repositorioNegocio.consultarPaginaRegistros(
        "Banca",
        "BancaResponseModel",
        {
          filters: filtrosConsulta,
          order: [["nome"], ["idBanca"]],
          offset:
            (solicitacaoListarBancas.pagina - 1) * solicitacaoListarBancas.quantidadePorPagina,
          limit: solicitacaoListarBancas.quantidadePorPagina,
        },
      );

      return criarRespostaSucesso(
        {
          ...paginaRegistros,
          pagina: solicitacaoListarBancas.pagina,
          quantidadePorPagina: solicitacaoListarBancas.quantidadePorPagina,
        },
        "Bancas consultadas.",
      );
    },

    async obterBanca(solicitacaoObterBanca: ContratosApi.ObterBancaRequestModel) {
      await contextoAutorizacao.exigirUsuarioAtivo();

      validarIdentificador(solicitacaoObterBanca.idBanca, "banca");

      return criarRespostaSucesso(
        await repositorioNegocio.obterRegistroObrigatorio(
          "Banca",
          "BancaResponseModel",
          [criarFiltroIgualdade("idBanca", solicitacaoObterBanca.idBanca)],
          "Banca não encontrada.",
        ),
        "Banca consultada.",
      );
    },

    async criarBanca(solicitacaoCriarBanca: ContratosApi.CriarBancaRequestModel) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      const identificadorBanca = randomUUID();

      const nome = validarTexto(solicitacaoCriarBanca.nome, "Nome", 2, 200);

      if (
        await repositorioNegocio.existeRegistro("Banca", [
          criarFiltroIgualdadeSemDiferenciarMaiusculas("nome", nome),
        ])
      ) {
        throw new ErroRegraNegocioHttp("Já existe uma banca com esse nome.", 409);
      }

      const dadosPersistencia = { nome, sigla: solicitacaoCriarBanca.sigla?.trim() ?? "" };

      await repositorioNegocio.executarMutacaoRegistro("Banca", "insert", identificadorBanca, {
        ...dadosPersistencia,
        idBanca: identificadorBanca,
        criado_em: new Date().toISOString(),
      });

      return criarRespostaSucesso(
        projetarRespostaPeloContrato("BancaResponseModel", {
          ...{},
          ...dadosPersistencia,
          idBanca: identificadorBanca,
          criado_em: new Date().toISOString(),
        }),
        "Banca criada.",
      );
    },

    async atualizarBanca(solicitacaoAtualizarBanca: ContratosApi.AtualizarBancaRequestModel) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      const identificadorBanca = solicitacaoAtualizarBanca.idBanca;

      validarIdentificador(identificadorBanca, "banca");

      const registroAnterior = await repositorioNegocio.obterRegistroObrigatorio(
        "Banca",
        "BancaResponseModel",
        [criarFiltroIgualdade("idBanca", identificadorBanca)],
        "Banca não encontrada.",
      );

      const nome = validarTexto(solicitacaoAtualizarBanca.nome, "Nome", 2, 200);

      if (
        await repositorioNegocio.existeRegistro("Banca", [
          criarFiltroIgualdadeSemDiferenciarMaiusculas("nome", nome),
          criarFiltroDiferenca("idBanca", identificadorBanca),
        ])
      ) {
        throw new ErroRegraNegocioHttp("Já existe uma banca com esse nome.", 409);
      }

      const dadosPersistencia = { nome, sigla: solicitacaoAtualizarBanca.sigla?.trim() ?? "" };

      await repositorioNegocio.executarMutacaoRegistro("Banca", "update", identificadorBanca, {
        ...dadosPersistencia,
      });

      return criarRespostaSucesso(
        projetarRespostaPeloContrato("BancaResponseModel", {
          ...registroAnterior,
          ...dadosPersistencia,
          idBanca: identificadorBanca,
        }),
        "Banca atualizada.",
      );
    },

    async excluirBanca(solicitacaoExcluirBanca: ContratosApi.ExcluirBancaRequestModel) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      const identificadorBanca = solicitacaoExcluirBanca.idBanca;

      validarIdentificador(identificadorBanca, "banca");

      const registroAnterior = await repositorioNegocio.obterRegistroObrigatorio(
        "Banca",
        "BancaResponseModel",
        [criarFiltroIgualdade("idBanca", identificadorBanca)],
        "Banca não encontrada.",
      );

      if (
        await repositorioNegocio.existeRegistro("Questao", [
          criarFiltroIgualdade("idBanca", identificadorBanca),
        ])
      ) {
        throw new ErroRegraNegocioHttp(
          "Este cadastro possui vínculos e não pode ser excluído.",
          409,
        );
      }

      await repositorioNegocio.executarMutacaoRegistro("Banca", "delete", identificadorBanca);

      return criarRespostaSucesso(registroAnterior, "Banca excluída.");
    },
  };
}
