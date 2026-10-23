// Contratos de Administracao preservados da API .NET.

export interface MetricasSistemaResponseModel {
  alunos: number;
  administradores: number;
  alunosAtivos: number;
  acessos30Dias: number;
  questoesPublicadas: number;
  simuladosGerados: number;
  tentativasFinalizadas: number;
  chamadosPendentes: number;
  chamadosFinalizados: number;
}

export interface ObterMetricasSistemaRequestModel {}
