"""Controle de qualidade pós-Nextclade.

Toda sequência excluída vai para exclusao_qc com o motivo. Nada é descartado
em silêncio.
"""
from __future__ import annotations

COBERTURA_MINIMA = 0.70  # fração do genoma de referência coberta


def avaliar(linha: dict) -> tuple[bool, str | None, str | None]:
    """Recebe uma linha do TSV do Nextclade e devolve (aprovada, motivo, detalhe)."""
    erros = (linha.get("errors") or "").strip()
    if erros:
        return False, "erro_nextclade", erros[:500]
    try:
        cobertura = float(linha.get("coverage") or "nan")
    except ValueError:
        cobertura = float("nan")
    if cobertura != cobertura:  # NaN
        return False, "cobertura_ausente", None
    if cobertura < COBERTURA_MINIMA:
        return False, "cobertura_baixa", f"{cobertura:.3f} < {COBERTURA_MINIMA}"
    status = (linha.get("qc.overallStatus") or "").strip()
    if status == "bad":
        return False, "qc_nextclade_ruim", f"qc.overallScore={linha.get('qc.overallScore')}"
    return True, None, None
