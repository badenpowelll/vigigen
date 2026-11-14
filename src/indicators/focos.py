"""Detecção de focos: aumento local (R4) e aglomerado espaço-temporal (R5).

Entrada: contagens semanais por território (hoje município, via InfoDengue;
no futuro setor censitário ou bairro, via public.exame_territorial).
Saída: sinais com evidência completa. Nenhum sinal vira alerta confirmado
sozinho; eles entram em public.alerta com status "novo" e a revisão é humana.

Parâmetros da tese, explícitos para a avaliação (D-016):

R4 aumento local, EARS C2 (Hutwagner et al., 2003):
  C2_BASE_INI, C2_BASE_FIM = 3, 9   linha de base: semanas t-3 a t-9 (7 semanas, 2 de folga)
  C2_LIMIAR   = 3.0                 desvios acima da média da linha de base
  C2_DP_MIN   = 1.0                 piso do desvio-padrão (série com linha de base constante)
  C2_MIN_CASOS = 5                  abaixo disso a semana não sustenta alerta

R5 aglomerado, varredura espaço-temporal prospectiva de Kulldorff, modelo de
permutação (Kulldorff et al., 2005, PLoS Med 2(3):e59):
  SCAN_JANELA_ESTUDO = 52           semanas do período de estudo (termina na semana avaliada)
  SCAN_MAX_VIZINHOS  = 10           tamanho máximo do círculo, em territórios
  SCAN_MAX_SEMANAS   = 4            duração máxima do cilindro (sempre terminando na semana avaliada)
  SCAN_REPLICAS      = 999          réplicas de Monte Carlo
  SCAN_RECORRENCIA_MIN = 52         intervalo de recorrência mínimo, em semanas (p <= 1/52)
  SCAN_MIN_CASOS     = 5            casos mínimos dentro do cilindro
  SCAN_MIN_TERRITORIOS = 2          R5 só vale para grupos; excesso num território só é papel de R4

Episódios (para não abrir um alerta por semana do mesmo foco):
  EPISODIO_SILENCIO = 4             um sinal abre episódio novo se o território ficou 4 semanas sem sinal

Repartição pelo local provável de infecção (fase com dado individual agregado):
  CENARIOS_RESIDENCIA = (1.0, 0.7, 0.5)  fração do caso que fica no território de residência
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

C2_BASE_INI, C2_BASE_FIM = 3, 9
C2_LIMIAR = 3.0
C2_DP_MIN = 1.0
C2_MIN_CASOS = 5

SCAN_JANELA_ESTUDO = 52
SCAN_MAX_VIZINHOS = 10
SCAN_MAX_SEMANAS = 4
SCAN_REPLICAS = 999
SCAN_RECORRENCIA_MIN = 52
SCAN_MIN_CASOS = 5
SCAN_MIN_TERRITORIOS = 2
EPISODIO_SILENCIO = 4

CENARIOS_RESIDENCIA = (1.0, 0.7, 0.5)

PARAMETROS = {
    "R4": {"metodo": "EARS C2", "base_semanas": [C2_BASE_INI, C2_BASE_FIM], "limiar_dp": C2_LIMIAR,
           "dp_min": C2_DP_MIN, "min_casos": C2_MIN_CASOS},
    "R5": {"metodo": "Kulldorff espaço-temporal prospectiva, modelo de permutação",
           "janela_estudo_semanas": SCAN_JANELA_ESTUDO, "max_vizinhos": SCAN_MAX_VIZINHOS,
           "max_semanas": SCAN_MAX_SEMANAS, "replicas": SCAN_REPLICAS,
           "recorrencia_min_semanas": SCAN_RECORRENCIA_MIN, "min_casos": SCAN_MIN_CASOS,
           "min_territorios": SCAN_MIN_TERRITORIOS},
    "episodio": {"silencio_semanas": EPISODIO_SILENCIO},
}


@dataclass
class Sinal:
    regra: str                      # R4_aumento_local | R5_aglomerado
    territorios: list[str]
    semana: int                     # SE no formato AAAASS da semana avaliada
    evidencia: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# R4: EARS C2 por território
# ---------------------------------------------------------------------------

def ears_c2(serie: list[float] | np.ndarray, t: int) -> dict | None:
    """Estatística C2 da posição t. None quando a linha de base não cabe na série."""
    if t - C2_BASE_FIM < 0:
        return None
    x = np.asarray(serie, dtype=float)
    base = x[t - C2_BASE_FIM: t - C2_BASE_INI + 1]
    if np.isnan(base).any() or math.isnan(x[t]):
        return None
    media = float(base.mean())
    dp = float(base.std(ddof=1))
    dp_usado = max(dp, C2_DP_MIN)
    c2 = (float(x[t]) - media) / dp_usado
    return {"observado": float(x[t]), "media_base": round(media, 3), "dp_base": round(dp, 3),
            "dp_usado": round(dp_usado, 3), "c2": round(c2, 3),
            "esperado_max": round(media + C2_LIMIAR * dp_usado, 3)}


def r4_aumento_local(series: dict[str, list[float]], semanas: list[int], t: int) -> list[Sinal]:
    """series[territorio] = contagens alinhadas a `semanas`; avalia a posição t."""
    out = []
    for terr, serie in series.items():
        e = ears_c2(serie, t)
        if e is None:
            continue
        if e["c2"] > C2_LIMIAR and e["observado"] >= C2_MIN_CASOS:
            e["semanas_base"] = [semanas[t - C2_BASE_FIM], semanas[t - C2_BASE_INI]]
            e["parametros"] = PARAMETROS["R4"]
            out.append(Sinal("R4_aumento_local", [terr], semanas[t], e))
    return out


# ---------------------------------------------------------------------------
# R5: varredura espaço-temporal de Kulldorff (permutação), prospectiva
# ---------------------------------------------------------------------------

def vizinhos_mais_proximos(coords: dict[str, tuple[float, float]], k: int = SCAN_MAX_VIZINHOS) -> dict[str, list[str]]:
    """Para cada território, ele mesmo e os k-1 mais próximos (lon/lat em graus, distância equiretangular)."""
    ids = list(coords)
    xy = np.array([coords[i] for i in ids], dtype=float)
    lat0 = math.radians(float(xy[:, 1].mean()))
    pts = np.column_stack([xy[:, 0] * math.cos(lat0), xy[:, 1]])
    d = np.sqrt(((pts[:, None, :] - pts[None, :, :]) ** 2).sum(-1))
    ordem = np.argsort(d, axis=1, kind="stable")[:, :k]
    return {ids[i]: [ids[j] for j in ordem[i]] for i in range(len(ids))}


def _llr(c: np.ndarray, mu: np.ndarray, total: float) -> np.ndarray:
    """Log-razão de verossimilhança do modelo de permutação (só excesso: c > mu)."""
    c = np.asarray(c, dtype=float)
    mu = np.asarray(mu, dtype=float)
    out = np.zeros(np.broadcast(c, mu).shape)
    ok = (c > mu) & (mu > 0)
    fora = total - c
    fora_mu = total - mu
    with np.errstate(divide="ignore", invalid="ignore"):
        a = np.where(ok, c * np.log(np.where(ok, c / mu, 1.0)), 0.0)
        b = np.where(ok & (fora > 0), fora * np.log(np.where(ok & (fora > 0), fora / fora_mu, 1.0)), 0.0)
    out[ok] = (a + b)[ok]
    return out


def _melhores_cilindros(ult: np.ndarray, esperado_ult: np.ndarray, nb: np.ndarray, total: float):
    """ult[z, L-1] = casos do território z nas últimas L semanas; idem esperado.
    Devolve LLR[centro, k-1, L-1] e os observados/esperados correspondentes."""
    obs = np.cumsum(ult[nb], axis=1)          # (n, K, Lmax)
    esp = np.cumsum(esperado_ult[nb], axis=1)
    return _llr(obs, esp, total), obs, esp


def r5_aglomerado(contagens: np.ndarray, territorios: list[str], semanas: list[int],
                  vizinhos: dict[str, list[str]], rng: np.random.Generator | None = None,
                  replicas: int = SCAN_REPLICAS) -> list[Sinal]:
    """contagens[z, d] (inteiros) para o período de estudo; a última coluna é a semana avaliada.

    Cilindros: círculo = centro + vizinhos mais próximos (1..K territórios);
    altura = últimas 1..SCAN_MAX_SEMANAS semanas. Esperado do modelo de
    permutação: mu_zd = C_z * C_d / C. Significância por Monte Carlo,
    permutando as semanas dos casos com as margens fixas.
    """
    rng = rng or np.random.default_rng(20261114)
    x = np.asarray(contagens, dtype=np.int64)
    n, D = x.shape
    total = int(x.sum())
    if total == 0:
        return []
    Lmax = min(SCAN_MAX_SEMANAS, D)
    idx = {t: i for i, t in enumerate(territorios)}
    K = min(SCAN_MAX_VIZINHOS, n)
    nb = np.array([[idx[v] for v in vizinhos[t][:K]] for t in territorios])

    Cz = x.sum(axis=1).astype(float)
    Cd = x.sum(axis=0).astype(float)
    cd_ult = np.cumsum(Cd[::-1][:Lmax])                       # casos do estado nas últimas L semanas
    esperado_ult = Cz[:, None] * cd_ult[None, :] / total       # (n, Lmax)
    ult = np.cumsum(x[:, ::-1][:, :Lmax], axis=1).astype(float)

    llr, obs, esp = _melhores_cilindros(ult, esperado_ult, nb, total)
    valido = (obs >= SCAN_MIN_CASOS) & (np.arange(K)[None, :, None] >= SCAN_MIN_TERRITORIOS - 1)
    llr = np.where(valido, llr, 0.0)

    # Monte Carlo: cada caso guarda o território e recebe uma semana sorteada
    # sem reposição entre as semanas observadas (margens C_z e C_d preservadas).
    terr_caso = np.repeat(np.arange(n), Cz.astype(np.int64))
    sem_caso = np.repeat(np.arange(D), Cd.astype(np.int64))
    max_rep = np.empty(replicas)
    for r in range(replicas):
        s = rng.permutation(sem_caso)
        recentes = s >= D - Lmax
        lag = (D - 1) - s[recentes]                            # 0 = semana avaliada
        tab = np.bincount(terr_caso[recentes] * Lmax + lag, minlength=n * Lmax).reshape(n, Lmax)
        ult_r = np.cumsum(tab, axis=1)
        l_r, o_r, _ = _melhores_cilindros(ult_r, esperado_ult, nb, total)
        valido_r = (o_r >= SCAN_MIN_CASOS) & (np.arange(K)[None, :, None] >= SCAN_MIN_TERRITORIOS - 1)
        max_rep[r] = np.where(valido_r, l_r, 0.0).max()

    # Aglomerados sem sobreposição, do maior LLR para o menor.
    cand = np.argwhere(llr > 0)
    ordem = np.argsort(-llr[tuple(cand.T)], kind="stable")
    usados: set[int] = set()
    out = []
    for i in ordem:
        c, k, L = cand[i]
        membros = [int(m) for m in nb[c, :k + 1]]
        if usados.intersection(membros):
            continue
        valor = float(llr[c, k, L])
        p = (1 + int((max_rep >= valor).sum())) / (replicas + 1)
        if p > 1 / SCAN_RECORRENCIA_MIN:
            break                                             # os seguintes têm LLR menor, p maior
        usados.update(membros)
        o, e = float(obs[c, k, L]), float(esp[c, k, L])
        out.append(Sinal("R5_aglomerado", [territorios[m] for m in membros], semanas[-1], {
            "centro": territorios[c], "semanas": [semanas[-1 - L], semanas[-1]],
            "observado": o, "esperado": round(e, 3), "razao_obs_esp": round(o / e, 3),
            "llr": round(valor, 4), "p_valor": round(p, 4),
            "recorrencia_semanas": round(1 / p, 1), "replicas": replicas,
            "periodo_estudo": [semanas[0], semanas[-1]], "casos_periodo": total,
            "parametros": PARAMETROS["R5"]}))
    return out


# ---------------------------------------------------------------------------
# Episódios: um alerta por foco, não um por semana
# ---------------------------------------------------------------------------

def episodios(ocorrencias: list[tuple[int, str]], semanas: list[int],
              silencio: int = EPISODIO_SILENCIO) -> list[dict]:
    """ocorrencias = [(semana, territorio)] de sinais (qualquer regra).

    Um sinal abre episódio quando o território não teve sinal nas `silencio`
    semanas anteriores; senão prolonga o episódio aberto. Só a abertura gera
    alerta novo; o prolongamento atualiza a evidência.
    """
    pos = {s: i for i, s in enumerate(semanas)}
    abertos: dict[str, dict] = {}
    out: list[dict] = []
    for sem, terr in sorted(set(ocorrencias), key=lambda o: (pos[o[0]], o[1])):
        ep = abertos.get(terr)
        if ep is not None and pos[sem] - pos[ep["fim"]] <= silencio:
            ep["fim"] = sem
            ep["semanas_com_sinal"] += 1
            continue
        ep = {"territorio": terr, "inicio": sem, "fim": sem, "semanas_com_sinal": 1}
        abertos[terr] = ep
        out.append(ep)
    return out


# ---------------------------------------------------------------------------
# Local provável de infecção: repartição e margem de erro
# ---------------------------------------------------------------------------

def repartir(casos_residencia: dict[str, float], vizinhos: dict[str, list[str]],
             deslocamento: dict[str, dict[str, float]] | None, fracao_residencia: float) -> dict[str, float]:
    """Reparte cada caso entre territórios.

    fracao_residencia fica no território de residência; o restante vai para os
    destinos de deslocamento (fração por destino, somando <= 1) e, o que
    sobrar, igualmente para os vizinhos imediatos (vizinhos[t][1:]).
    O total de casos é preservado.
    """
    out: dict[str, float] = {}
    for t, n in casos_residencia.items():
        if n == 0:
            continue
        out[t] = out.get(t, 0.0) + n * fracao_residencia
        resto = n * (1 - fracao_residencia)
        if resto == 0:
            continue
        destinos = (deslocamento or {}).get(t, {})
        soma = sum(destinos.values())
        for dest, f in destinos.items():
            out[dest] = out.get(dest, 0.0) + resto * f
        sobra = resto * (1 - soma)
        viz = [v for v in vizinhos.get(t, [t])[1:]] or [t]
        for v in viz:
            out[v] = out.get(v, 0.0) + sobra / len(viz)
    return out


def faixa_por_territorio(casos_residencia: dict[str, float], vizinhos: dict[str, list[str]],
                         deslocamento: dict[str, dict[str, float]] | None = None,
                         cenarios: tuple[float, ...] = CENARIOS_RESIDENCIA) -> dict[str, dict]:
    """Mínimo e máximo de casos atribuídos a cada território entre os cenários."""
    por_cenario = {f: repartir(casos_residencia, vizinhos, deslocamento, f) for f in cenarios}
    terrs = set().union(*[set(v) for v in por_cenario.values()]) | set(casos_residencia)
    return {t: {"min": round(min(c.get(t, 0.0) for c in por_cenario.values()), 3),
                "max": round(max(c.get(t, 0.0) for c in por_cenario.values()), 3),
                "cenarios": {str(f): round(c.get(t, 0.0), 3) for f, c in por_cenario.items()}}
            for t in sorted(terrs)}


def robustez(sinais_por_cenario: dict[float, set[str]]) -> dict[str, str]:
    """'robusto' quando o território sinaliza em todos os cenários; 'sinal_fraco' quando em parte deles."""
    todos = set().union(*sinais_por_cenario.values()) if sinais_por_cenario else set()
    n = len(sinais_por_cenario)
    return {t: ("robusto" if sum(t in s for s in sinais_por_cenario.values()) == n else "sinal_fraco")
            for t in todos}
