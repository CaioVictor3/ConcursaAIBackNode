import { ServicoPerguntasContextuaisAnaliseQuestoesIA } from "../application/perguntas-contextuais-analise-questoes-ia.service.js";
import { ServicoSistemaHonraEstudantesAdministracao } from "../application/sistema-honra-estudantes-administracao.service.js";
import { ServicoSistemaHonraSupabase } from "../application/sistema-honra-supabase.service.js";
import { RepositorioConsultasNegocioSupabase } from "../infrastructure/repositorio-consultas-supabase.js";
import {
  criarRespostaSucesso,
  ErroRegraNegocioHttp,
} from "../domain/erros-validacoes-respostas-api.js";
import type { ClienteAnaliseQuestoesOpenAI } from "../infrastructure/cliente-analise-questoes-openai.js";
import type {
  ConexaoTransacoesPostgreSql,
  IdentidadeUsuarioAutenticado,
} from "../infrastructure/conexao-transacoes-postgresql.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function objeto(valor: unknown) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    throw new ErroRegraNegocioHttp("Envie um objeto JSON válido.");
  }
  return valor as Record<string, unknown>;
}

function texto(valor: unknown, campo: string, tamanho: number) {
  if (typeof valor !== "string" || !valor.trim() || valor.length > tamanho) {
    throw new ErroRegraNegocioHttp(`Informe ${campo} válido.`);
  }
  return valor.trim();
}

function textoOpcional(valor: unknown, campo: string, tamanho: number) {
  if (valor === undefined || valor === null) return "";
  if (typeof valor !== "string" || valor.length > tamanho) {
    throw new ErroRegraNegocioHttp(`Informe ${campo} válido.`);
  }
  return valor.trim();
}

function inteiro(valor: unknown, campo: string, minimo: number, maximo: number) {
  const numero = typeof valor === "string" && valor.trim() ? Number(valor) : valor;
  if (
    typeof numero !== "number" ||
    !Number.isInteger(numero) ||
    numero < minimo ||
    numero > maximo
  ) {
    throw new ErroRegraNegocioHttp(`Informe ${campo} válido.`);
  }
  return numero;
}

function booleano(valor: unknown, campo: string) {
  if (typeof valor !== "boolean") {
    throw new ErroRegraNegocioHttp(`Informe ${campo} válido.`);
  }
  return valor;
}

function identificador(valor: unknown, campo: string) {
  if (typeof valor !== "string" || !uuid.test(valor)) {
    throw new ErroRegraNegocioHttp(`Informe ${campo} válido.`);
  }
  return valor;
}

export function correspondeRotaAdicional(caminho: string) {
  return (
    caminho.startsWith("/api/honra/") ||
    caminho.startsWith("/api/estudo/estudante/painel-desempenho") ||
    caminho.startsWith("/api/estudo/questoes/") ||
    caminho.startsWith("/api/ia/estudante/questoes/")
  );
}

export async function atenderRotaAdicionalNext(
  requisicao: Request,
  caminho: string,
  usuario: IdentidadeUsuarioAutenticado,
  db: ConexaoTransacoesPostgreSql,
  openai: ClienteAnaliseQuestoesOpenAI,
  lerCorpo: () => Promise<unknown>,
  repositorio?: RepositorioConsultasNegocioSupabase,
): Promise<{ encontrada: boolean; resposta?: unknown }> {
  const metodo = requisicao.method;
  const url = new URL(requisicao.url);
  const pagina = () => inteiro(url.searchParams.get("pagina") ?? 1, "página", 1, 100_000);
  const tamanhoPagina = () =>
    inteiro(url.searchParams.get("quantidadePorPagina") ?? 20, "quantidade por página", 1, 50);
  const honra = repositorio
    ? new ServicoSistemaHonraSupabase(repositorio.supabase, repositorio)
    : new ServicoSistemaHonraEstudantesAdministracao(db, usuario);

  if (metodo === "GET" && caminho === "/api/honra/estudante/meu-progresso") {
    return {
      encontrada: true,
      resposta: criarRespostaSucesso(
        await honra.consultarProgressoEstudante(),
        "Progresso de Honra consultado.",
      ),
    };
  }
  if (metodo === "GET" && caminho === "/api/estudo/estudante/painel-desempenho") {
    return {
      encontrada: true,
      resposta: criarRespostaSucesso(
        await honra.consultarPainelDesempenhoEstudante(),
        "Painel de desempenho consultado.",
      ),
    };
  }
  if (metodo === "GET" && caminho === "/api/honra/estudante/historico-pontos") {
    return {
      encontrada: true,
      resposta: criarRespostaSucesso(
        await honra.consultarHistoricoEstudante(pagina(), tamanhoPagina()),
        "Histórico de Pontos de Honra consultado.",
      ),
    };
  }
  if (metodo === "GET" && caminho === "/api/honra/administracao/painel-sistema-honra") {
    return {
      encontrada: true,
      resposta: criarRespostaSucesso(
        await honra.consultarPainelAdministrativo(),
        "Painel de Honra consultado.",
      ),
    };
  }

  const historico = caminho.match(
    /^\/api\/honra\/administracao\/estudantes\/([^/]+)\/historico-pontos$/,
  );
  if (metodo === "GET" && historico) {
    const idPessoa = identificador(historico[1], "identificador do estudante");
    return {
      encontrada: true,
      resposta: criarRespostaSucesso(
        await honra.consultarHistoricoAdministrativo(idPessoa, pagina(), tamanhoPagina()),
        "Histórico do estudante consultado.",
      ),
    };
  }
  if (metodo === "POST" && caminho === "/api/honra/administracao/titulos-honra") {
    const dados = objeto(await lerCorpo());
    const id =
      dados.id === undefined ? undefined : identificador(dados.id, "identificador do título");
    const titulo = {
      ...(id ? { id } : {}),
      nivel: inteiro(dados.nivel, "nível", 1, 1000),
      nome: texto(dados.nome, "nome do título", 100),
      descricao: textoOpcional(dados.descricao, "descrição do título", 1000),
      pontuacaoMinima: inteiro(dados.pontuacaoMinima, "pontuação mínima", 0, 10_000_000),
      icone: texto(dados.icone, "ícone do título", 50),
      cor: texto(dados.cor, "cor do título", 7),
      ativo: booleano(dados.ativo, "status do título"),
    };
    const salvo = await honra.salvarTitulo(titulo);
    return {
      encontrada: true,
      resposta: criarRespostaSucesso({ id: salvo }, "Título de Honra salvo."),
    };
  }

  const regra = caminho.match(/^\/api\/honra\/administracao\/regras-pontuacao\/([^/]+)$/);
  if (metodo === "PUT" && regra) {
    const dados = objeto(await lerCorpo());
    const codigo = texto(decodeURIComponent(regra[1]!), "código da regra", 100);
    await honra.salvarRegra(codigo, {
      pontos: inteiro(dados.pontos, "pontos", 0, 10_000),
      minimoQuestoes: inteiro(dados.minimoQuestoes, "mínimo de questões", 0, 100_000),
      minimoQuestoesIneditas: inteiro(
        dados.minimoQuestoesIneditas,
        "mínimo de questões inéditas",
        0,
        100_000,
      ),
      percentualMinimoRespostas: inteiro(
        dados.percentualMinimoRespostas,
        "percentual mínimo de respostas",
        0,
        100,
      ),
      limiteDiario: inteiro(dados.limiteDiario, "limite diário", 0, 1000),
      ativo: booleano(dados.ativo, "status da regra"),
    });
    return {
      encontrada: true,
      resposta: criarRespostaSucesso({ codigo }, "Regra de pontuação salva."),
    };
  }
  const ajuste = caminho.match(
    /^\/api\/honra\/administracao\/estudantes\/([^/]+)\/ajustes-pontos$/,
  );
  if (metodo === "POST" && ajuste) {
    const dados = objeto(await lerCorpo());
    const idPessoa = identificador(ajuste[1], "identificador do estudante");
    await honra.ajustarPontos(
      idPessoa,
      inteiro(dados.pontos, "pontos do ajuste", -10_000, 10_000),
      texto(dados.justificativa, "justificativa", 1000),
    );
    return {
      encontrada: true,
      resposta: criarRespostaSucesso({ ajustado: true }, "Ajuste de Pontos de Honra registrado."),
    };
  }
  const anotacao = caminho.match(/^\/api\/estudo\/questoes\/([^/]+)\/anotacao-pessoal$/);
  if (anotacao && ["GET", "PUT"].includes(metodo)) {
    const idQuestao = identificador(anotacao[1], "identificador da questão");
    if (metodo === "GET") {
      return {
        encontrada: true,
        resposta: criarRespostaSucesso(
          await honra.consultarAnotacaoQuestao(idQuestao),
          "Anotação consultada.",
        ),
      };
    }
    const dados = objeto(await lerCorpo());
    const conteudo = textoOpcional(dados.conteudo, "conteúdo da anotação", 10_000);
    return {
      encontrada: true,
      resposta: criarRespostaSucesso(
        await honra.salvarAnotacaoQuestao(idQuestao, conteudo),
        conteudo ? "Anotação salva." : "Anotação excluída.",
      ),
    };
  }

  const historicoIa = caminho.match(
    /^\/api\/ia\/estudante\/questoes\/([^/]+)\/historico-perguntas$/,
  );
  const perguntaIa = caminho.match(
    /^\/api\/ia\/estudante\/questoes\/([^/]+)\/perguntas-contextuais$/,
  );
  if ((metodo === "GET" && historicoIa) || (metodo === "POST" && perguntaIa)) {
    const idQuestao = identificador((historicoIa ?? perguntaIa)?.[1], "a questão");
    const ia = new ServicoPerguntasContextuaisAnaliseQuestoesIA(db, usuario, openai, repositorio);
    if (metodo === "GET") {
      const idTentativa = identificador(url.searchParams.get("idTentativa"), "a tentativa");
      return {
        encontrada: true,
        resposta: criarRespostaSucesso(
          await ia.consultarHistorico(idTentativa, idQuestao),
          "Histórico de perguntas consultado.",
        ),
      };
    }
    const dados = objeto(await lerCorpo());
    const idTentativa = identificador(dados.idTentativa, "a tentativa");
    const pergunta = dados.pergunta;
    if (typeof pergunta !== "string" || pergunta.trim().length < 5 || pergunta.length > 1000) {
      throw new ErroRegraNegocioHttp("A pergunta deve ter entre 5 e 1000 caracteres.");
    }
    return {
      encontrada: true,
      resposta: criarRespostaSucesso(
        await ia.responderPergunta(idTentativa, idQuestao, pergunta.trim()),
        "Pergunta respondida e salva.",
      ),
    };
  }

  return { encontrada: false };
}
