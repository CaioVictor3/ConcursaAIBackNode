export interface TituloHonra {
  id: string;
  nivel: number;
  nome: string;
  descricao: string;
  pontuacaoMinima: number;
  icone: string;
  cor: string;
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

export interface RegraPontuacaoHonra {
  codigo: string;
  descricao: string;
  pontos: number;
  minimoQuestoes: number;
  minimoQuestoesIneditas: number;
  percentualMinimoRespostas: number;
  limiteDiario: number;
  ativo: boolean;
  atualizadoEm: string;
}

export interface MovimentacaoHonra {
  id: number;
  codigoRegra: string | null;
  tipoOrigem: string;
  idOrigem: string;
  pontos: number;
  descricao: string;
  justificativa: string | null;
  criadoEm: string;
}

export interface ProgressoHonraEstudante {
  pontosAcumulados: number;
  pontosSemana: number;
  pontosMes: number;
  diasConsecutivos: number;
  questoesIneditasPontuadas: number;
  tituloAtual: TituloHonra;
  proximoTitulo: TituloHonra | null;
  pontosParaProximoTitulo: number;
  percentualProgressoTitulo: number;
  titulos: TituloHonra[];
}

export interface PainelAdministrativoHonra {
  titulos: TituloHonra[];
  regras: RegraPontuacaoHonra[];
  totalEstudantesParticipantes: number;
  totalPontosConcedidos: number;
  distribuicaoTitulos: { titulo: string; estudantes: number }[];
  pontosPorAtividade: { atividade: string; pontos: number }[];
  evolucaoParticipacao: { dia: string; estudantesAtivos: number; novosParticipantes: number }[];
  movimentacoesRecentes: (MovimentacaoHonra & { idPessoa: string })[];
}

export interface PainelDesempenhoEstudante {
  totalRespostas: number;
  questoesUnicasResolvidas: number;
  questoesRevisadas: number;
  acertosTentativas: number;
  errosTentativas: number;
  respostasEmBrancoTentativas: number;
  percentualAcertos: number;
  provasConcluidas: number;
  simuladosConcluidos: number;
  atividadesEmAndamento: number;
  tempoEstudoMinutos: number;
  pontosHonra: number;
  desempenhoPorTema: {
    idTema: string;
    nomeTema: string;
    avaliadas: number;
    acertos: number;
    erros: number;
    percentualAcertos: number;
  }[];
  evolucaoDiaria: {
    dia: string;
    tentativasConcluidas: number;
    respostas: number;
    acertos: number;
    percentualAcertos: number;
  }[];
}
