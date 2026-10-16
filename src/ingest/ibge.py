"""IBGE — território. Fonte de verdade dos geocódigos (nenhum é escrito à mão).

Endpoints (públicos, sem autenticação):
- Localidades v1: /api/v1/localidades/estados/24/municipios
- Malhas v3:      /api/v3/malhas/estados/24?formato=application/vnd.geo+json
                  &qualidade=minima&intrarregiao=municipio
Saída versionada em data/reference/: municipios.csv e municipios.geojson.
"""
from __future__ import annotations

import csv
import json

from .comum import REFERENCE, buscar

URL_MUNICIPIOS = "https://servicodados.ibge.gov.br/api/v1/localidades/estados/24/municipios"
URL_MALHA = "https://servicodados.ibge.gov.br/api/v3/malhas/estados/24"
PARAMS_MALHA = {"formato": "application/vnd.geo+json", "qualidade": "minima",
                "intrarregiao": "municipio"}


def executar() -> dict:
    m = buscar("ibge", URL_MUNICIPIOS, nome="municipios_rn")
    g = buscar("ibge", URL_MALHA, PARAMS_MALHA, nome="malha_rn", extensao="geojson")
    if m.status != 200 or g.status != 200:
        raise RuntimeError(f"IBGE respondeu {m.status} (municípios) e {g.status} (malha)")

    municipios = json.loads(m.corpo)
    if not municipios:
        raise RuntimeError("IBGE devolveu lista vazia de municípios; nada foi gravado")
    REFERENCE.mkdir(parents=True, exist_ok=True)
    with open(REFERENCE / "municipios.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["geocodigo", "nome", "mesorregiao", "microrregiao"])
        for x in sorted(municipios, key=lambda x: x["id"]):
            micro = x.get("microrregiao") or {}
            w.writerow([x["id"], x["nome"], (micro.get("mesorregiao") or {}).get("nome"),
                        micro.get("nome")])

    malha = json.loads(g.corpo)
    nomes = {x["id"]: x["nome"] for x in municipios}
    for feat in malha.get("features", []):
        cod = int(feat["properties"]["codarea"])
        feat["properties"]["geocodigo"] = cod
        feat["properties"]["nome"] = nomes.get(cod)
    (REFERENCE / "municipios.geojson").write_text(json.dumps(malha, ensure_ascii=False),
                                                   encoding="utf-8")
    return {
        "fonte": "IBGE",
        "endpoint": [URL_MUNICIPIOS, URL_MALHA],
        "acesso": m.obtido_em,
        "registros": len(municipios),
        "feicoes_malha": len(malha.get("features", [])),
        "bruto": [str(m.caminho_bruto), str(g.caminho_bruto)],
    }
