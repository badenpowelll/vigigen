// VigiGen — ingestão NCBI GenBank via E-utilities (esearch + efetch GBSet XML).
// Um termo por agravo (D-018). Sem "agravo" no corpo, vale dengue, como antes.
// Consultas validadas no esearch em 14/11/2026: DENV 7.203, CHIKV 1.839, ZIKV 519.
// Limite: 3 req/s sem chave, 10 req/s com NCBI_API_KEY (segredo da função).
// O XML cru vai para public.bruto; a extração (geo_loc_name/country, data de
// coleta, sorotipo declarado, hospedeiro, sequência) é feita no banco.
import { atualizarExecucao, auditar, autorizado, buscar, cliente, dormir, execucaoAtual, gravarBruto, json } from "../_shared/comum.ts";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const TERMOS: Record<string, string> = {
  dengue: '"Dengue virus"[Organism] AND Brazil[All Fields]',
  chikungunya: '"Chikungunya virus"[Organism] AND Brazil[All Fields]',
  zika: '"Zika virus"[Organism] AND Brazil[All Fields]',
};
const LOTE = 100;
const ORCAMENTO_MS = 100_000;

function comuns(): Record<string, string> {
  const p: Record<string, string> = { tool: "vigigen" };
  const email = Deno.env.get("NCBI_EMAIL");
  const chave = Deno.env.get("NCBI_API_KEY");
  if (email) p.email = email;
  if (chave) p.api_key = chave;
  return p;
}

Deno.serve(async (req) => {
  const sb = cliente();
  if (!(await autorizado(req, sb))) return json({ erro: "não autorizado" }, 401);
  const corpo = await req.json().catch(() => ({}));
  const intervalo = Deno.env.get("NCBI_API_KEY") ? 120 : 400;
  const agravo = String(corpo.agravo ?? "dengue");
  if (!(agravo in TERMOS)) return json({ erro: `agravo desconhecido: ${agravo}` }, 400);
  const termo = TERMOS[agravo];

  // Carga incremental: depois da primeira carga completa, só registros
  // modificados desde a última carga ok (menos 7 dias de folga), pelo filtro
  // documentado do esearch (datetype=mdat, mindate, maxdate). Evita regravar
  // ~170 MB de XML por semana em public.bruto. {"completo": true} força tudo.
  // A última carga considerada é a do MESMO termo: o primeiro disparo de um
  // agravo novo faz a carga completa dele.
  let desde: string | null = null;
  if (corpo.iniciar === true && corpo.completo !== true) {
    const { data: ult } = await sb.from("execucao_ingestao").select("iniciado_em")
      .eq("fonte", "genbank").eq("status", "ok").eq("parametros->>termo", termo)
      .order("id", { ascending: false }).limit(1);
    if (ult && ult.length) {
      const d = new Date(new Date(ult[0].iniciado_em).getTime() - 7 * 864e5);
      desde = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
    }
  }
  const exec = await execucaoAtual(sb, "genbank", corpo.iniciar === true, {
    agravo,
    termo,
    desde,
    ids: null,
    cursor: 0,
  });
  if (!exec) return json({ ok: true, mensagem: "nenhuma execução em andamento" });
  // Uma execução de cada vez: se outro agravo está em andamento, este disparo
  // não começa (o próximo agendamento tenta de novo) e a outra segue normalmente.
  if (corpo.iniciar === true && (exec.parametros as { termo?: string }).termo !== termo) {
    return json({ ok: false, ocupado: true, em_andamento: (exec.parametros as { agravo?: string }).agravo ?? "dengue" }, 409);
  }
  const p = exec.parametros as { termo: string; desde?: string | null; ids: string[] | null; cursor: number; count?: number };
  const inicio = Date.now();
  let registros = exec.registros ?? 0;
  const falhas: string[] = [];

  try {
    // 1) esearch: lista completa de UIDs (paginada de 10.000 em 10.000)
    if (!p.ids) {
      const ids: string[] = [];
      let retstart = 0;
      let count = 0;
      do {
        const params: Record<string, string> = { db: "nuccore", retmode: "json", retmax: "10000", retstart: String(retstart), term: p.termo, ...comuns() };
        if (p.desde) Object.assign(params, { datetype: "mdat", mindate: p.desde, maxdate: "3000" });
        const r = await buscar(`${EUTILS}/esearch.fcgi?${new URLSearchParams(params)}`);
        const { api_key: _k, ...semChave } = params;
        await gravarBruto(sb, "genbank", `${EUTILS}/esearch.fcgi`, semChave, r.status, r.corpo);
        if (r.status !== 200) throw new Error(`esearch HTTP ${r.status}`);
        const res = JSON.parse(r.corpo).esearchresult;
        count = Number(res.count);
        ids.push(...res.idlist);
        retstart += 10000;
        await dormir(intervalo);
      } while (retstart < count);
      p.ids = ids;
      p.count = count;
      p.cursor = 0;
      if (count === 0) {
        await atualizarExecucao(sb, exec.id, { parametros: p, status: "vazio", registros: 0, finalizado_em: new Date().toISOString() });
        return json({ ok: true, count: 0 });
      }
      await atualizarExecucao(sb, exec.id, { parametros: p });
    }

    // 2) efetch em lotes, até o orçamento de tempo
    while (p.cursor < p.ids.length && Date.now() - inicio < ORCAMENTO_MS) {
      const lote = p.ids.slice(p.cursor, p.cursor + LOTE);
      const params: Record<string, string> = { db: "nuccore", rettype: "gb", retmode: "xml", ...comuns() };
      const form = new URLSearchParams({ ...params, id: lote.join(",") });
      const r = await buscar(`${EUTILS}/efetch.fcgi`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      const { api_key: _k, ...semChave } = params;
      const idB = await gravarBruto(sb, "genbank", `${EUTILS}/efetch.fcgi`, { ...semChave, ids: lote }, r.status, r.corpo);
      if (r.status === 200) {
        const { data: n, error } = await sb.rpc("ingest_genbank", { p_bruto: idB });
        if (error) falhas.push(`lote ${p.cursor}: ${error.message}`);
        else registros += n as number;
      } else {
        falhas.push(`lote ${p.cursor}: HTTP ${r.status}`);
      }
      p.cursor += lote.length;
      await dormir(intervalo);
    }
  } catch (e) {
    await atualizarExecucao(sb, exec.id, { parametros: p, registros, status: "erro", mensagem: String(e), finalizado_em: new Date().toISOString() });
    return json({ ok: false, erro: String(e) }, 502);
  }

  const concluido = p.cursor >= (p.ids?.length ?? 0);
  await atualizarExecucao(sb, exec.id, {
    parametros: p,
    registros,
    ...(falhas.length ? { mensagem: falhas.slice(0, 30).join(" | ") } : {}),
    ...(concluido ? { status: registros > 0 ? "ok" : "vazio", finalizado_em: new Date().toISOString() } : {}),
  });
  if (concluido) await auditar(sb, "carga", "sequencia", { execucao: exec.id, registros, count: p.count });
  return json({ ok: true, execucao: exec.id, cursor: p.cursor, total: p.ids?.length, registros, concluido, falhas: falhas.length });
});
