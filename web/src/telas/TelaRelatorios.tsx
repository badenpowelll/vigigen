import { useEffect, useMemo, useState } from "react";
import type { Ctx } from "./ctx";
import { Nota, Secao } from "../componentes/basicos";
import { gerarCsv, gerarPdf, gerarXlsx, metadados, montarRelatorios, nomeArquivo, prepararDownloads, salvar, textoCelula } from "../relatorios";
import { registrarUso } from "../util";

const PREVIA = 25;
type Formato = "csv" | "xlsx" | "pdf";

export function TelaRelatorios(ctx: Ctx) {
  const relatorios = useMemo(() => montarRelatorios(ctx), [ctx.dados, ctx.doenca, ctx.g, ctx.serieMun, ctx.nomeSel]);
  const [id, setId] = useState(relatorios[0].id);
  const [ocupado, setOcupado] = useState<Formato | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const rel = relatorios.find((r) => r.id === id) ?? relatorios[0];
  const vazio = rel.linhas.length === 0;

  useEffect(() => { prepararDownloads(); }, []);
  useEffect(() => { setMsg(null); }, [id, ctx.doenca, ctx.g]);

  async function exportar(f: Formato) {
    setOcupado(f); setMsg(null);
    try {
      const em = new Date();
      const meta = metadados(rel, ctx, em);
      const dado = f === "csv" ? gerarCsv(rel, meta) : f === "xlsx" ? await gerarXlsx(rel, meta) : await gerarPdf(rel, meta);
      const r = await salvar(nomeArquivo(rel, ctx, f, em), dado);
      setMsg({ ok: r.ok, t: r.msg });
      if (r.ok) registrarUso(`exportar:${rel.id}:${f}`);
    } catch (e) {
      setMsg({ ok: false, t: `Não foi possível gerar o arquivo: ${(e as Error).message}` });
    } finally {
      setOcupado(null);
    }
  }

  function imprimir() {
    document.body.classList.add("imprimindo-relatorio");
    const fim = () => { document.body.classList.remove("imprimindo-relatorio"); removeEventListener("afterprint", fim); };
    addEventListener("afterprint", fim);
    try { window.print(); registrarUso(`imprimir:${rel.id}`); } catch { setMsg({ ok: false, t: "Este visualizador bloqueou a impressão. Baixe o PDF e imprima por ele." }); }
    setTimeout(fim, 1500);
  }

  const meta = metadados(rel, ctx, new Date());

  return (
    <div className="flex flex-col gap-4">
      <Secao id="rel-escolha" titulo="Relatórios" subtitulo="Escolha um relatório, confira a prévia e exporte em CSV, XLSX ou PDF, ou imprima.">
        <fieldset>
          <legend className="br-rotulo mb-2">Relatório</legend>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {relatorios.map((r) => (
              <label key={r.id}
                className={`flex cursor-pointer gap-3 rounded-[var(--raio)] border p-3 ${r.id === id ? "border-imd bg-[var(--superficie-2)] dark:border-destaque" : "border-borda hover:bg-[var(--superficie-2)]"}`}>
                <input type="radio" name="relatorio" value={r.id} checked={r.id === id} onChange={() => setId(r.id)} className="mt-1 accent-[var(--interactive)]" />
                <span className="min-w-0">
                  <span className="block font-semibold leading-snug">{r.titulo}</span>
                  <span className="block text-sm text-suave">{r.descricao} {r.linhas.length} linha{r.linhas.length === 1 ? "" : "s"}.</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </Secao>

      <div id="area-impressao">
        <Secao id="rel-previa" titulo={rel.titulo}
          subtitulo={<>Fonte: {rel.fonte}</>}
          acoes={
            <div className="sem-impressao flex flex-wrap gap-2">
              <button type="button" className="br-button secondary small" onClick={imprimir} disabled={vazio}>Imprimir</button>
              {(["csv", "xlsx", "pdf"] as Formato[]).map((f) => (
                <button key={f} type="button" className="br-button primary small" disabled={vazio || ocupado !== null} onClick={() => exportar(f)}
                  aria-label={`Baixar ${rel.titulo} em ${f.toUpperCase()}`}>
                  {ocupado === f ? "Gerando…" : f.toUpperCase()}
                </button>
              ))}
            </div>
          }>
          {msg && <div className="sem-impressao mb-3"><Nota tipo={msg.ok ? "info" : "aviso"}>{msg.t}</Nota></div>}
          {vazio && <Nota tipo="aviso">Este relatório não tem linhas no banco agora, então não há o que exportar. Nada é preenchido no lugar.</Nota>}

          <dl className="mb-3 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
            {meta.filter(([k]) => k !== "Relatório").map(([k, v], i) => (
              <div key={i} className="contents">
                <dt className="font-semibold">{k}</dt>
                <dd className="text-suave">{v}</dd>
              </div>
            ))}
          </dl>

          {!vazio && (
            <>
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Prévia do relatório">
                <table className="tabela-relatorio w-full text-sm">
                  <thead>
                    <tr>{rel.colunas.map((c) => <th key={c.r} className={c.tipo ? "text-right" : "text-left"}>{c.r}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rel.linhas.map((l, i) => (
                      <tr key={i} className={i >= PREVIA ? "so-impressao" : undefined}>
                        {l.map((v, j) => <td key={j} className={rel.colunas[j].tipo ? "text-right tabular-nums" : ""}>{textoCelula(v, rel.colunas[j]) || "—"}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rel.linhas.length > PREVIA && (
                <p className="sem-impressao mt-2 text-sm text-suave">
                  Prévia com as primeiras {PREVIA} de {rel.linhas.length} linhas. Os arquivos e a impressão levam todas.
                </p>
              )}
            </>
          )}
        </Secao>
      </div>
    </div>
  );
}
