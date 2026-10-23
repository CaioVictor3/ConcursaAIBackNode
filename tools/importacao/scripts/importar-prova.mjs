import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const formatoIdentificadorUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const identificadorUuidValido = (identificadorUuid) =>
  typeof identificadorUuid === "string" &&
  formatoIdentificadorUuid.test(identificadorUuid) &&
  identificadorUuid !== "00000000-0000-0000-0000-000000000000";

export function validarImportacao(documentoProva) {
  if (!identificadorUuidValido(documentoProva.idProva)) {
    throw new Error("Cadastre a prova com ano, órgão e organizadora e informe seu idProva.");
  }

  if (!Array.isArray(documentoProva.questoes) || !documentoProva.questoes.length) {
    throw new Error("Informe as questões da prova.");
  }

  const numerosQuestoes = new Set();

  const identificadoresQuestoes = new Set();

  const identificadoresAlternativas = new Set();

  const questoesValidadas = documentoProva.questoes.map((questaoImportada) => {
    if (!identificadorUuidValido(questaoImportada.idTema)) {
      throw new Error(
        `Questão ${questaoImportada.numero}: selecione um idTema do catálogo existente.`,
      );
    }

    if (
      !Number.isSafeInteger(questaoImportada.numero) ||
      questaoImportada.numero < 1 ||
      numerosQuestoes.has(questaoImportada.numero)
    ) {
      throw new Error("Os números originais devem ser positivos e não podem se repetir na prova.");
    }

    numerosQuestoes.add(questaoImportada.numero);

    if (
      questaoImportada.idQuestao &&
      (!identificadorUuidValido(questaoImportada.idQuestao) ||
        identificadoresQuestoes.has(questaoImportada.idQuestao))
    ) {
      throw new Error("idQuestao inválido ou repetido.");
    }

    if (questaoImportada.idQuestao) {
      identificadoresQuestoes.add(questaoImportada.idQuestao);
    }

    if (
      typeof questaoImportada.enunciado !== "string" ||
      !questaoImportada.enunciado.trim() ||
      questaoImportada.enunciado.length > 24000
    ) {
      throw new Error(`Questão ${questaoImportada.numero}: enunciado inválido.`);
    }

    if (
      !Array.isArray(questaoImportada.alternativas) ||
      questaoImportada.alternativas.length < 2 ||
      questaoImportada.alternativas.length > 10
    ) {
      throw new Error(`Questão ${questaoImportada.numero}: informe entre 2 e 10 alternativas.`);
    }

    const letrasAlternativas = new Set();

    const textosAlternativas = new Set();

    const alternativasValidadas = questaoImportada.alternativas.map(
      (alternativaImportada, indiceAlternativa) => {
        const idAlternativa = alternativaImportada.idAlternativa ?? randomUUID();

        const letra = alternativaImportada.letra?.trim().toUpperCase();

        const texto = alternativaImportada.texto?.trim();

        if (
          !identificadorUuidValido(idAlternativa) ||
          identificadoresAlternativas.has(idAlternativa) ||
          !/^[A-J]$/.test(letra ?? "") ||
          letrasAlternativas.has(letra) ||
          !texto ||
          texto.length > 8000 ||
          textosAlternativas.has(texto.toLocaleLowerCase("pt-BR"))
        ) {
          throw new Error(
            `Questão ${questaoImportada.numero}: alternativas inválidas ou repetidas.`,
          );
        }

        identificadoresAlternativas.add(idAlternativa);

        letrasAlternativas.add(letra);

        textosAlternativas.add(texto.toLocaleLowerCase("pt-BR"));

        return { idAlternativa, letra, texto, ordem: indiceAlternativa + 1 };
      },
    );

    const statusGabarito = questaoImportada.statusGabarito ?? "pendente";

    if (!["pendente", "anulada", "provisorio", "definitivo"].includes(statusGabarito)) {
      throw new Error(`Questão ${questaoImportada.numero}: situação de gabarito inválida.`);
    }

    const idAlternativaCorreta =
      questaoImportada.idAlternativaCorreta ??
      alternativasValidadas.find(
        (alternativaImportada) =>
          alternativaImportada.letra === questaoImportada.letraCorreta?.toUpperCase(),
      )?.idAlternativa ??
      null;

    if (
      !["pendente", "anulada"].includes(statusGabarito) &&
      !alternativasValidadas.some(
        (alternativaImportada) => alternativaImportada.idAlternativa === idAlternativaCorreta,
      )
    ) {
      throw new Error(`Questão ${questaoImportada.numero}: gabarito fora das alternativas.`);
    }

    const status = questaoImportada.status ?? "rascunho";

    const dificuldade = questaoImportada.dificuldade ?? "nao_informada";

    if (
      !["rascunho", "publicada", "arquivada"].includes(status) ||
      !["facil", "media", "dificil", "nao_informada"].includes(dificuldade)
    ) {
      throw new Error(`Questão ${questaoImportada.numero}: status ou dificuldade inválidos.`);
    }

    return {
      ...(questaoImportada.idQuestao ? { idQuestao: questaoImportada.idQuestao } : {}),
      idProva: documentoProva.idProva,
      idTema: questaoImportada.idTema,
      numero: questaoImportada.numero,
      enunciado: questaoImportada.enunciado.trim(),
      alternativas: alternativasValidadas,
      statusGabarito,
      idAlternativaCorreta: ["pendente", "anulada"].includes(statusGabarito)
        ? null
        : idAlternativaCorreta,
      dificuldade,
      status,
      fonte: questaoImportada.fonte ?? "",
      imagemUrl: questaoImportada.imagemUrl ?? null,
      explicacao: questaoImportada.explicacao ?? "",
    };
  });

  return { idProva: documentoProva.idProva, questoes: questoesValidadas };
}

async function executar() {
  const caminhoArquivoEntrada = process.argv[2];

  if (!caminhoArquivoEntrada) {
    throw new Error(
      "Uso: node tools/importacao/scripts/importar-prova.mjs prova.json [--aplicar]. Sem --aplicar, apenas valida o arquivo.",
    );
  }

  const documentoProva = validarImportacao(JSON.parse(readFileSync(caminhoArquivoEntrada, "utf8")));

  if (!process.argv.includes("--aplicar")) {
    console.log(
      `${documentoProva.questoes.length} questões válidas no arquivo. Referências serão conferidas no backend ao aplicar.`,
    );

    return;
  }

  const urlApi = new URL(process.env.CONCURSA_API_URL ?? "http://127.0.0.1:3000");

  if (urlApi.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(urlApi.hostname)) {
    throw new Error("Use HTTPS para enviar credenciais fora do ambiente local.");
  }

  const tokenAdministrador = process.env.CONCURSA_IMPORT_TOKEN;

  if (!tokenAdministrador) {
    throw new Error(
      "Informe um token temporário de administrador em CONCURSA_IMPORT_TOKEN. Não utilize service_role.",
    );
  }

  async function consultarApiBackend(rota, metodo = "GET", dados) {
    const resposta = await fetch(new URL(rota, urlApi), {
      method: metodo,
      redirect: "error",
      headers: {
        Authorization: `Bearer ${tokenAdministrador}`,
        "Content-Type": "application/json",
      },
      ...(dados ? { body: JSON.stringify(dados) } : {}),
    });

    const conteudoRespostaJson = await resposta.json();

    if (!resposta.ok || !conteudoRespostaJson.success) {
      throw new Error(conteudoRespostaJson.message ?? `Falha HTTP ${resposta.status}`);
    }

    return conteudoRespostaJson.data;
  }
  // Nenhuma escrita antes de conferir toda a classificação e a prova no servidor.

  const [prova, temas] = await Promise.all([
    consultarApiBackend(`/api/Prova/obter-prova?idProva=${documentoProva.idProva}`),
    consultarApiBackend("/api/Prova/listar-temas"),
  ]);

  if (!prova.idOrganizadora || !prova.orgao || !prova.ano || prova.composicaoConfirmada) {
    throw new Error(
      "A prova precisa ter metadados completos e composição ainda não confirmada para importar.",
    );
  }

  if (
    documentoProva.questoes.some(
      (questaoImportada) =>
        !temas.itens.some((temaCadastrado) => temaCadastrado.idTema === questaoImportada.idTema),
    )
  ) {
    throw new Error(
      "Há temas inexistentes. Selecione os IDs do catálogo; a importação não cria temas.",
    );
  }

  const caminhoArquivoProgresso = `${caminhoArquivoEntrada}.progresso.json`;

  writeFileSync(caminhoArquivoProgresso, JSON.stringify(documentoProva, null, 2) + "\n");

  for (const questaoImportada of documentoProva.questoes) {
    try {
      const questaoPersistida = await consultarApiBackend(
        `/api/Questao/${questaoImportada.idQuestao ? "atualizar-questao" : "criar-questao"}`,
        questaoImportada.idQuestao ? "PUT" : "POST",
        questaoImportada,
      );

      questaoImportada.idQuestao = questaoPersistida.idQuestao;

      writeFileSync(caminhoArquivoProgresso, JSON.stringify(documentoProva, null, 2) + "\n");

      console.log(`Questão ${questaoImportada.numero} importada: ${questaoImportada.idQuestao}`);
    } catch (erroCapturado) {
      throw new Error(
        `Importação interrompida na questão ${questaoImportada.numero}: ${erroCapturado.message}. Os IDs salvos estão em ${caminhoArquivoProgresso}; retome usando esse arquivo.`,
      );
    }
  }

  console.log(
    "Importação concluída. Revise todas as questões e confirme a composição original na tela de provas.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  executar().catch((erroCapturado) => {
    console.error(erroCapturado.message);

    process.exitCode = 1;
  });
}
