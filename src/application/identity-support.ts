import type * as M from "../contracts/models.js";
import { Context } from "./context.js";
import { eq, contains, type Filter } from "../infrastructure/repository.js";
import {
  identifier,
  text,
  pagination,
  ServiceError,
  success,
} from "../domain/errors.js";
import { validatePerson } from "../domain/person.js";
export function identityHandlers(ctx: Context) {
  const r = ctx.repo;
  const account = async (_q: M.ObterMinhaContaRequestModel) => {
    const u = await ctx.user();
    return success(
      {
        usuario: await r.one(
          "Usuario",
          "UsuarioResponseModel",
          [eq("idUsuario", u.idUsuario)],
          "Conta não encontrada.",
        ),
        pessoa: await r.rpcModel("obter_minha_pessoa", "PessoaResponseModel"),
      },
      "Dados da conta consultados.",
    );
  };
  return {
    obterMinhaConta: account,
    async atualizarMinhaConta(q: M.AtualizarMinhaContaRequestModel) {
      await ctx.user();
      const p = validatePerson(q);
      await r.rpc("salvar_minha_pessoa", {
        p_pessoa: { ...p, complemento: p.complemento ?? "" },
      });
      return account({});
    },
    async obterMeuUsuario(_q: M.ObterMeuUsuarioRequestModel) {
      if (!r.user.id)
        throw new ServiceError("Entre na sua conta para continuar.", 401);
      return success(
        await r.one(
          "Usuario",
          "UsuarioResponseModel",
          [eq("idUsuario", r.user.id)],
          "Conta não encontrada.",
        ),
        "Perfil consultado.",
      );
    },
    async obterUsuario(q: M.ObterUsuarioRequestModel) {
      await ctx.admin();
      identifier(q.idUsuario, "um usuário");
      return success(
        await r.one(
          "Usuario",
          "UsuarioResponseModel",
          [eq("idUsuario", q.idUsuario)],
          "Usuário não encontrado.",
        ),
        "Usuário consultado.",
      );
    },
    async listarUsuarios(q: M.ListarUsuariosRequestModel) {
      await ctx.admin();
      pagination(q.pagina, q.quantidadePorPagina);
      if (q.tipo && !["administrador", "estudante"].includes(q.tipo))
        throw new ServiceError("Tipo de usuário inválido.");
      const filters: Filter[] = [];
      if (q.tipo) filters.push(eq("tipo", q.tipo));
      if (q.busca?.trim()) filters.push(contains("nome_completo", q.busca));
      const result = await r.query("Usuario", "UsuarioResponseModel", {
        filters,
        order: [["nome_completo"], ["idUsuario"]],
        offset: (q.pagina - 1) * q.quantidadePorPagina,
        limit: q.quantidadePorPagina,
      });
      return success(
        {
          ...result,
          pagina: q.pagina,
          quantidadePorPagina: q.quantidadePorPagina,
        },
        "Usuários consultados.",
      );
    },
    async obterMetricasSistema(_q: M.ObterMetricasSistemaRequestModel) {
      await ctx.admin();
      const result = await r.rpcModel(
        "metricas_sistema",
        "MetricasSistemaResponseModel",
      );
      if (!result)
        throw new ServiceError("Não foi possível consultar as métricas.", 503);
      return success(result, "Métricas do sistema consultadas.");
    },
  };
}
export function supportHandlers(ctx: Context) {
  const r = ctx.repo;
  const get = async (q: M.ObterChamadoRequestModel) => {
    const u = await ctx.user();
    identifier(q.idChamado, "um chamado");
    const filters = [eq("idChamado", q.idChamado)];
    if (u.tipo !== "administrador") filters.push(eq("idPessoa", u.idPessoa));
    const c = await r.one(
      "ChamadoSuporte",
      "ChamadoSuporteResponseModel",
      filters,
      "Chamado não encontrado.",
    );
    c.mensagens = await r.all(
      "MensagemSuporte",
      "MensagemChamadoResponseModel",
      {
        filters: [eq("idChamado", c.idChamado)],
        order: [["criada_em"], ["idMensagem"]],
      },
    );
    return success(c, "Chamado consultado.");
  };
  return {
    obterChamado: get,
    async listarChamados(q: M.ListarChamadosRequestModel) {
      const u = await ctx.user();
      pagination(q.pagina, q.quantidadePorPagina);
      if (
        q.status &&
        ![
          "aberto",
          "aguardando_aluno",
          "aguardando_suporte",
          "finalizado",
        ].includes(q.status)
      )
        throw new ServiceError("Status do chamado inválido.");
      const filters: Filter[] = [];
      if (u.tipo !== "administrador") filters.push(eq("idPessoa", u.idPessoa));
      if (q.status) filters.push(eq("status", q.status));
      const result = await r.query(
        "ChamadoSuporte",
        "ChamadoSuporteResponseModel",
        {
          filters,
          order: [["atualizado_em", true], ["idChamado"]],
          offset: (q.pagina - 1) * q.quantidadePorPagina,
          limit: q.quantidadePorPagina,
        },
      );
      return success(
        {
          ...result,
          pagina: q.pagina,
          quantidadePorPagina: q.quantidadePorPagina,
        },
        "Chamados consultados.",
      );
    },
    async abrirChamado(q: M.AbrirChamadoRequestModel) {
      await ctx.student();
      const subject = text(q.assunto, "Assunto", 5, 120),
        message = text(q.mensagem, "Descrição", 10, 4000);
      if (!["acesso", "simulados", "desempenho", "outro"].includes(q.categoria))
        throw new ServiceError("Selecione uma categoria válida.");
      return get({
        idChamado: await r.rpc<string>("abrir_chamado_suporte", {
          p_assunto: subject,
          p_categoria: q.categoria,
          p_mensagem: message,
        }),
      });
    },
    async responderChamado(q: M.ResponderChamadoRequestModel) {
      const c = (await get(q)).data!;
      if (c.status === "finalizado")
        throw new ServiceError(
          "Um chamado finalizado não pode receber mensagens.",
          409,
        );
      const message = text(q.mensagem, "Mensagem", 1, 4000);
      await r.rpc("responder_chamado_suporte", {
        p_idchamado: q.idChamado,
        p_mensagem: message,
      });
      return get(q);
    },
    async finalizarChamado(q: M.FinalizarChamadoRequestModel) {
      await ctx.admin();
      const c = (await get(q)).data!;
      if (c.status === "finalizado")
        throw new ServiceError(
          "Este chamado já foi finalizado e não pode ser movimentado.",
          409,
        );
      const resolution = text(q.resolucao, "Solução", 10, 4000);
      await r.rpc("finalizar_chamado_suporte", {
        p_idchamado: q.idChamado,
        p_resolucao: resolution,
      });
      return get(q);
    },
  };
}
