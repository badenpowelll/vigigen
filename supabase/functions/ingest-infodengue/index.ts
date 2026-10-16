// VigiGen — ingestão InfoDengue (Fiocruz/FGV), /api/alertcity.
// Percorre os municípios do RN (tabela municipio, vinda do IBGE) x 3 doenças,
// no máximo 2 req/s, com retentativa. Cada chamada da função avança um lote
// e guarda o cursor em execucao_ingestao; o pg_cron chama de novo até concluir.
import { atualizarExecucao, auditar, autorizado, buscar, cliente, dormir, execucaoAtual, gravarBruto, json } from "../_shared/comum.ts";

const BASE = "https://info.dengue.mat.br/api/alertcity";
const DOENCAS = ["dengue", "chikungunya", "zika"];
const ORCAMENTO_MS = 100_000; // limite de parede da Edge Function é 150 s
const INTERVALO_MS = 500;     // 2 requisições por segundo

Deno.serve(async (req) => {
  const sb = cliente();
  if (!(await autorizado(req, sb))) return json({ erro: "não autorizado" }, 401);
  const corpo = await req.json().catch(() => ({}));
  const anoAtual = new Date().getUTCFullYear();

  // Depois da carga histórica (2020+), as cargas agendadas pedem só o ano
  // corrente (e o anterior até fevereiro, para fechar as revisões do nowcasting).
  // As linhas são atualizadas por chave (município, agravo, SE).
  let eyPadrao = 2020;
  if (corpo.iniciar === true && corpo.ey_start === undefined) {
    const { data: ult } = await sb.from("execucao_ingestao").select("id")
      .eq("fonte", "infodengue").eq("status", "ok").limit(1);
    if (ult && ult.length) eyPadrao = new Date().getUTCMonth() < 2 ? anoAtual - 1 : anoAtual;
  }
  const exec = await execucaoAtual(sb, "infodengue", corpo.iniciar === true, {
    ey_start: corpo.ey_start ?? eyPadrao,
    ey_end: corpo.ey_end ?? anoAtual,
    cursor: 0,
  });
  if (!exec) return json({ ok: true, mensagem: "nenhuma execução em andamento" });

  const { data: munis, error } = await sb.from("municipio").select("geocodigo").order("geocodigo");
  if (error || !munis?.length) {
    await atualizarExecucao(sb, exec.id, { status: "erro", mensagem: "tabela municipio vazia: rode ingest-ibge antes" });
    return json({ ok: false, erro: "municipio vazio" }, 409);
  }

  const p = exec.parametros as { ey_start: number; ey_end: number; cursor: number };
  const total = munis.length * DOENCAS.length;
  let cursor = p.cursor ?? 0;
  let registros = exec.registros ?? 0;
  const inicio = Date.now();
  const falhas: string[] = [];

  while (cursor < total && Date.now() - inicio < ORCAMENTO_MS) {
    const doenca = DOENCAS[Math.floor(cursor / munis.length)];
    const geocodigo = munis[cursor % munis.length].geocodigo as number;
    const params = {
      geocode: String(geocodigo), disease: doenca, format: "json",
      ew_start: "1", ew_end: "53", ey_start: String(p.ey_start), ey_end: String(p.ey_end),
    };
    const url = `${BASE}?${new URLSearchParams(params)}`;
    try {
      const r = await buscar(url);
      const idB = await gravarBruto(sb, "infodengue", BASE, params, r.status, r.corpo);
      if (r.status === 200) {
        const { data: n, error: e2 } = await sb.rpc("ingest_infodengue", {
          p_bruto: idB, p_geocodigo: geocodigo, p_doenca: doenca,
        });
        if (e2) falhas.push(`${geocodigo}/${doenca}: ${e2.message}`);
        else registros += n as number;
      } else {
        falhas.push(`${geocodigo}/${doenca}: HTTP ${r.status}`);
      }
    } catch (e) {
      falhas.push(`${geocodigo}/${doenca}: ${e}`);
    }
    cursor++;
    await dormir(INTERVALO_MS);
  }

  const concluido = cursor >= total;
  const mensagens = falhas.length ? falhas.slice(0, 50).join(" | ") : null;
  await atualizarExecucao(sb, exec.id, {
    parametros: { ...p, cursor },
    registros,
    ...(mensagens ? { mensagem: mensagens } : {}),
    ...(concluido ? { status: registros > 0 ? "ok" : "vazio", finalizado_em: new Date().toISOString() } : {}),
  });
  if (concluido) await auditar(sb, "carga", "caso_semanal", { execucao: exec.id, registros });
  return json({ ok: true, execucao: exec.id, cursor, total, registros, concluido, falhas: falhas.length });
});
