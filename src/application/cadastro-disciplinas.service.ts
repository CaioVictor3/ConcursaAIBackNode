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

export function operacoesCadastroDisciplinas(
  contextoAutorizacao: ServicoAutorizacaoUsuarioAutenticado,
) {
  const repositorioNegocio = contextoAutorizacao.repo;

  return {
    async listarDisciplinas(
      solicitacaoListarDisciplinas: ContratosApi.ListarDisciplinasRequestModel,
    ) {
      await contextoAutorizacao.exigirUsuarioAtivo();

      validarPaginacao(
        solicitacaoListarDisciplinas.pagina,
        solicitacaoListarDisciplinas.quantidadePorPagina,
      );

      const filtrosConsulta = [];

      if (solicitacaoListarDisciplinas.busca?.trim()) {
        filtrosConsulta.push(criarFiltroContemTexto("nome", solicitacaoListarDisciplinas.busca));
      }

      const paginaRegistros = await repositorioNegocio.consultarPaginaRegistros(
        "Disciplina",
        "DisciplinaResponseModel",
        {
          filters: filtrosConsulta,
          order: [["nome"], ["idDisciplina"]],
          offset:
            (solicitacaoListarDisciplinas.pagina - 1) *
            solicitacaoListarDisciplinas.quantidadePorPagina,
          limit: solicitacaoListarDisciplinas.quantidadePorPagina,
        },
      );

      return criarRespostaSucesso(
        {
          ...paginaRegistros,
          pagina: solicitacaoListarDisciplinas.pagina,
          quantidadePorPagina: solicitacaoListarDisciplinas.quantidadePorPagina,
        },
        "Disciplinas consultadas.",
      );
    },

    async obterDisciplina(solicitacaoObterDisciplina: ContratosApi.ObterDisciplinaRequestModel) {
      await contextoAutorizacao.exigirUsuarioAtivo();

      validarIdentificador(solicitacaoObterDisciplina.idDisciplina, "disciplina");

      return criarRespostaSucesso(
        await repositorioNegocio.obterRegistroObrigatorio(
          "Disciplina",
          "DisciplinaResponseModel",
          [criarFiltroIgualdade("idDisciplina", solicitacaoObterDisciplina.idDisciplina)],
          "Disciplina não encontrada.",
        ),
        "Disciplina consultada.",
      );
    },

    async criarDisciplina(solicitacaoCriarDisciplina: ContratosApi.CriarDisciplinaRequestModel) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      const identificadorDisciplina = randomUUID();

      const nome = validarTexto(solicitacaoCriarDisciplina.nome, "Nome", 2, 200);

      if (
        await repositorioNegocio.existeRegistro("Disciplina", [
          criarFiltroIgualdadeSemDiferenciarMaiusculas("nome", nome),
        ])
      ) {
        throw new ErroRegraNegocioHttp("Já existe uma disciplina com esse nome.", 409);
      }

      const dadosPersistencia = {
        nome,
        descricao: solicitacaoCriarDisciplina.descricao?.trim() ?? "",
        ativa: solicitacaoCriarDisciplina.ativa,
        area: solicitacaoCriarDisciplina.area?.trim() ?? null,
      };

      await repositorioNegocio.executarMutacaoRegistro(
        "Disciplina",
        "insert",
        identificadorDisciplina,
        {
          ...dadosPersistencia,
          idDisciplina: identificadorDisciplina,
          criado_em: new Date().toISOString(),
        },
      );

      return criarRespostaSucesso(
        projetarRespostaPeloContrato("DisciplinaResponseModel", {
          ...{},
          ...dadosPersistencia,
          idDisciplina: identificadorDisciplina,
          criado_em: new Date().toISOString(),
        }),
        "Disciplina criada.",
      );
    },

    async atualizarDisciplina(
      solicitacaoAtualizarDisciplina: ContratosApi.AtualizarDisciplinaRequestModel,
    ) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      const identificadorDisciplina = solicitacaoAtualizarDisciplina.idDisciplina;

      validarIdentificador(identificadorDisciplina, "disciplina");

      const registroAnterior = await repositorioNegocio.obterRegistroObrigatorio(
        "Disciplina",
        "DisciplinaResponseModel",
        [criarFiltroIgualdade("idDisciplina", identificadorDisciplina)],
        "Disciplina não encontrada.",
      );

      const nome = validarTexto(solicitacaoAtualizarDisciplina.nome, "Nome", 2, 200);

      if (
        await repositorioNegocio.existeRegistro("Disciplina", [
          criarFiltroIgualdadeSemDiferenciarMaiusculas("nome", nome),
          criarFiltroDiferenca("idDisciplina", identificadorDisciplina),
        ])
      ) {
        throw new ErroRegraNegocioHttp("Já existe uma disciplina com esse nome.", 409);
      }

      const dadosPersistencia = {
        nome,
        descricao: solicitacaoAtualizarDisciplina.descricao?.trim() ?? "",
        ativa: solicitacaoAtualizarDisciplina.ativa,
        area: solicitacaoAtualizarDisciplina.area?.trim() ?? null,
      };

      await repositorioNegocio.executarMutacaoRegistro(
        "Disciplina",
        "update",
        identificadorDisciplina,
        {
          ...dadosPersistencia,
        },
      );

      return criarRespostaSucesso(
        projetarRespostaPeloContrato("DisciplinaResponseModel", {
          ...registroAnterior,
          ...dadosPersistencia,
          idDisciplina: identificadorDisciplina,
        }),
        "Disciplina atualizada.",
      );
    },

    async desativarDisciplina(
      solicitacaoDesativarDisciplina: ContratosApi.DesativarDisciplinaRequestModel,
    ) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      validarIdentificador(solicitacaoDesativarDisciplina.idDisciplina, "disciplina");

      const registroAnterior = await repositorioNegocio.obterRegistroObrigatorio(
        "Disciplina",
        "DisciplinaResponseModel",
        [criarFiltroIgualdade("idDisciplina", solicitacaoDesativarDisciplina.idDisciplina)],
        "Disciplina não encontrada.",
      );

      await repositorioNegocio.executarMutacaoRegistro(
        "Disciplina",
        "update",
        solicitacaoDesativarDisciplina.idDisciplina,
        {
          nome: registroAnterior.nome,
          descricao: registroAnterior.descricao,
          ativa: false,
          area: registroAnterior.area,
        },
      );

      return criarRespostaSucesso({ ...registroAnterior, ativa: false }, "Disciplina desativada.");
    },
  };
}
