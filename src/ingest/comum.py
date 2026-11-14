"""Utilidades comuns da ingestão local (CLI Python).

Regra 3 do CLAUDE.md: toda resposta externa é gravada crua em data/raw/<fonte>/
com timestamp e sha256 ANTES de qualquer transformação.
"""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import requests

RAIZ = Path(__file__).resolve().parents[2]
DATA = RAIZ / "data"
RAW = DATA / "raw"
PROCESSED = DATA / "processed"
REFERENCE = DATA / "reference"
USER_AGENT = "VigiGen/0.1 (UFRN/IMD; pesquisa de doutorado)"


@dataclass
class Resposta:
    url: str
    status: int
    corpo: bytes
    obtido_em: str
    caminho_bruto: Path


def agora() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def buscar(fonte: str, url: str, params: dict | None = None, *, metodo: str = "GET",
           data: dict | None = None, tentativas: int = 4, nome: str = "resposta",
           extensao: str = "json", timeout: int = 120) -> Resposta:
    """GET/POST com backoff exponencial; grava a resposta crua em data/raw/<fonte>/."""
    ultimo = ""
    for i in range(tentativas):
        try:
            r = requests.request(metodo, url, params=params, data=data, timeout=timeout,
                                 headers={"User-Agent": USER_AGENT})
            if r.status_code < 500 and r.status_code != 429:
                return _gravar(fonte, r.url if metodo == "GET" else url, r.status_code,
                               r.content, params or data or {}, nome, extensao)
            ultimo = f"HTTP {r.status_code}"
        except requests.RequestException as e:  # registra e tenta de novo
            ultimo = repr(e)
        time.sleep(2 ** i)
    raise RuntimeError(f"falha após {tentativas} tentativas em {url}: {ultimo}")


def _gravar(fonte: str, url: str, status: int, corpo: bytes, params: dict,
            nome: str, extensao: str) -> Resposta:
    ts = agora()
    pasta = RAW / fonte
    pasta.mkdir(parents=True, exist_ok=True)
    caminho = pasta / f"{ts}_{nome}.{extensao}"
    caminho.write_bytes(corpo)
    meta = {
        "url": url,
        "parametros": {k: v for k, v in params.items() if k != "api_key"},
        "status_http": status,
        "obtido_em": ts,
        "sha256": hashlib.sha256(corpo).hexdigest(),
        "tamanho_bytes": len(corpo),
    }
    caminho.with_suffix(caminho.suffix + ".meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return Resposta(url, status, corpo, ts, caminho)
