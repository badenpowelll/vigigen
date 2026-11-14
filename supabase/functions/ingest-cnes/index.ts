// VigiGen — estabelecimentos de saúde do RN pelo CNES (API DEMAS), D-020.
// GET https://apidadosabertos.saude.gov.br/cnes/estabelecimentos
//   codigo_uf=24, status=1 (ativos), limit ≤ 20, offset = número da página
//   (swagger v1.8.32). Cadastro público: cada página é gravada crua em
//   public.bruto e normalizada por public.ingest_cnes (017), ligada ao bruto_id.
// Retomável: o cursor (página) fica em execucao_ingestao; o pg_cron chama de novo.
import { atualizarExecucao, auditar, autorizado, buscar, cliente, dormir, execucaoAtual, gravarBruto, json } from "../_shared/comum.ts";

const URL_CNES = "https://apidadosabertos.saude.gov.br/cnes/estabelecimentos";
const LIMITE = 20;
const ORCAMENTO_MS = 100_000;
const INTERVALO_MS = 400;

Deno.serve(async (req) => {
  const sb = cliente();
  if (!(await autorizado(req, sb))) return json({ erro: "não autorizado" }, 401);
  const corpo = await req.json().catch(() => ({}));
  const exec = await execucaoAtual(sb, "cnes", corpo.iniciar === true, { codigo_uf: "24", status: "1", pagina: 0 });
  if (!exec) return json({ ok: true, mensagem: "nenhuma execução em andamento" });

  const p = exec.parametros as { codigo_uf: string; status: string; pagina: number; falhas?: string[] };
  let pagina = p.pagina ?? 0;
  let registros = exec.registros ?? 0;
  const falhas = [...(p.falhas ?? [])];
  const inicio = Date.now();
  let fim = false;

  while (!fim && Date.now() - inicio < ORCAMENTO_MS) {
    const params = { codigo_uf: p.codigo_uf, status: p.status, limit: String(LIMITE), offset: String(pagina) };
    try {
      const r = await buscar(`${URL_CNES}?${new URLSearchParams(params)}`);
      const idB = await gravarBruto(sb, "cnes", URL_CNES, params, r.status, r.corpo);
      if (r.status !== 200) {
        falhas.push(`p${pagina}: HTTP ${r.status}`);
        fim = true; // regra 1: registra e para
        break;
      }
      const n = (JSON.parse(r.corpo).estabelecimentos ?? []).length;
      const { error } = await sb.rpc("ingest_cnes", { p_bruto: idB });
      if (error) falhas.push(`p${pagina}: ${error.message}`);
      registros += n;
      if (n < LIMITE) fim = true;
    } catch (e) {
      falhas.push(`p${pagina}: ${String(e).slice(0, 200)}`);
      fim = true;
      break;
    }
    pagina++;
    await dormir(INTERVALO_MS);
  }

  await atualizarExecucao(sb, exec.id, {
    parametros: { ...p, pagina, falhas: falhas.slice(0, 100) },
    registros,
    ...(falhas.length ? { mensagem: falhas.slice(0, 30).join(" | ") } : {}),
    ...(fim ? { status: falhas.length ? "erro" : (registros > 0 ? "ok" : "vazio"), finalizado_em: new Date().toISOString() } : {}),
  });
  if (fim) await auditar(sb, "carga", "estabelecimento", { execucao: exec.id, registros, paginas: pagina, falhas: falhas.length });
  return json({ ok: true, execucao: exec.id, pagina, registros, concluido: fim, falhas: falhas.length });
});
