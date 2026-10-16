// VigiGen — ingestão IBGE, UF 24 (RN). Fonte de verdade dos geocódigos.
//
// 1) Rota documentada: Localidades v1 + Malhas v3 (servicodados.ibge.gov.br).
// 2) Se a rota 1 falhar (em 2026-10-16 falhou por verificação TLS a partir do
//    Supabase), usa outro serviço oficial do IBGE com TLS válido: o GeoServer
//    geoservicos.ibge.gov.br, camada CCAR:BC250_2025_lml_municipio_a
//    (geocodigo, nome, geometria). A verificação TLS nunca é desligada.
//    A falha da rota 1 fica registrada em execucao_ingestao.mensagem.
import { atualizarExecucao, auditar, autorizado, buscar, cliente, execucaoAtual, gravarBruto, json } from "../_shared/comum.ts";

const URL_MUNICIPIOS = "https://servicodados.ibge.gov.br/api/v1/localidades/estados/24/municipios";
const URL_MALHA =
  "https://servicodados.ibge.gov.br/api/v3/malhas/estados/24?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio";
const WFS = "https://geoservicos.ibge.gov.br/geoserver/ows";
const CAMADA = "CCAR:BC250_2025_lml_municipio_a";

Deno.serve(async (req) => {
  const sb = cliente();
  if (!(await autorizado(req, sb))) return json({ erro: "não autorizado" }, 401);
  const exec = await execucaoAtual(sb, "ibge", true, { uf: 24 });
  const notas: string[] = [];

  // Rota 1 (documentada)
  try {
    const m = await buscar(URL_MUNICIPIOS, {}, 2);
    const idM = await gravarBruto(sb, "ibge", URL_MUNICIPIOS, { uf: 24 }, m.status, m.corpo);
    const g = await buscar(URL_MALHA, {}, 2);
    const idG = await gravarBruto(sb, "ibge", URL_MALHA, { uf: 24, qualidade: "minima" }, g.status, g.corpo);
    if (m.status === 200 && g.status === 200) {
      const { data: n, error } = await sb.rpc("ingest_ibge", { bruto_municipios: idM, bruto_malha: idG });
      if (error) throw new Error(error.message);
      await atualizarExecucao(sb, exec!.id, {
        status: n > 0 ? "ok" : "vazio", registros: n, finalizado_em: new Date().toISOString(),
        parametros: { uf: 24, rota: "servicodados", bruto: [idM, idG] },
      });
      await auditar(sb, "carga", "municipio", { registros: n, rota: "servicodados" });
      return json({ ok: true, rota: "servicodados", municipios: n });
    }
    notas.push(`servicodados respondeu ${m.status}/${g.status}`);
  } catch (e) {
    notas.push(`servicodados falhou: ${String(e).slice(0, 300)}`);
  }

  // Rota 2 (oficial alternativa): WFS do IBGE, em 10 fatias por prefixo do geocódigo
  try {
    let total = 0;
    const brutos: number[] = [];
    for (let d = 0; d <= 9; d++) {
      const params = {
        service: "WFS", version: "2.0.0", request: "GetFeature", typeNames: CAMADA,
        outputFormat: "application/json", srsName: "EPSG:4674",
        CQL_FILTER: `geocodigo LIKE '24${d}%'`,
      };
      const r = await buscar(`${WFS}?${new URLSearchParams(params)}`);
      const idB = await gravarBruto(sb, "ibge", WFS, params, r.status, r.corpo);
      brutos.push(idB);
      if (r.status !== 200) { notas.push(`WFS fatia ${d}: HTTP ${r.status}`); continue; }
      const { data: n, error } = await sb.rpc("ingest_ibge_wfs", { p_bruto: idB });
      if (error) notas.push(`WFS fatia ${d}: ${error.message}`);
      else total += n as number;
    }
    await atualizarExecucao(sb, exec!.id, {
      status: total > 0 ? "ok" : "vazio", registros: total, finalizado_em: new Date().toISOString(),
      parametros: { uf: 24, rota: "geoservicos_wfs", camada: CAMADA, bruto: brutos },
      mensagem: notas.join(" | "),
    });
    await auditar(sb, "carga", "municipio", { registros: total, rota: "geoservicos_wfs", notas });
    return json({ ok: true, rota: "geoservicos_wfs", municipios: total, notas });
  } catch (e) {
    notas.push(String(e));
    await atualizarExecucao(sb, exec!.id, { status: "erro", mensagem: notas.join(" | "), finalizado_em: new Date().toISOString() });
    return json({ ok: false, notas }, 502);
  }
});
