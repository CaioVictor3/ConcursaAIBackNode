import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  criarRespostaSucesso,
  ErroRegraNegocioHttp,
} from "../domain/erros-validacoes-respostas-api.js";

const credenciaisInvalidas = "E-mail ou senha incorretos. Confira seus dados e tente novamente.";

type Perfil = {
  idUsuario: string;
  idPessoa: string;
  nome_completo: string;
  email: string;
  tipo: string;
  estado_cadastro: string;
  cadastro_completo: boolean;
  criado_em: string;
  ultimo_acesso_em: string | null;
};

async function perfilUsuario(supabase: SupabaseClient, usuario: User) {
  const { data, error } = await supabase
    .from("usuarios")
    .select(
      "idUsuario,idPessoa,nome_completo,email,tipo,estado_cadastro,cadastro_completo,criado_em,ultimo_acesso_em",
    )
    .eq("idUsuario", usuario.id)
    .single<Perfil>();

  if (error?.code === "42501") {
    throw new ErroRegraNegocioHttp(
      "O acesso aos dados da conta está temporariamente indisponível.",
      503,
    );
  }

  if (error || !data) {
    throw new ErroRegraNegocioHttp(
      "Sua conta não está disponível. Entre em contato com o suporte.",
      403,
    );
  }

  return {
    idUsuario: data.idUsuario,
    idPessoa: data.idPessoa,
    nomeCompleto: data.nome_completo,
    email: data.email,
    tipo: data.tipo,
    estadoCadastro: data.estado_cadastro,
    cadastroCompleto: data.cadastro_completo,
    dataHoraCadastro: data.criado_em,
    dataHoraUltimoAcesso: data.ultimo_acesso_em,
  };
}

export function correspondeRotaAutenticacaoSupabase(metodo: string, caminho: string) {
  return (
    (metodo === "POST" &&
      [
        "/api/Navegador/entrar-estudante",
        "/api/Navegador/entrar-administrador",
        "/api/Navegador/renovar-sessao",
        "/api/Navegador/sair-sessao",
      ].includes(caminho)) ||
    (metodo === "GET" && caminho === "/api/Usuario/obter-meu-usuario")
  );
}

export async function atenderAutenticacaoSupabaseNext(
  metodo: string,
  caminho: string,
  supabase: SupabaseClient,
  lerCorpo: () => Promise<unknown>,
) {
  if (
    caminho === "/api/Navegador/entrar-estudante" ||
    caminho === "/api/Navegador/entrar-administrador"
  ) {
    const dados = await lerCorpo();
    if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
      throw new ErroRegraNegocioHttp(credenciaisInvalidas, 401);
    }
    const { email, senha } = dados as Record<string, unknown>;
    if (typeof email !== "string" || typeof senha !== "string" || !email.trim() || !senha) {
      throw new ErroRegraNegocioHttp(credenciaisInvalidas, 401);
    }

    const resultado = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: senha,
    });
    if (resultado.error || !resultado.data.user || !resultado.data.session) {
      throw new ErroRegraNegocioHttp(credenciaisInvalidas, 401);
    }
    let usuario: Awaited<ReturnType<typeof perfilUsuario>>;
    try {
      usuario = await perfilUsuario(supabase, resultado.data.user);
    } catch (erro) {
      await supabase.auth.signOut();
      if (erro instanceof ErroRegraNegocioHttp && erro.status === 503) throw erro;
      throw new ErroRegraNegocioHttp(credenciaisInvalidas, 401);
    }
    const tipoExigido = caminho.endsWith("entrar-administrador") ? "administrador" : "estudante";
    if (
      usuario.tipo !== tipoExigido ||
      usuario.estadoCadastro !== "ativo" ||
      !usuario.cadastroCompleto
    ) {
      await supabase.auth.signOut();
      throw new ErroRegraNegocioHttp(credenciaisInvalidas, 401);
    }
    return criarRespostaSucesso(
      { usuario, expiresIn: resultado.data.session.expires_in },
      "Acesso realizado.",
    );
  }

  if (metodo === "POST" && caminho === "/api/Navegador/sair-sessao") {
    await supabase.auth.signOut();
    return criarRespostaSucesso({ mensagem: "Sessão encerrada." }, "Sessão encerrada.");
  }

  const autenticado = await supabase.auth.getUser();
  if (autenticado.error || !autenticado.data.user) {
    throw new ErroRegraNegocioHttp("Entre na sua conta para continuar.", 401);
  }
  const usuario = await perfilUsuario(supabase, autenticado.data.user);

  if (metodo === "GET") {
    return criarRespostaSucesso(usuario, "Perfil consultado.");
  }

  const sessao = await supabase.auth.getSession();
  return criarRespostaSucesso(
    {
      usuario,
      expiresIn: Math.max(
        0,
        (sessao.data.session?.expires_at ?? 0) - Math.floor(Date.now() / 1000),
      ),
    },
    "Sessão renovada.",
  );
}
