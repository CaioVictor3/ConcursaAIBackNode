import type * as ContratosApi from "../contracts/modelos-requisicoes-respostas-api.js";
import { EMPTY_UUID, ErroRegraNegocioHttp } from "../domain/erros-validacoes-respostas-api.js";

export function validarCotasTemasSimulado(
  solicitacaoCriarSimuladoFiltrado: ContratosApi.CriarSimuladoFiltradoRequestModel,
) {
  if (solicitacaoCriarSimuladoFiltrado.idTema === EMPTY_UUID) {
    throw new ErroRegraNegocioHttp("Informe um tema válido.");
  }

  if (
    !solicitacaoCriarSimuladoFiltrado.cotasTemas ||
    solicitacaoCriarSimuladoFiltrado.cotasTemas.length > 25
  ) {
    throw new ErroRegraNegocioHttp("Informe uma distribuição com até 25 temas.");
  }

  if (
    solicitacaoCriarSimuladoFiltrado.idTema !== null &&
    solicitacaoCriarSimuladoFiltrado.cotasTemas.length
  ) {
    throw new ErroRegraNegocioHttp("Escolha um único tema ou distribua as questões por tema.");
  }

  if (
    solicitacaoCriarSimuladoFiltrado.cotasTemas.some(
      (cotaTema) =>
        !cotaTema ||
        cotaTema.idTema === EMPTY_UUID ||
        cotaTema.quantidade < 0 ||
        cotaTema.quantidade > 500,
    )
  ) {
    throw new ErroRegraNegocioHttp("Informe temas válidos e quantidades entre 0 e 500.");
  }

  if (
    new Set(solicitacaoCriarSimuladoFiltrado.cotasTemas.map((cotaTema) => cotaTema.idTema)).size !==
    solicitacaoCriarSimuladoFiltrado.cotasTemas.length
  ) {
    throw new ErroRegraNegocioHttp("Há temas repetidos na distribuição.");
  }

  if (
    solicitacaoCriarSimuladoFiltrado.cotasTemas.reduce(
      (quantidadeAcumulada, cotaTema) => quantidadeAcumulada + cotaTema.quantidade,
      0,
    ) > solicitacaoCriarSimuladoFiltrado.quantidade
  ) {
    throw new ErroRegraNegocioHttp("A soma das quantidades por tema excede o total de questões.");
  }
}

export function validarCotasAssuntosSimulado(
  solicitacaoGerarSimuladoPersonalizado: ContratosApi.GerarSimuladoPersonalizadoRequestModel,
  disponibilidadeAssuntos: ContratosApi.DisponibilidadeAssuntoResponseModel[],
) {
  if (
    solicitacaoGerarSimuladoPersonalizado.quantidade < 1 ||
    solicitacaoGerarSimuladoPersonalizado.quantidade >
      disponibilidadeAssuntos.reduce(
        (quantidadeAcumulada, disponibilidadeAssunto) =>
          quantidadeAcumulada + disponibilidadeAssunto.quantidade,
        0,
      )
  ) {
    throw new ErroRegraNegocioHttp("A quantidade solicitada excede o acervo disponível.");
  }

  if (
    new Set(
      solicitacaoGerarSimuladoPersonalizado.cotasAssuntos.map(
        (cotaAssunto) => cotaAssunto.idAssunto,
      ),
    ).size !== solicitacaoGerarSimuladoPersonalizado.cotasAssuntos.length
  ) {
    throw new ErroRegraNegocioHttp("Há assuntos repetidos na distribuição.");
  }

  for (const cotaAssunto of solicitacaoGerarSimuladoPersonalizado.cotasAssuntos) {
    const assuntoDisponivel = disponibilidadeAssuntos.find(
      (disponibilidadeAssunto) => disponibilidadeAssunto.idAssunto === cotaAssunto.idAssunto,
    );

    if (!assuntoDisponivel) {
      throw new ErroRegraNegocioHttp("Assunto indisponível para este treino.");
    }

    if (cotaAssunto.quantidade < 0 || cotaAssunto.quantidade > assuntoDisponivel.quantidade) {
      throw new ErroRegraNegocioHttp("Uma cota excede a quantidade disponível no assunto.");
    }
  }

  const quantidadeTotal = solicitacaoGerarSimuladoPersonalizado.cotasAssuntos.reduce(
    (quantidadeAcumulada, cotaAssunto) => quantidadeAcumulada + cotaAssunto.quantidade,
    0,
  );

  const quantidadeDisponivelSemCota = disponibilidadeAssuntos
    .filter(
      (disponibilidadeAssunto) =>
        !solicitacaoGerarSimuladoPersonalizado.cotasAssuntos.some(
          (cotaAssunto) => cotaAssunto.idAssunto === disponibilidadeAssunto.idAssunto,
        ),
    )
    .reduce(
      (quantidadeAcumulada, disponibilidadeAssunto) =>
        quantidadeAcumulada + disponibilidadeAssunto.quantidade,
      0,
    );

  if (
    quantidadeTotal > solicitacaoGerarSimuladoPersonalizado.quantidade ||
    solicitacaoGerarSimuladoPersonalizado.quantidade - quantidadeTotal > quantidadeDisponivelSemCota
  ) {
    throw new ErroRegraNegocioHttp("A distribuição não permite completar o total solicitado.");
  }
}
