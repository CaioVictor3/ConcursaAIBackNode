import type { Repository } from "../infrastructure/repository.js";
import { eq } from "../infrastructure/repository.js";
import type { UsuarioResponseModel } from "../contracts/models.js";
import { ServiceError } from "../domain/errors.js";
export class Context {
  private account?: UsuarioResponseModel;
  constructor(readonly repo: Repository) {}
  async user() {
    if (!this.repo.user.id)
      throw new ServiceError("Entre na sua conta para continuar.", 401);
    this.account ??= await this.repo.one(
      "Usuario",
      "UsuarioResponseModel",
      [eq("idUsuario", this.repo.user.id)],
      "Conta não encontrada.",
    );
    if (this.account.estadoCadastro !== "ativo")
      throw new ServiceError(
        "Confirme o cadastro da sua conta para continuar.",
        403,
      );
    return this.account;
  }
  async admin() {
    const u = await this.user();
    if (u.tipo !== "administrador")
      throw new ServiceError(
        "Você não possui permissão para esta operação.",
        403,
      );
    return u;
  }
  async student() {
    const u = await this.user();
    if (u.tipo !== "estudante" || !u.cadastroCompleto)
      throw new ServiceError(
        "É necessário um cadastro de estudante completo.",
        403,
      );
    return u;
  }
}
