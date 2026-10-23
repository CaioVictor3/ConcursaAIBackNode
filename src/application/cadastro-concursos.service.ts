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

export function operacoesCadastroConcursos(
  contextoAutorizacao: ServicoAutorizacaoUsuarioAutenticado,
) {
  const repositorioNegocio = contextoAutorizacao.repo;

  return {
    async listarConcursos(solicitacaoListarConcursos: ContratosApi.ListarConcursosRequestModel) {
      await contextoAutorizacao.exigirUsuarioAtivo();

      validarPaginacao(
        solicitacaoListarConcursos.pagina,
        solicitacaoListarConcursos.quantidadePorPagina,
      );

      const filtrosConsulta = [];

      if (solicitacaoListarConcursos.busca?.trim()) {
        filtrosConsulta.push(criarFiltroContemTexto("nome", solicitacaoListarConcursos.busca));
      }

      const paginaRegistros = await repositorioNegocio.consultarPaginaRegistros(
        "Concurso",
        "ConcursoResponseModel",
        {
          filters: filtrosConsulta,
          order: [["nome"], ["idConcurso"]],
          offset:
            (solicitacaoListarConcursos.pagina - 1) *
            solicitacaoListarConcursos.quantidadePorPagina,
          limit: solicitacaoListarConcursos.quantidadePorPagina,
        },
      );

      return criarRespostaSucesso(
        {
          ...paginaRegistros,
          pagina: solicitacaoListarConcursos.pagina,
          quantidadePorPagina: solicitacaoListarConcursos.quantidadePorPagina,
        },
        "Concursos consultados.",
      );
    },

    async obterConcurso(solicitacaoObterConcurso: ContratosApi.ObterConcursoRequestModel) {
      await contextoAutorizacao.exigirUsuarioAtivo();

      validarIdentificador(solicitacaoObterConcurso.idConcurso, "concurso");

      return criarRespostaSucesso(
        await repositorioNegocio.obterRegistroObrigatorio(
          "Concurso",
          "ConcursoResponseModel",
          [criarFiltroIgualdade("idConcurso", solicitacaoObterConcurso.idConcurso)],
          "Concurso não encontrado.",
        ),
        "Concurso consultado.",
      );
    },

    async criarConcurso(solicitacaoCriarConcurso: ContratosApi.CriarConcursoRequestModel) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      const identificadorConcurso = randomUUID();

      const nome = validarTexto(solicitacaoCriarConcurso.nome, "Nome", 2, 200);

      if (solicitacaoCriarConcurso.ano < 1900 || solicitacaoCriarConcurso.ano > 2100) {
        throw new ErroRegraNegocioHttp("Informe um ano entre 1900 e 2100.");
      }

      if (!["ativo", "arquivado"].includes(solicitacaoCriarConcurso.status?.trim())) {
        throw new ErroRegraNegocioHttp("Status do concurso inválido.");
      }

      if (
        await repositorioNegocio.existeRegistro("Concurso", [
          criarFiltroIgualdadeSemDiferenciarMaiusculas("nome", nome),
        ])
      ) {
        throw new ErroRegraNegocioHttp("Já existe um concurso com esse nome.", 409);
      }

      const dadosPersistencia = {
        nome,
        orgao: solicitacaoCriarConcurso.orgao?.trim() ?? "",
        cargo: solicitacaoCriarConcurso.cargo?.trim() ?? "",
        estado: solicitacaoCriarConcurso.estado?.trim() ?? "",
        ano: solicitacaoCriarConcurso.ano,
        descricao: solicitacaoCriarConcurso.descricao?.trim() ?? null,
        status: solicitacaoCriarConcurso.status.trim(),
      };

      await repositorioNegocio.executarMutacaoRegistro(
        "Concurso",
        "insert",
        identificadorConcurso,
        {
          ...dadosPersistencia,
          idConcurso: identificadorConcurso,
          criado_em: new Date().toISOString(),
        },
      );

      return criarRespostaSucesso(
        projetarRespostaPeloContrato("ConcursoResponseModel", {
          ...{},
          ...dadosPersistencia,
          idConcurso: identificadorConcurso,
          criado_em: new Date().toISOString(),
        }),
        "Concurso criado.",
      );
    },

    async atualizarConcurso(
      solicitacaoAtualizarConcurso: ContratosApi.AtualizarConcursoRequestModel,
    ) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      const identificadorConcurso = solicitacaoAtualizarConcurso.idConcurso;

      validarIdentificador(identificadorConcurso, "concurso");

      const registroAnterior = await repositorioNegocio.obterRegistroObrigatorio(
        "Concurso",
        "ConcursoResponseModel",
        [criarFiltroIgualdade("idConcurso", identificadorConcurso)],
        "Concurso não encontrado.",
      );

      const nome = validarTexto(solicitacaoAtualizarConcurso.nome, "Nome", 2, 200);

      if (solicitacaoAtualizarConcurso.ano < 1900 || solicitacaoAtualizarConcurso.ano > 2100) {
        throw new ErroRegraNegocioHttp("Informe um ano entre 1900 e 2100.");
      }

      if (!["ativo", "arquivado"].includes(solicitacaoAtualizarConcurso.status?.trim())) {
        throw new ErroRegraNegocioHttp("Status do concurso inválido.");
      }

      if (
        await repositorioNegocio.existeRegistro("Concurso", [
          criarFiltroIgualdadeSemDiferenciarMaiusculas("nome", nome),
          criarFiltroDiferenca("idConcurso", identificadorConcurso),
        ])
      ) {
        throw new ErroRegraNegocioHttp("Já existe um concurso com esse nome.", 409);
      }

      const dadosPersistencia = {
        nome,
        orgao: solicitacaoAtualizarConcurso.orgao?.trim() ?? "",
        cargo: solicitacaoAtualizarConcurso.cargo?.trim() ?? "",
        estado: solicitacaoAtualizarConcurso.estado?.trim() ?? "",
        ano: solicitacaoAtualizarConcurso.ano,
        descricao: solicitacaoAtualizarConcurso.descricao?.trim() ?? null,
        status: solicitacaoAtualizarConcurso.status.trim(),
      };

      await repositorioNegocio.executarMutacaoRegistro(
        "Concurso",
        "update",
        identificadorConcurso,
        {
          ...dadosPersistencia,
        },
      );

      return criarRespostaSucesso(
        projetarRespostaPeloContrato("ConcursoResponseModel", {
          ...registroAnterior,
          ...dadosPersistencia,
          idConcurso: identificadorConcurso,
        }),
        "Concurso atualizado.",
      );
    },

    async excluirConcurso(solicitacaoExcluirConcurso: ContratosApi.ExcluirConcursoRequestModel) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      const identificadorConcurso = solicitacaoExcluirConcurso.idConcurso;

      validarIdentificador(identificadorConcurso, "concurso");

      const registroAnterior = await repositorioNegocio.obterRegistroObrigatorio(
        "Concurso",
        "ConcursoResponseModel",
        [criarFiltroIgualdade("idConcurso", identificadorConcurso)],
        "Concurso não encontrado.",
      );

      if (
        (await repositorioNegocio.existeRegistro("Questao", [
          criarFiltroIgualdade("idConcurso", identificadorConcurso),
        ])) ||
        (await repositorioNegocio.existeRegistro("Simulado", [
          criarFiltroIgualdade("idConcurso", identificadorConcurso),
        ]))
      ) {
        throw new ErroRegraNegocioHttp(
          "Este cadastro possui vínculos e não pode ser excluído.",
          409,
        );
      }

      await repositorioNegocio.executarMutacaoRegistro("Concurso", "delete", identificadorConcurso);

      return criarRespostaSucesso(registroAnterior, "Concurso excluído.");
    },
  };
}
