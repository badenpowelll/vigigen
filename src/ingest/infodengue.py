"""InfoDengue (Fiocruz + FGV) — séries epidemiológicas semanais por município.

GET https://info.dengue.mat.br/api/alertcity
    ?geocode={7 dígitos}&disease={dengue|chikungunya|zika}&format=json
    &ew_start=1&ew_end=53&ey_start={ano}&ey_end={ano}

Campos conferidos na resposta real de Natal (2408102), SE 202501-202502, em
2026-10-16: data_iniSE (epoch em ms), SE (AAAASS), casos, casos_est,
casos_est_min, casos_est_max, p_inc100k, Rt, p_rt1, nivel, pop, receptivo,
transmissao, nivel_inc, casprov, casconf, notif_accum_year, versao_modelo,
temp*/umid* (clima). Os nomes são do serviço.
"""
from __future__ import annotations

import csv
import json
import time
from datetime import datetime, timezone

import pandas as pd

from .comum import PROCESSED, REFERENCE, buscar

BASE = "https://info.dengue.mat.br/api/alertcity"
DOENCAS = ("dengue", "chikungunya", "zika")
INTERVALO_S = 0.5  # 2 requisições por segundo

COLUNAS = {
    "SE": "semana_epidemiologica", "casos": "casos", "casos_est": "casos_estimados",
    "casos_est_min": "casos_estimados_min", "casos_est_max": "casos_estimados_max",
    "p_inc100k": "incidencia_100k", "Rt": "rt", "p_rt1": "p_rt1", "nivel": "nivel_alerta",
    "pop": "populacao", "receptivo": "receptivo", "transmissao": "transmissao",
}


def geocodigos() -> list[int]:
    caminho = REFERENCE / "municipios.csv"
    if not caminho.exists():
        raise RuntimeError("data/reference/municipios.csv ausente: rode --fonte ibge antes")
    with open(caminho, encoding="utf-8") as f:
        return [int(r["geocodigo"]) for r in csv.DictReader(f)]


def amostra(geocodigo: int = 2408102, doenca: str = "dengue", ano: int = 2025) -> dict:
    """Uma chamada única para conferir a forma dos campos antes do laço."""
    r = buscar("infodengue", BASE, _params(geocodigo, doenca, ano, ano), nome=f"amostra_{geocodigo}")
    dados = json.loads(r.corpo)
    return {"status": r.status, "chaves": sorted(dados[0].keys()) if dados else [],
            "primeiro": dados[0] if dados else None}


def _params(g: int, d: str, ini: int, fim: int) -> dict:
    return {"geocode": g, "disease": d, "format": "json", "ew_start": 1, "ew_end": 53,
            "ey_start": ini, "ey_end": fim}


def executar(ano_inicio: int = 2020, ano_fim: int | None = None) -> dict:
    ano_fim = ano_fim or datetime.now(timezone.utc).year
    linhas, falhas, inicio = [], [], None
    for doenca in DOENCAS:
        for g in geocodigos():
            try:
                r = buscar("infodengue", BASE, _params(g, doenca, ano_inicio, ano_fim),
                           nome=f"{doenca}_{g}")
                inicio = inicio or r.obtido_em
                if r.status != 200:
                    falhas.append(f"{g}/{doenca}: HTTP {r.status}")
                    continue
                for reg in json.loads(r.corpo):
                    linha = {novo: reg.get(antigo) for antigo, novo in COLUNAS.items()}
                    linha.update(geocodigo=g, doenca=doenca,
                                 data_inicio_se=pd.to_datetime(reg["data_iniSE"], unit="ms").date(),
                                 bruto=r.caminho_bruto.name)
                    linhas.append(linha)
            except RuntimeError as e:
                falhas.append(f"{g}/{doenca}: {e}")
            time.sleep(INTERVALO_S)
    if not linhas:
        raise RuntimeError(f"InfoDengue não devolveu registros. Falhas: {falhas[:10]}")
    df = pd.DataFrame(linhas)
    df["ano"] = df["semana_epidemiologica"] // 100
    PROCESSED.mkdir(parents=True, exist_ok=True)
    df.to_parquet(PROCESSED / "casos_semanais.parquet", index=False)
    return {
        "fonte": "InfoDengue", "endpoint": BASE, "acesso": inicio, "registros": len(df),
        "periodo": f"SE {df.semana_epidemiologica.min()} a {df.semana_epidemiologica.max()}",
        "falhas": falhas,
    }
