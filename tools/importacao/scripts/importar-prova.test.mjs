import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { validarImportacao } from "./importar-prova.mjs"
const idProva = "10000000-0000-4000-8000-000000000001", idTema = "20000000-0000-4000-8000-000000000001"
function documento() { return { idProva, questoes: [{ idTema, numero: 10, enunciado: "Enunciado de teste", statusGabarito: "definitivo", letraCorreta: "B", alternativas: [{ letra: "A", texto: "Opção A" }, { letra: "B", texto: "Opção B" }] }] } }
describe("importação com os novos campos", () => {
  test("mantém número original e resolve o gabarito entre as alternativas", () => {
    const q = validarImportacao(documento()).questoes[0]
    assert.equal(q.numero, 10)
    assert.equal(q.idAlternativaCorreta, q.alternativas[1].idAlternativa)
    assert.equal(Object.hasOwn(q, "nomeTema"), false)
  })
  test("não cria temas a partir de nomes ou questões sem prova", () => {
    assert.throws(() => validarImportacao({ ...documento(), idProva: null }), /idProva/)
    const d = documento(); d.questoes[0].idTema = "Endodontia"
    assert.throws(() => validarImportacao(d), /idTema/)
  })
  test("recusa numeração duplicada e gabarito alheio", () => {
    const d = documento(); d.questoes.push(structuredClone(d.questoes[0]))
    assert.throws(() => validarImportacao(d), /repetir/)
    const g = documento(); g.questoes[0].idAlternativaCorreta = idTema
    assert.throws(() => validarImportacao(g), /gabarito/)
  })
  test("preserva IDs já revisados ao retomar uma importação", () => {
    const d = validarImportacao(documento()); d.questoes[0].idQuestao = "30000000-0000-4000-8000-000000000001"
    assert.deepEqual(validarImportacao(d), d)
  })
  test("aceita explicitamente gabarito pendente ou questão anulada", () => {
    for (const statusGabarito of ["pendente", "anulada"]) {
      const d = documento(); d.questoes[0].statusGabarito = statusGabarito
      assert.equal(validarImportacao(d).questoes[0].idAlternativaCorreta, null)
    }
  })
})
