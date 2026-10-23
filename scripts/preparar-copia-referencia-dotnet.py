"""Cria uma cópia isolada da API .NET para os testes de paridade HTTP."""

from pathlib import Path
from shutil import copytree


RAIZ_BACKEND_NODE = Path(__file__).resolve().parents[1]
PASTA_ORIGEM_DOTNET = RAIZ_BACKEND_NODE.parent / "ConcursaAI.BackEnd"
PASTA_COPIA_DESCARTAVEL = RAIZ_BACKEND_NODE / ".tmp" / "dotnet-reference"


def ignorar_arquivos_locais(_diretorio: str, nomes: list[str]) -> list[str]:
    """Evita copiar artefatos de build e configurações privadas."""

    diretorios_descartados = {"obj", "bin", "artifacts"}
    configuracoes_privadas = {"appsettings.Local.json"}

    return [
        nome
        for nome in nomes
        if nome.startswith(".")
        or nome in diretorios_descartados
        or nome in configuracoes_privadas
    ]


def preparar_copia_referencia() -> None:
    if PASTA_COPIA_DESCARTAVEL.exists():
        return

    if not PASTA_ORIGEM_DOTNET.is_dir():
        raise FileNotFoundError(
            f"Backend .NET de origem não encontrado: {PASTA_ORIGEM_DOTNET}"
        )

    copytree(
        PASTA_ORIGEM_DOTNET,
        PASTA_COPIA_DESCARTAVEL,
        ignore=ignorar_arquivos_locais,
    )


if __name__ == "__main__":
    preparar_copia_referencia()
