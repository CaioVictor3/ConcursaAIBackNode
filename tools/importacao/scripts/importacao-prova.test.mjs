import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { validarImportacao } from "./importar-prova.mjs";

const idProva = "10000000-0000-4000-8000-000000000001";

const idTema = "20000000-0000-4000-8000-000000000001";

function criarDocumentoProvaTeste() {
  return {
    idProva,
    questoes: [
      {
        idTema,
        numero: 10,
        enunciado: "Enunciado de teste",
        statusGabarito: "definitivo",
        letraCorreta: "B",
        alternativas: [
          { letra: "A", texto: "Opção A" },
          { letra: "B", texto: "Opção B" },
        ],
      },
    ],
  };
}

describe("importação com os novos campos", () => {
  test("mantém número original e resolve o gabarito entre as alternativas", () => {
    const questaoImportada = validarImportacao(criarDocumentoProvaTeste()).questoes[0];

    assert.equal(questaoImportada.numero, 10);

    assert.equal(
      questaoImportada.idAlternativaCorreta,
      questaoImportada.alternativas[1].idAlternativa,
    );

    assert.equal(Object.hasOwn(questaoImportada, "nomeTema"), false);
  });

  test("não cria temas a partir de nomes ou questões sem prova", () => {
    assert.throws(
      () => validarImportacao({ ...criarDocumentoProvaTeste(), idProva: null }),
      /idProva/,
    );

    const documentoProva = criarDocumentoProvaTeste();

    documentoProva.questoes[0].idTema = "Endodontia";

    assert.throws(() => validarImportacao(documentoProva), /idTema/);
  });

  test("recusa numeração duplicada e gabarito alheio", () => {
    const documentoProva = criarDocumentoProvaTeste();

    documentoProva.questoes.push(structuredClone(documentoProva.questoes[0]));

    assert.throws(() => validarImportacao(documentoProva), /repetir/);

    const documentoGabarito = criarDocumentoProvaTeste();

    documentoGabarito.questoes[0].idAlternativaCorreta = idTema;

    assert.throws(() => validarImportacao(documentoGabarito), /gabarito/);
  });

  test("preserva IDs já revisados ao retomar uma importação", () => {
    const documentoProva = validarImportacao(criarDocumentoProvaTeste());

    documentoProva.questoes[0].idQuestao = "30000000-0000-4000-8000-000000000001";

    assert.deepEqual(validarImportacao(documentoProva), documentoProva);
  });

  test("aceita explicitamente gabarito pendente ou questão anulada", () => {
    for (const statusGabarito of ["pendente", "anulada"]) {
      const documentoProva = criarDocumentoProvaTeste();

      documentoProva.questoes[0].statusGabarito = statusGabarito;

      assert.equal(validarImportacao(documentoProva).questoes[0].idAlternativaCorreta, null);
    }
  });
});
