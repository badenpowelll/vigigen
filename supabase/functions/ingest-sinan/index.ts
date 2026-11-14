// VigiGen — notificações do SINAN pela API DEMAS (Ministério da Saúde), D-020.
// GET https://apidadosabertos.saude.gov.br/arboviroses/{dengue|chikungunya|zikavirus}
//   nu_ano, id_municip (6 dígitos, município da unidade notificadora),
//   limit ≤ 1000, offset = número da página (swagger v1.8.32).
// Percorre os 167 municípios do RN × 3 agravos, página a página, e guarda o
// cursor em execucao_ingestao (o pg_cron chama de novo até concluir).
//
// Exceção documentada à regra 3: a resposta original tem dado pessoal (idade,
// sexo, raça, gestante...) e NÃO é gravada. O que vai para public.bruto é só a
// contagem por chave não pessoal (_shared/sinan.ts), com o sha256, o tamanho e
// o número de registros da resposta original nos parâmetros. Uma execução com
// qualquer página falha termina como "erro" e não entra na view do painel.
import { atualizarExecucao, auditar, autorizado, buscar, cliente, dormir, execucaoAtual, gravarBruto, json, sha256 } from "../_shared/comum.ts";
import { corpoAgregado } from "../_shared/sinan.ts";

const BASE = "https://apidadosabertos.saude.gov.br";
const CAMINHOS: Record<string, string> = {
  dengue: "arboviroses/dengue", chikungunya: "arboviroses/chikungunya", zika: "arboviroses/zikavirus",
};
const LIMITE = 1000;
const ORCAMENTO_MS = 100_000;
const INTERVALO_MS = 500;

type Cursor = { a: number; m: number; p: number };
type Params = { ano: number; agravos: string[]; cursor: Cursor; paginas?: number; falhas?: string[] };

Deno.serve(async (req) => {
  const sb = cliente();
  if (!(await autorizado(req, sb))) return json({ erro: "não autorizado" }, 401);
  const corpo = await req.json().catch(() => ({}));
  const ano = Number(corpo.ano ?? new Date().getUTCFullYear());
  const agravos: string[] = (corpo.agravos ?? Object.keys(CAMINHOS)).filter((a: string) => a in CAMINHOS);

  const exec = await execucaoAtual(sb, "sinan", corpo.iniciar === true, { ano, agravos, cursor: { a: 0, m: 0, p: 0 } });
  if (!exec) return json({ ok: true, mensagem: "nenhuma execução em andamento" });

  const { data: munis, error } = await sb.from("municipio").select("geocodigo").order("geocodigo");
  if (error || !munis?.length) {
    await atualizarExecucao(sb, exec.id, { status: "erro", mensagem: "tabela municipio vazia", finalizado_em: new Date().toISOString() });
    return json({ ok: false, erro: "municipio vazio" }, 409);
  }

  const p = exec.parametros as Params;
  const c = { ...p.cursor };
  const falhas = [...(p.falhas ?? [])];
  let paginas = p.paginas ?? 0;
  let registros = exec.registros ?? 0;
  const inicio = Date.now();

  while (c.a < p.agravos.length && Date.now() - inicio < ORCAMENTO_MS) {
    const agravo = p.agravos[c.a];
    const m6 = String(Math.floor((munis[c.m].geocodigo as number) / 10));
    const params = { nu_ano: String(p.ano), id_municip: m6, limit: String(LIMITE), offset: String(c.p) };
    const url = `${BASE}/${CAMINHOS[agravo]}`;
    let n = 0;
    let avancarMunicipio = true;
    try {
      const r = await buscar(`${url}?${new URLSearchParams(params)}`);
      const meta: Record<string, unknown> = {
        ...params, agravo,
        sha256_resposta_original: await sha256(r.corpo),
        bytes_resposta_original: new TextEncoder().encode(r.corpo).length,
        nota: "resposta original não gravada (dado pessoal); corpo = contagens não pessoais (D-020)",
      };
      if (r.status === 200) {
        const dados = JSON.parse(r.corpo);
        const lista = (dados[Object.keys(dados)[0]] ?? []) as Record<string, unknown>[];
        n = lista.length;
        const agregado = corpoAgregado(agravo, lista);
        const idB = await gravarBruto(sb, "sinan", url, { ...meta, registros_originais: n }, r.status, JSON.stringify(agregado));
        const { error: e2 } = await sb.rpc("ingest_sinan", { p_bruto: idB, p_execucao: exec.id });
        if (e2) falhas.push(`${agravo}/${m6}/p${c.p}: ${e2.message}`);
        registros += n;
        avancarMunicipio = n < LIMITE;
      } else {
        // corpo de erro não tem dado pessoal: gravado como veio
        await gravarBruto(sb, "sinan", url, meta, r.status, r.corpo.slice(0, 2000));
        falhas.push(`${agravo}/${m6}/p${c.p}: HTTP ${r.status}`);
      }
    } catch (e) {
      falhas.push(`${agravo}/${m6}/p${c.p}: ${String(e).slice(0, 200)}`);
    }
    paginas++;
    if (avancarMunicipio) {
      c.p = 0;
      c.m++;
      if (c.m >= munis.length) { c.m = 0; c.a++; }
    } else {
      c.p++;
    }
    await dormir(INTERVALO_MS);
  }

  const concluido = c.a >= p.agravos.length;
  await atualizarExecucao(sb, exec.id, {
    parametros: { ...p, cursor: c, paginas, falhas: falhas.slice(0, 200) },
    registros,
    ...(falhas.length ? { mensagem: falhas.slice(0, 30).join(" | ") } : {}),
    ...(concluido ? { status: falhas.length ? "erro" : (registros > 0 ? "ok" : "vazio"), finalizado_em: new Date().toISOString() } : {}),
  });
  if (concluido) await auditar(sb, "carga", "notificacao_sinan", { execucao: exec.id, ano: p.ano, registros, paginas, falhas: falhas.length });
  return json({ ok: true, execucao: exec.id, cursor: c, registros, paginas, concluido, falhas: falhas.length });
});
