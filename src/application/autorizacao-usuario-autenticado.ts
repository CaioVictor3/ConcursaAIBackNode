import type { UsuarioResponseModel } from "../contracts/modelos-requisicoes-respostas-api.js";
import { ErroRegraNegocioHttp } from "../domain/erros-validacoes-respostas-api.js";
import type { RepositorioConsultasNegocioPostgreSql } from "../infrastructure/repositorio-consultas-postgresql.js";
import { criarFiltroIgualdade } from "../infrastructure/repositorio-consultas-postgresql.js";

export class ServicoAutorizacaoUsuarioAutenticado {
  private account?: UsuarioResponseModel;

  constructor(readonly repo: RepositorioConsultasNegocioPostgreSql) {}

  async exigirUsuarioAtivo() {
    if (!this.repo.user.id) {
      throw new ErroRegraNegocioHttp("Entre na sua conta para continuar.", 401);
    }

    this.account ??= await this.repo.obterRegistroObrigatorio(
      "Usuario",
      "UsuarioResponseModel",
      [criarFiltroIgualdade("idUsuario", this.repo.user.id)],
      "Conta não encontrada.",
    );

    if (this.account.estadoCadastro !== "ativo") {
      throw new ErroRegraNegocioHttp("Confirme o cadastro da sua conta para continuar.", 403);
    }

    return this.account;
  }

  async exigirAdministradorAtivo() {
    const usuarioAutenticado = await this.exigirUsuarioAtivo();

    if (usuarioAutenticado.tipo !== "administrador") {
      throw new ErroRegraNegocioHttp("Você não possui permissão para esta operação.", 403);
    }

    return usuarioAutenticado;
  }

  async exigirEstudanteComCadastroCompleto() {
    const usuarioAutenticado = await this.exigirUsuarioAtivo();

    if (usuarioAutenticado.tipo !== "estudante" || !usuarioAutenticado.cadastroCompleto) {
      throw new ErroRegraNegocioHttp("É necessário um cadastro de estudante completo.", 403);
    }

    return usuarioAutenticado;
  }
}
