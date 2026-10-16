# Monta web/src/dados/retrato.json a partir das partes de app.retrato lidas pelo
# execute_sql (MCP Supabase), quando o contêiner não alcança o Supabase direto.
# Confere o md5 contra o gravado no banco. Com acesso direto, prefira:
#   psql "$DATABASE_URL" -Atc "select corpo from app.retrato order by id desc limit 1" > web/src/dados/retrato.json
# Uso: python scripts/montar_retrato.py <id_retrato> <saida.json>  (D = pasta de resultados do MCP)
import json, re, glob, hashlib, sys
D="/root/.claude/projects/-home-claude/b5c799bd-e24d-5c7b-8e1a-a033492277fc/tool-results"
rid=int(sys.argv[1]); partes={}
for f in glob.glob(D+"/mcp-Supabase-execute_sql-*.txt"):
    t=json.loads(open(f).read())["result"]
    m=re.search(r"\n<untrusted-data-[^>]*>\n(.*?)\n</untrusted-data-", t, re.S)
    rows=json.loads(m.group(1))
    if rows and rows[0].get("rid")==rid: partes[rows[0]["parte"]]=rows[0]["p"]
corpo="".join(partes[k] for k in sorted(partes))
print(sorted(partes), len(corpo), hashlib.md5(corpo.encode()).hexdigest())
d=json.loads(corpo)
json.dump(d, open(sys.argv[2],"w"), ensure_ascii=False, separators=(',',':'))
print(d["gerado_em"], d["resumo"]["cobertura_municipal_trimestre"][0]["p"])
