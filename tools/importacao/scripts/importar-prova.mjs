import 'dotenv/config'
import { readFileSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const idValido = id => typeof id === "string" && uuid.test(id) && id !== "00000000-0000-0000-0000-000000000000"
export function validarImportacao(documento) {
  if (!idValido(documento.idProva)) throw new Error("Cadastre a prova com ano, órgão e organizadora e informe seu idProva.")
  if (!Array.isArray(documento.questoes) || !documento.questoes.length) throw new Error("Informe as questões da prova.")
  const numeros = new Set(), ids = new Set(), alternativas = new Set()
  const questoes = documento.questoes.map(q => {
    if (!idValido(q.idTema)) throw new Error(`Questão ${q.numero}: selecione um idTema do catálogo existente.`)
    if (!Number.isSafeInteger(q.numero) || q.numero < 1 || numeros.has(q.numero)) throw new Error("Os números originais devem ser positivos e não podem se repetir na prova.")
    numeros.add(q.numero)
    if (q.idQuestao && (!idValido(q.idQuestao) || ids.has(q.idQuestao))) throw new Error("idQuestao inválido ou repetido.")
    if (q.idQuestao) ids.add(q.idQuestao)
    if (typeof q.enunciado !== "string" || !q.enunciado.trim() || q.enunciado.length > 24000) throw new Error(`Questão ${q.numero}: enunciado inválido.`)
    if (!Array.isArray(q.alternativas) || q.alternativas.length < 2 || q.alternativas.length > 10) throw new Error(`Questão ${q.numero}: informe entre 2 e 10 alternativas.`)
    const letras = new Set(), textos = new Set()
    const opcoes = q.alternativas.map((a, i) => {
      const idAlternativa = a.idAlternativa ?? randomUUID(), letra = a.letra?.trim().toUpperCase(), texto = a.texto?.trim()
      if (!idValido(idAlternativa) || alternativas.has(idAlternativa) || !/^[A-J]$/.test(letra ?? "") || letras.has(letra) || !texto || texto.length > 8000 || textos.has(texto.toLocaleLowerCase("pt-BR"))) throw new Error(`Questão ${q.numero}: alternativas inválidas ou repetidas.`)
      alternativas.add(idAlternativa); letras.add(letra); textos.add(texto.toLocaleLowerCase("pt-BR"))
      return { idAlternativa, letra, texto, ordem: i + 1 }
    })
    const statusGabarito = q.statusGabarito ?? "pendente"
    if (!["pendente", "anulada", "provisorio", "definitivo"].includes(statusGabarito)) throw new Error(`Questão ${q.numero}: situação de gabarito inválida.`)
    const idAlternativaCorreta = q.idAlternativaCorreta ?? opcoes.find(a => a.letra === q.letraCorreta?.toUpperCase())?.idAlternativa ?? null
    if (!["pendente", "anulada"].includes(statusGabarito) && !opcoes.some(a => a.idAlternativa === idAlternativaCorreta)) throw new Error(`Questão ${q.numero}: gabarito fora das alternativas.`)
    const status = q.status ?? "rascunho", dificuldade = q.dificuldade ?? "nao_informada"
    if (!["rascunho", "publicada", "arquivada"].includes(status) || !["facil", "media", "dificil", "nao_informada"].includes(dificuldade)) throw new Error(`Questão ${q.numero}: status ou dificuldade inválidos.`)
    return { ...(q.idQuestao ? { idQuestao: q.idQuestao } : {}), idProva: documento.idProva, idTema: q.idTema, numero: q.numero, enunciado: q.enunciado.trim(), alternativas: opcoes,
      statusGabarito, idAlternativaCorreta: ["pendente", "anulada"].includes(statusGabarito) ? null : idAlternativaCorreta, dificuldade, status,
      fonte: q.fonte ?? "", imagemUrl: q.imagemUrl ?? null, explicacao: q.explicacao ?? "" }
  })
  return { idProva: documento.idProva, questoes }
}
async function executar() {
  const arquivo = process.argv[2]
  if (!arquivo) throw new Error("Uso: node tools/importacao/scripts/importar-prova.mjs prova.json [--aplicar]. Sem --aplicar, apenas valida o arquivo.")
  const documento = validarImportacao(JSON.parse(readFileSync(arquivo, "utf8")))
  if (!process.argv.includes("--aplicar")) { console.log(`${documento.questoes.length} questões válidas no arquivo. Referências serão conferidas no backend ao aplicar.`); return }
  const origem = new URL(process.env.CONCURSA_API_URL ?? "http://127.0.0.1:3000")
  if (origem.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(origem.hostname)) throw new Error("Use HTTPS para enviar credenciais fora do ambiente local.")
  const token = process.env.CONCURSA_IMPORT_TOKEN
  if (!token) throw new Error("Informe um token temporário de administrador em CONCURSA_IMPORT_TOKEN. Não utilize service_role.")
  async function api(rota, metodo = "GET", dados) {
    const resposta = await fetch(new URL(rota, origem), { method: metodo, redirect: "error", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(dados ? { body: JSON.stringify(dados) } : {}) })
    const json = await resposta.json()
    if (!resposta.ok || !json.success) throw new Error(json.message ?? `Falha HTTP ${resposta.status}`)
    return json.data
  }
  // Nenhuma escrita antes de conferir toda a classificação e a prova no servidor.
  const [prova, temas] = await Promise.all([api(`/api/Prova/obter-prova?idProva=${documento.idProva}`), api("/api/Prova/listar-temas")])
  if (!prova.idOrganizadora || !prova.orgao || !prova.ano || prova.composicaoConfirmada) throw new Error("A prova precisa ter metadados completos e composição ainda não confirmada para importar.")
  if (documento.questoes.some(q => !temas.itens.some(t => t.idTema === q.idTema))) throw new Error("Há temas inexistentes. Selecione os IDs do catálogo; a importação não cria temas.")
  const saida = `${arquivo}.progresso.json`
  writeFileSync(saida, JSON.stringify(documento, null, 2) + "\n")
  for (const q of documento.questoes) {
    try {
      const salva = await api(`/api/Questao/${q.idQuestao ? "atualizar-questao" : "criar-questao"}`, q.idQuestao ? "PUT" : "POST", q)
      q.idQuestao = salva.idQuestao
      writeFileSync(saida, JSON.stringify(documento, null, 2) + "\n")
      console.log(`Questão ${q.numero} importada: ${q.idQuestao}`)
    } catch (e) { throw new Error(`Importação interrompida na questão ${q.numero}: ${e.message}. Os IDs salvos estão em ${saida}; retome usando esse arquivo.`) }
  }
  console.log("Importação concluída. Revise todas as questões e confirme a composição original na tela de provas.")
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) executar().catch(e => { console.error(e.message); process.exitCode = 1 })
