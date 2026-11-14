"""Sonda as fontes novas (DEMAS/SINAN, CNES, INMET) e grava respostas reais
para os testes. Roda no GitHub Actions (workflow `sondar-fontes`), porque o
ambiente de desenvolvimento não alcança essas URLs.

Regras do CLAUDE.md aplicadas aqui:
- só endpoints documentados (swagger DEMAS v1.8.32; portal do INMET);
- cada chamada registra URL, status HTTP, data, tamanho e sha256 do corpo original;
- nenhum dado pessoal vai para tests/fixtures: do SINAN ficam só as colunas
  usadas na agregação (nenhuma é pessoal); do CNES, só unidades de tipo
  público (UBS), sem filtrar campo nenhum; do INMET, o começo do CSV de Natal.

Saída: data/interim/sondagem/ (relatório + fixtures), enviada como artefato,
e impressa no log em gzip+base64 entre marcadores, para ser conferida.
"""
from __future__ import annotations

import base64
import gzip
import hashlib
import io
import json
import sys
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import requests

SAIDA = Path("data/interim/sondagem")
UA = {"User-Agent": "VigiGen/0.1 (UFERSA; pesquisa de doutorado)"}
DEMAS = "https://apidadosabertos.saude.gov.br"
NATAL6 = "240810"
COLUNAS_SINAN = ["nu_ano", "sem_not", "id_municip", "id_mn_resi", "classi_fin", "criterio", "sorotipo"]

relatorio: list[dict] = []


def agora() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def chamar(nome: str, url: str, params: dict | None = None, timeout: int = 120, stream: bool = False):
    t0 = time.time()
    try:
        r = requests.get(url, params=params, headers=UA, timeout=timeout)
        corpo = r.content
        item = {"nome": nome, "url": r.url, "status_http": r.status_code, "obtido_em": agora(),
                "segundos": round(time.time() - t0, 2), "bytes": len(corpo),
                "sha256": hashlib.sha256(corpo).hexdigest(),
                "content_type": r.headers.get("content-type"), "inicio": corpo[:300].decode("utf-8", "replace")}
    except Exception as e:  # noqa: BLE001 — registrar o erro real
        corpo = b""
        item = {"nome": nome, "url": url, "params": params, "erro": repr(e)[:500], "obtido_em": agora(),
                "segundos": round(time.time() - t0, 2)}
    relatorio.append(item)
    print(json.dumps({k: v for k, v in item.items() if k != "inicio"}, ensure_ascii=False))
    return item, corpo


def gravar(nome: str, obj) -> None:
    SAIDA.mkdir(parents=True, exist_ok=True)
    (SAIDA / nome).write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def sinan() -> None:
    for agravo, caminho in (("dengue", "dengue"), ("chikungunya", "chikungunya"), ("zika", "zikavirus")):
        url = f"{DEMAS}/arboviroses/{caminho}"
        for offset in (0, 1):
            params = {"nu_ano": "2026", "id_municip": NATAL6, "limit": "50", "offset": str(offset)}
            item, corpo = chamar(f"sinan_{agravo}_natal_2026_p{offset}", url, params)
            if item.get("status_http") != 200:
                continue
            dados = json.loads(corpo)
            chave = next(iter(dados))
            regs = dados[chave]
            item["registros"] = len(regs)
            item["chave"] = chave
            item["colunas"] = sorted(regs[0].keys()) if regs else []
            minimos = [{c: r.get(c) for c in COLUNAS_SINAN} for r in regs]
            gravar(f"FIXTURE_demas_{agravo}_natal_2026_p{offset}.json", {
                "_fonte": "API DEMAS (Ministério da Saúde), swagger v1.8.32",
                "_url": item["url"], "_obtido_em": item["obtido_em"], "_status_http": item["status_http"],
                "_sha256_resposta_original": item["sha256"], "_bytes_resposta_original": item["bytes"],
                "_chave_raiz": chave, "_colunas_na_resposta": item["colunas"],
                "_nota": "Resposta real reduzida às colunas usadas na agregação; nenhuma coluna pessoal.",
                "registros": minimos})
    # Parâmetro `campos` (documentado): conferir se responde
    chamar("sinan_dengue_campos", f"{DEMAS}/arboviroses/dengue",
           {"nu_ano": "2026", "id_municip": NATAL6, "limit": "5", "offset": "0", "campos": "nu_ano,sem_not"})
    # Volume: páginas de 1000 para Natal (dengue 2025 e 2026), até esvaziar ou 60 páginas
    for ano in ("2025", "2026"):
        total, paginas = 0, 0
        for offset in range(60):
            item, corpo = chamar(f"sinan_dengue_natal_{ano}_1000_p{offset}", f"{DEMAS}/arboviroses/dengue",
                                 {"nu_ano": ano, "id_municip": NATAL6, "limit": "1000", "offset": str(offset)})
            if item.get("status_http") != 200:
                break
            n = len(json.loads(corpo).get("dengue", []))
            total += n
            paginas += 1
            if n < 1000:
                break
        relatorio.append({"nome": f"volume_dengue_natal_{ano}", "registros": total, "paginas": paginas})


def cnes() -> None:
    url = f"{DEMAS}/cnes/estabelecimentos"
    item, corpo = chamar("cnes_natal_tipo2_p0", url,
                         {"codigo_municipio": NATAL6, "codigo_tipo_unidade": "2", "status": "1", "limit": "20", "offset": "0"})
    if item.get("status_http") == 200:
        gravar("FIXTURE_cnes_natal_tipo2_p0.json", {
            "_fonte": "API DEMAS (Ministério da Saúde) /cnes/estabelecimentos, swagger v1.8.32",
            "_url": item["url"], "_obtido_em": item["obtido_em"], "_sha256": item["sha256"],
            "_nota": "Resposta real, inteira (tipo de unidade 2: centros de saúde e UBS).",
            "resposta": json.loads(corpo)})
    item, corpo = chamar("cnes_natal_todos_p0", url, {"codigo_municipio": NATAL6, "status": "1", "limit": "20", "offset": "0"})
    if item.get("status_http") == 200:
        regs = json.loads(corpo).get("estabelecimentos", [])
        item["perfil"] = [{k: r.get(k) for k in ("codigo_tipo_unidade", "descricao_esfera_administrativa",
                                                 "descricao_natureza_juridica_estabelecimento",
                                                 "natureza_organizacao_entidade", "tipo_gestao")}
                          | {"tem_cnpj": bool(r.get("numero_cnpj")), "tem_cnpj_entidade": bool(r.get("numero_cnpj_entidade"))}
                          for r in regs]
    # Volume do RN: conta páginas de 20 até esvaziar (teto 600 páginas)
    total = 0
    for offset in range(600):
        item, corpo = chamar(f"cnes_rn_p{offset}", url, {"codigo_uf": "24", "status": "1", "limit": "20", "offset": str(offset)})
        if item.get("status_http") != 200:
            break
        n = len(json.loads(corpo).get("estabelecimentos", []))
        total += n
        if n < 20:
            break
        time.sleep(0.3)
    relatorio.append({"nome": "volume_cnes_rn_ativos", "registros": total})


def inmet() -> None:
    # Rota antiga da API de tempo, citada como pública por terceiros; testada, não assumida.
    chamar("inmet_apitempo_estacao_A304", "https://apitempo.inmet.gov.br/estacao/2026-11-01/2026-11-07/A304")
    chamar("inmet_apitempo_estacoes_T", "https://apitempo.inmet.gov.br/estacoes/T")
    # Arquivo anual oficial (portal.inmet.gov.br/dadoshistoricos)
    item, corpo = chamar("inmet_zip_2026", "https://portal.inmet.gov.br/uploads/dadoshistoricos/2026.zip", timeout=600)
    if item.get("status_http") != 200:
        return
    z = zipfile.ZipFile(io.BytesIO(corpo))
    nomes = z.namelist()
    rn = [n for n in nomes if "_RN_" in n.upper()]
    item["arquivos"] = len(nomes)
    item["arquivos_rn"] = rn
    natal = [n for n in rn if "NATAL" in n.upper()]
    if natal:
        bruto = z.read(natal[0])
        item["natal_csv"] = {"arquivo": natal[0], "bytes": len(bruto), "sha256": hashlib.sha256(bruto).hexdigest()}
        linhas = bruto.split(b"\n")
        (SAIDA / "FIXTURE_inmet_natal_2026_inicio.csv").write_bytes(b"\n".join(linhas[:200]) + b"\n")
        gravar("FIXTURE_inmet_natal_2026_inicio.meta.json", {
            "_fonte": "INMET, dados históricos das estações automáticas", "_url": item["url"],
            "_obtido_em": item["obtido_em"], "_sha256_zip": item["sha256"], "_arquivo": natal[0],
            "_sha256_arquivo": item["natal_csv"]["sha256"], "_bytes_arquivo": len(bruto),
            "_nota": "As 200 primeiras linhas do CSV original, sem alteração (o resto do arquivo fica fora do repositório).",
            "_linhas_no_arquivo": len(linhas)})


def main() -> None:
    SAIDA.mkdir(parents=True, exist_ok=True)
    for etapa in (sinan, cnes, inmet):
        try:
            etapa()
        except Exception as e:  # noqa: BLE001
            relatorio.append({"nome": etapa.__name__, "erro": repr(e)[:500]})
    gravar("relatorio.json", relatorio)
    for arq in sorted(SAIDA.iterdir()):
        pacote = base64.b64encode(gzip.compress(arq.read_bytes(), mtime=0)).decode()
        print(f"=====INICIO {arq.name}")
        for i in range(0, len(pacote), 4000):
            print(pacote[i:i + 4000])
        print(f"=====FIM {arq.name}")


if __name__ == "__main__":
    sys.exit(main())
