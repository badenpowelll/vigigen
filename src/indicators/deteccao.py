"""Detecção de mudança no perfil de linhagens (regras R1, R2, R3).

Entrada: contagens por (território, trimestre, linhagem) vindas de
classificacao + sequencia, e a cobertura de sequenciamento por trimestre.
Saída: alertas com status "novo". Nenhum alerta se confirma sozinho; a
revisão é humana (tabela alerta, coluna status, com auditoria).

Parâmetros da tese, explícitos para a avaliação:
  JANELA_TRIMESTRES = 8   histórico usado como referência
  MIN_SEQUENCIAS    = 10  abaixo disso o trimestre não sustenta proporção
  Z                 = 1.96 (IC 95% de Wilson)
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

JANELA_TRIMESTRES = 8
MIN_SEQUENCIAS = 10
Z = 1.96
QUEDA_COBERTURA = 0.5  # R3: cobertura atual abaixo de metade da mediana da janela


def wilson(k: int, n: int, z: float = Z) -> tuple[float, float]:
    if n == 0:
        return (math.nan, math.nan)
    p = k / n
    den = 1 + z * z / n
    centro = (p + z * z / (2 * n)) / den
    meia = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (max(0.0, centro - meia), min(1.0, centro + meia))


@dataclass
class Alerta:
    regra: str
    territorio: str
    periodo: str
    evidencia: dict = field(default_factory=dict)


def trimestres_anteriores(periodo: str, n: int) -> list[str]:
    ano, t = int(periodo[:4]), int(periodo[-1])
    out = []
    for _ in range(n):
        t -= 1
        if t == 0:
            ano, t = ano - 1, 4
        out.append(f"{ano}T{t}")
    return out


def detectar(contagens: dict[tuple[str, str], dict[str, int]], cobertura: dict[tuple[str, str], float | None],
             territorio: str, periodo: str) -> list[Alerta]:
    """contagens[(territorio, periodo)] = {linhagem: n}; cobertura[(territorio, periodo)] = fração ou None."""
    atual = contagens.get((territorio, periodo), {})
    n_atual = sum(atual.values())
    janela = trimestres_anteriores(periodo, JANELA_TRIMESTRES)
    hist: dict[str, int] = {}
    for p in janela:
        for lin, n in contagens.get((territorio, p), {}).items():
            hist[lin] = hist.get(lin, 0) + n
    n_hist = sum(hist.values())
    alertas: list[Alerta] = []

    # R1: linhagem presente agora e ausente em toda a janela
    for lin, n in atual.items():
        if hist.get(lin, 0) == 0 and n_hist > 0:
            alertas.append(Alerta("R1_linhagem_nova", territorio, periodo,
                                  {"linhagem": lin, "n_atual": n, "n_janela": n_hist, "janela": janela}))

    # R2: proporção atual com IC de Wilson acima do IC da janela
    if n_atual >= MIN_SEQUENCIAS and n_hist >= MIN_SEQUENCIAS:
        for lin, k in atual.items():
            ic_a = wilson(k, n_atual)
            ic_h = wilson(hist.get(lin, 0), n_hist)
            if ic_a[0] > ic_h[1]:
                alertas.append(Alerta("R2_crescimento_proporcao", territorio, periodo, {
                    "linhagem": lin, "proporcao_atual": k / n_atual, "ic_atual": ic_a,
                    "proporcao_janela": hist.get(lin, 0) / n_hist, "ic_janela": ic_h,
                    "n_atual": n_atual, "n_janela": n_hist}))

    # R3: cobertura do trimestre muito abaixo da mediana da janela
    cob = cobertura.get((territorio, periodo))
    hist_cob = sorted(c for p in janela if (c := cobertura.get((territorio, p))) is not None)
    if cob is not None and hist_cob:
        med = hist_cob[len(hist_cob) // 2] if len(hist_cob) % 2 else (hist_cob[len(hist_cob) // 2 - 1] + hist_cob[len(hist_cob) // 2]) / 2
        if med > 0 and cob < QUEDA_COBERTURA * med:
            alertas.append(Alerta("R3_queda_cobertura", territorio, periodo,
                                  {"cobertura": cob, "mediana_janela": med, "limiar": QUEDA_COBERTURA}))
    return alertas


ESTADO = "RN"  # território estadual; municípios usam o geocódigo IBGE em texto


def montar_contagens(linhas) -> dict[tuple[str, str], dict[str, int]]:
    """linhas: (geocodigo | None, periodo 'AAAAT#', linhagem). Cada sequência conta no
    município (se houver) e sempre no estado."""
    c: dict[tuple[str, str], dict[str, int]] = {}
    for geo, periodo, lin in linhas:
        for terr in ([str(geo)] if geo is not None else []) + [ESTADO]:
            d = c.setdefault((terr, periodo), {})
            d[lin] = d.get(lin, 0) + 1
    return c


def trimestres_entre(inicio: str, fim: str) -> list[str]:
    """Inclusivo nos dois extremos, em ordem."""
    out, p = [], fim
    while p >= inicio:
        out.append(p)
        p = trimestres_anteriores(p, 1)[0]
    return out[::-1]


def parametros() -> dict:
    return {"janela_trimestres": JANELA_TRIMESTRES, "min_sequencias": MIN_SEQUENCIAS,
            "z_wilson": Z, "queda_cobertura": QUEDA_COBERTURA}
