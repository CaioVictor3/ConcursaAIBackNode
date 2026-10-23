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

export function operacoesCadastroAssuntos(
  contextoAutorizacao: ServicoAutorizacaoUsuarioAutenticado,
) {
  const repositorioNegocio = contextoAutorizacao.repo;

  return {
    async listarAssuntos(solicitacaoListarAssuntos: ContratosApi.ListarAssuntosRequestModel) {
      await contextoAutorizacao.exigirUsuarioAtivo();

      validarPaginacao(
        solicitacaoListarAssuntos.pagina,
        solicitacaoListarAssuntos.quantidadePorPagina,
      );

      const filtrosConsulta = [];

      if (solicitacaoListarAssuntos.busca?.trim()) {
        filtrosConsulta.push(criarFiltroContemTexto("nome", solicitacaoListarAssuntos.busca));
      }

      if (solicitacaoListarAssuntos.idDisciplina !== null) {
        filtrosConsulta.push(
          criarFiltroIgualdade("idDisciplina", solicitacaoListarAssuntos.idDisciplina),
        );
      }

      const paginaRegistros = await repositorioNegocio.consultarPaginaRegistros(
        "Assunto",
        "AssuntoResponseModel",
        {
          filters: filtrosConsulta,
          order: [["nome"], ["idAssunto"]],
          offset:
            (solicitacaoListarAssuntos.pagina - 1) * solicitacaoListarAssuntos.quantidadePorPagina,
          limit: solicitacaoListarAssuntos.quantidadePorPagina,
        },
      );

      return criarRespostaSucesso(
        {
          ...paginaRegistros,
          pagina: solicitacaoListarAssuntos.pagina,
          quantidadePorPagina: solicitacaoListarAssuntos.quantidadePorPagina,
        },
        "Assuntos consultados.",
      );
    },

    async obterAssunto(solicitacaoObterAssunto: ContratosApi.ObterAssuntoRequestModel) {
      await contextoAutorizacao.exigirUsuarioAtivo();

      validarIdentificador(solicitacaoObterAssunto.idAssunto, "assunto");

      return criarRespostaSucesso(
        await repositorioNegocio.obterRegistroObrigatorio(
          "Assunto",
          "AssuntoResponseModel",
          [criarFiltroIgualdade("idAssunto", solicitacaoObterAssunto.idAssunto)],
          "Assunto não encontrado.",
        ),
        "Assunto consultado.",
      );
    },

    async criarAssunto(solicitacaoCriarAssunto: ContratosApi.CriarAssuntoRequestModel) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      const identificadorAssunto = randomUUID();

      const nome = validarTexto(solicitacaoCriarAssunto.nome, "Nome", 2, 200);

      validarIdentificador(solicitacaoCriarAssunto.idDisciplina, "uma disciplina");

      if (
        !(await repositorioNegocio.existeRegistro("Disciplina", [
          criarFiltroIgualdade("idDisciplina", solicitacaoCriarAssunto.idDisciplina),
        ]))
      ) {
        throw new ErroRegraNegocioHttp("Disciplina não encontrada.", 404);
      }

      const visited = new Set<string>();

      let ancestor = solicitacaoCriarAssunto.idAssuntoPai;

      while (ancestor !== null) {
        if (visited.has(ancestor) || ancestor === identificadorAssunto) {
          throw new ErroRegraNegocioHttp("A hierarquia do assunto não pode conter ciclos.");
        }

        visited.add(ancestor);

        const parent = await repositorioNegocio.obterRegistroOpcional(
          "Assunto",
          "AssuntoResponseModel",
          [
            criarFiltroIgualdade("idAssunto", ancestor),
            criarFiltroIgualdade("idDisciplina", solicitacaoCriarAssunto.idDisciplina),
          ],
        );

        if (!parent) {
          throw new ErroRegraNegocioHttp("O assunto pai deve pertencer à mesma disciplina.");
        }

        ancestor = parent.idAssuntoPai;
      }

      if (
        await repositorioNegocio.existeRegistro("Assunto", [
          criarFiltroIgualdadeSemDiferenciarMaiusculas("nome", nome),
          criarFiltroIgualdade("idDisciplina", solicitacaoCriarAssunto.idDisciplina),
        ])
      ) {
        throw new ErroRegraNegocioHttp("Já existe um assunto com esse nome.", 409);
      }

      const dadosPersistencia = {
        nome,
        idDisciplina: solicitacaoCriarAssunto.idDisciplina,
        idAssuntoPai: solicitacaoCriarAssunto.idAssuntoPai,
        descricao: solicitacaoCriarAssunto.descricao?.trim() ?? null,
      };

      await repositorioNegocio.executarMutacaoRegistro("Assunto", "insert", identificadorAssunto, {
        ...dadosPersistencia,
        idAssunto: identificadorAssunto,
        criado_em: new Date().toISOString(),
      });

      return criarRespostaSucesso(
        projetarRespostaPeloContrato("AssuntoResponseModel", {
          ...{},
          ...dadosPersistencia,
          idAssunto: identificadorAssunto,
          criado_em: new Date().toISOString(),
        }),
        "Assunto criado.",
      );
    },

    async atualizarAssunto(solicitacaoAtualizarAssunto: ContratosApi.AtualizarAssuntoRequestModel) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      const identificadorAssunto = solicitacaoAtualizarAssunto.idAssunto;

      validarIdentificador(identificadorAssunto, "assunto");

      const registroAnterior = await repositorioNegocio.obterRegistroObrigatorio(
        "Assunto",
        "AssuntoResponseModel",
        [criarFiltroIgualdade("idAssunto", identificadorAssunto)],
        "Assunto não encontrado.",
      );

      const nome = validarTexto(solicitacaoAtualizarAssunto.nome, "Nome", 2, 200);

      validarIdentificador(solicitacaoAtualizarAssunto.idDisciplina, "uma disciplina");

      if (
        !(await repositorioNegocio.existeRegistro("Disciplina", [
          criarFiltroIgualdade("idDisciplina", solicitacaoAtualizarAssunto.idDisciplina),
        ]))
      ) {
        throw new ErroRegraNegocioHttp("Disciplina não encontrada.", 404);
      }

      const visited = new Set<string>();

      let ancestor = solicitacaoAtualizarAssunto.idAssuntoPai;

      while (ancestor !== null) {
        if (visited.has(ancestor) || ancestor === identificadorAssunto) {
          throw new ErroRegraNegocioHttp("A hierarquia do assunto não pode conter ciclos.");
        }

        visited.add(ancestor);

        const parent = await repositorioNegocio.obterRegistroOpcional(
          "Assunto",
          "AssuntoResponseModel",
          [
            criarFiltroIgualdade("idAssunto", ancestor),
            criarFiltroIgualdade("idDisciplina", solicitacaoAtualizarAssunto.idDisciplina),
          ],
        );

        if (!parent) {
          throw new ErroRegraNegocioHttp("O assunto pai deve pertencer à mesma disciplina.");
        }

        ancestor = parent.idAssuntoPai;
      }

      if (
        await repositorioNegocio.existeRegistro("Assunto", [
          criarFiltroIgualdadeSemDiferenciarMaiusculas("nome", nome),
          criarFiltroIgualdade("idDisciplina", solicitacaoAtualizarAssunto.idDisciplina),
          criarFiltroDiferenca("idAssunto", identificadorAssunto),
        ])
      ) {
        throw new ErroRegraNegocioHttp("Já existe um assunto com esse nome.", 409);
      }

      const dadosPersistencia = {
        nome,
        idDisciplina: solicitacaoAtualizarAssunto.idDisciplina,
        idAssuntoPai: solicitacaoAtualizarAssunto.idAssuntoPai,
        descricao: solicitacaoAtualizarAssunto.descricao?.trim() ?? null,
      };

      await repositorioNegocio.executarMutacaoRegistro("Assunto", "update", identificadorAssunto, {
        ...dadosPersistencia,
      });

      return criarRespostaSucesso(
        projetarRespostaPeloContrato("AssuntoResponseModel", {
          ...registroAnterior,
          ...dadosPersistencia,
          idAssunto: identificadorAssunto,
        }),
        "Assunto atualizado.",
      );
    },

    async excluirAssunto(solicitacaoExcluirAssunto: ContratosApi.ExcluirAssuntoRequestModel) {
      await contextoAutorizacao.exigirAdministradorAtivo();

      const identificadorAssunto = solicitacaoExcluirAssunto.idAssunto;

      validarIdentificador(identificadorAssunto, "assunto");

      const registroAnterior = await repositorioNegocio.obterRegistroObrigatorio(
        "Assunto",
        "AssuntoResponseModel",
        [criarFiltroIgualdade("idAssunto", identificadorAssunto)],
        "Assunto não encontrado.",
      );

      if (
        (await repositorioNegocio.existeRegistro("Questao", [
          criarFiltroIgualdade("idAssunto", identificadorAssunto),
        ])) ||
        (await repositorioNegocio.existeRegistro("Assunto", [
          criarFiltroIgualdade("idAssuntoPai", identificadorAssunto),
        ]))
      ) {
        throw new ErroRegraNegocioHttp(
          "Este cadastro possui vínculos e não pode ser excluído.",
          409,
        );
      }

      await repositorioNegocio.executarMutacaoRegistro("Assunto", "delete", identificadorAssunto);

      return criarRespostaSucesso(registroAnterior, "Assunto excluído.");
    },
  };
}
