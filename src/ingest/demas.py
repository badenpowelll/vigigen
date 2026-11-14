"""API de Dados Abertos do Ministério da Saúde (DEMAS), swagger v1.8.32:
https://apidadosabertos.saude.gov.br/static/swagger.json

SINAN (arboviroses) — GET /arboviroses/{dengue|chikungunya|zikavirus}
  nu_ano, id_municip (6 dígitos: município da UNIDADE NOTIFICADORA), limit ≤ 1000,
  offset = número da página (0, 1, 2...). A resposta traz um registro por
  notificação, com idade, sexo, raça e outras colunas pessoais. O parâmetro
  `campos`, que reduziria as colunas na origem, foi sondado em 14/11/2026:
  respondeu 200 com limit=5 (20 s) e 502 após 60 s com limit=1000 e a chave
  inteira, nos três agravos. Não serve para a carga.

  Por isso (D-020) a resposta original NÃO é gravada: o programa calcula o
  sha256 dela, soma as notificações por chave sem nenhuma coluna pessoal e grava
  só essas contagens, junto com o sha256, o tamanho e o número de registros da
  resposta original. Nenhum registro individual sai da memória.

CNES — GET /cnes/estabelecimentos
  codigo_uf, codigo_municipio (6 dígitos), status (1 = ativo), limit ≤ 20,
  offset = número da página. Cadastro público de estabelecimentos: a resposta é
  gravada inteira; o nome de estabelecimento sem CNPJ (pessoa física) não entra
  na tabela normalizada.

A Edge Function (supabase/functions/_shared/sinan.ts) aplica exatamente a mesma
regra de agregação; os testes conferem as duas com as mesmas respostas reais.
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from datetime import datetime, timezone

from .comum import RAW, USER_AGENT, buscar

BASE = "https://apidadosabertos.saude.gov.br"
CAMINHOS_SINAN = {"dengue": "arboviroses/dengue", "chikungunya": "arboviroses/chikungunya",
                  "zika": "arboviroses/zikavirus"}
LIMITE_SINAN = 1000
LIMITE_CNES = 20

# Chave da contagem. Nenhuma destas colunas identifica pessoa: ano e semana de
# notificação, municípios (notificação e residência), classificação final,
# critério de confirmação e sorotipo informado.
CHAVE_SINAN = ("nu_ano", "sem_not", "id_municip", "id_mn_resi", "classi_fin", "criterio", "sorotipo")

# A API usa a palavra "nan" (e às vezes vazio) para campo sem valor.
_VAZIOS = {None, "", "nan", "NaN", "None", "null"}


def _valor(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return None if s in _VAZIOS else s


def agregar_sinan(registros: list[dict]) -> list[dict]:
    """Conta notificações por CHAVE_SINAN. Devolve uma lista ordenada de
    dicionários com as colunas da chave e `n`. Nada além da chave é lido."""
    c = Counter(tuple(_valor(r.get(k)) for k in CHAVE_SINAN) for r in registros)
    linhas = [dict(zip(CHAVE_SINAN, chave)) | {"n": n} for chave, n in c.items()]
    return sorted(linhas, key=lambda d: tuple("" if d[k] is None else d[k] for k in CHAVE_SINAN))


def corpo_agregado(agravo: str, registros: list[dict]) -> dict:
    """O que vai para public.bruto (e para data/raw no CLI) no lugar da resposta original."""
    return {"agravo": agravo, "registros_originais": len(registros), "chave": list(CHAVE_SINAN),
            "contagens": agregar_sinan(registros)}


def pagina_sinan(agravo: str, ano: int, municipio6: str, pagina: int) -> dict:
    """Busca uma página, grava só as contagens em data/raw/sinan/ e devolve o resumo."""
    import requests  # só no uso real

    url = f"{BASE}/{CAMINHOS_SINAN[agravo]}"
    params = {"nu_ano": str(ano), "id_municip": municipio6, "limit": str(LIMITE_SINAN), "offset": str(pagina)}
    r = requests.get(url, params=params, headers={"User-Agent": USER_AGENT}, timeout=120)
    original = r.content
    meta = {"url": r.url, "parametros": params, "status_http": r.status_code,
            "obtido_em": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sha256_resposta_original": hashlib.sha256(original).hexdigest(),
            "bytes_resposta_original": len(original)}
    if r.status_code != 200:
        corpo = {"erro_http": r.status_code, "inicio": original[:500].decode("utf-8", "replace")}
        registros: list[dict] = []
    else:
        dados = json.loads(original)
        registros = dados.get(next(iter(dados)), []) if dados else []
        corpo = corpo_agregado(agravo, registros)
    del original  # a resposta original não é gravada (D-020)
    pasta = RAW / "sinan"
    pasta.mkdir(parents=True, exist_ok=True)
    nome = f"{meta['obtido_em'].replace(':', '')}_{agravo}_{ano}_{municipio6}_p{pagina}.json"
    (pasta / nome).write_text(json.dumps(meta | {"corpo": corpo}, ensure_ascii=False), encoding="utf-8")
    return meta | {"registros": len(registros)}


def executar_sinan(ano: int, municipios6: list[str], agravos: list[str] | None = None) -> dict:
    resumo = {"fonte": "sinan (DEMAS)", "ano": ano, "paginas": 0, "registros": 0, "falhas": []}
    for agravo in agravos or list(CAMINHOS_SINAN):
        for m in municipios6:
            for p in range(10_000):
                res = pagina_sinan(agravo, ano, m, p)
                resumo["paginas"] += 1
                if res["status_http"] != 200:
                    resumo["falhas"].append(f"{agravo}/{m}/p{p}: HTTP {res['status_http']}")
                    break
                resumo["registros"] += res["registros"]
                if res["registros"] < LIMITE_SINAN:
                    break
    return resumo


def executar_cnes(codigo_uf: str = "24") -> dict:
    """Estabelecimentos ativos da UF; cada página gravada crua em data/raw/cnes/."""
    total, paginas = 0, 0
    for p in range(100_000):
        r = buscar("cnes", f"{BASE}/cnes/estabelecimentos",
                   {"codigo_uf": codigo_uf, "status": "1", "limit": str(LIMITE_CNES), "offset": str(p)},
                   nome=f"estabelecimentos_uf{codigo_uf}_p{p}")
        paginas += 1
        if r.status != 200:
            return {"fonte": "cnes (DEMAS)", "paginas": paginas, "registros": total, "erro": f"HTTP {r.status}"}
        n = len(json.loads(r.corpo).get("estabelecimentos", []))
        total += n
        if n < LIMITE_CNES:
            break
    return {"fonte": "cnes (DEMAS)", "paginas": paginas, "registros": total}
