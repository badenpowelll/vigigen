import { useMemo, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import type { Malha } from "../dados/tipos";
import { fmtNum } from "../util";

export interface ValorMapa { v: number | null; motivo?: string; detalhe?: string }

interface Props {
  malha: Malha;
  valores: Map<number, ValorMapa>;
  limites: number[];               // 5 limites -> 6 classes da rampa de magnitude
  formatar: (v: number) => string;
  unidade: string;
  titulo: string;
  selecionado: number | null;
  aoSelecionar: (g: number) => void;
}

const CLASSES = ["var(--mag-1)", "var(--mag-2)", "var(--mag-3)", "var(--mag-4)", "var(--mag-5)", "var(--mag-6)"];

export function classe(v: number, limites: number[]) {
  let k = 0;
  while (k < limites.length && v >= limites[k]) k++;
  return k;
}

export function Mapa({ malha, valores, limites, formatar, unidade, titulo, selecionado, aoSelecionar }: Props) {
  const [foco, setFoco] = useState<number | null>(null);
  const W = 640, H = 420;
  const { caminhos } = useMemo(() => {
    const proj = geoMercator().fitExtent([[8, 8], [W - 8, H - 8]], malha);
    const gerador = geoPath(proj);
    return {
      caminhos: malha.features.map((f) => ({ g: f.properties.g, n: f.properties.n, d: gerador(f) ?? "" })),
    };
  }, [malha]);

  const ativo = foco ?? selecionado;
  const infoAtivo = ativo ? caminhos.find((c) => c.g === ativo) : null;
  const valAtivo = ativo ? valores.get(ativo) : undefined;

  return (
    <figure className="min-w-0">
      <div className="relative overflow-hidden rounded-[var(--raio)] border border-borda bg-[var(--superficie-2)]">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="group" aria-label={titulo}>
          <defs>
            <pattern id="hachura-sem-dado" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--mag-nulo)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--estado-nulo)" strokeWidth="1.4" opacity="0.6" />
            </pattern>
          </defs>
          {caminhos.map((c) => {
            const val = valores.get(c.g);
            const tem = val && val.v !== null && val.v !== undefined;
            const fill = !tem ? "url(#hachura-sem-dado)" : val!.v === 0 ? "var(--superficie)" : CLASSES[classe(val!.v as number, limites)];
            const rotulo = `${c.n}: ${tem ? `${formatar(val!.v as number)} ${unidade}` : `sem dado${val?.motivo ? ` (${val.motivo})` : ""}`}`;
            return (
              <path key={c.g} d={c.d} fill={fill} stroke={tem && val!.v === 0 ? "var(--borda)" : "var(--mag-traco)"} strokeWidth={0.6}
                tabIndex={0} role="button" aria-label={rotulo} aria-pressed={selecionado === c.g}
                onMouseEnter={() => setFoco(c.g)} onMouseLeave={() => setFoco(null)}
                onFocus={() => setFoco(c.g)} onBlur={() => setFoco(null)}
                onClick={() => aoSelecionar(c.g)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); aoSelecionar(c.g); } }}
                style={{ cursor: "pointer", outline: "none" }}>
                <title>{rotulo}</title>
              </path>
            );
          })}
          {/* contorno do selecionado por cima */}
          {selecionado && caminhos.filter((c) => c.g === selecionado).map((c) => (
            <path key={"sel" + c.g} d={c.d} fill="none" stroke="var(--texto)" strokeWidth={2.2} pointerEvents="none" />
          ))}
          {foco && foco !== selecionado && caminhos.filter((c) => c.g === foco).map((c) => (
            <path key={"foco" + c.g} d={c.d} fill="none" stroke="var(--destaque)" strokeWidth={2} pointerEvents="none" />
          ))}
        </svg>
        {infoAtivo && (
          <div className="pointer-events-none absolute left-2 top-2 max-w-[70%] rounded-[var(--surface-rounder-sm)] border border-borda bg-superficie/95 px-3 py-1.5 text-sm shadow">
            <strong>{infoAtivo.n}</strong>
            <div className="num text-suave">
              {valAtivo && valAtivo.v !== null ? `${formatar(valAtivo.v)} ${unidade}` : `sem dado${valAtivo?.motivo ? `: ${valAtivo.motivo}` : ""}`}
            </div>
            {valAtivo?.detalhe && <div className="text-xs text-suave">{valAtivo.detalhe}</div>}
          </div>
        )}
      </div>
      <figcaption className="mt-2">
        <Legenda limites={limites} formatar={formatar} unidade={unidade} />
      </figcaption>
    </figure>
  );
}

function Legenda({ limites, formatar, unidade }: { limites: number[]; formatar: (v: number) => string; unidade: string }) {
  const faixas = CLASSES.map((cor, i) => {
    const de = i === 0 ? null : limites[i - 1];
    const ate = i < limites.length ? limites[i] : null;
    const r = de === null ? `< ${formatar(ate!)}` : ate === null ? `≥ ${formatar(de)}` : `${formatar(de)} – ${formatar(ate)}`;
    return { cor, r };
  });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-suave" aria-label={`Legenda em ${unidade}`}>
      <span className="font-semibold">{unidade}:</span>
      {faixas.map((f) => (
        <span key={f.r} className="num inline-flex items-center gap-1">
          <span className="inline-block h-3 w-5 rounded-sm border border-borda" style={{ background: f.cor }} />{f.r}
        </span>
      ))}
      <span className="num inline-flex items-center gap-1">
        <span className="inline-block h-3 w-5 rounded-sm border border-borda" style={{ background: "var(--superficie)" }} />0 (zero observado)
      </span>
      <span className="inline-flex items-center gap-1">
        <svg width="20" height="12" aria-hidden="true"><rect width="20" height="12" fill="url(#hachura-sem-dado)" stroke="var(--borda)" /></svg>
        sem dado
      </span>
    </div>
  );
}

/** Limites "arredondados" a partir de quantis dos valores positivos. */
export function limitesQuantis(vals: number[], k = 5): number[] {
  const pos = vals.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (pos.length < k) return [1, 5, 10, 50, 100].slice(0, k);
  const lim: number[] = [];
  for (let i = 1; i <= k; i++) {
    const q = pos[Math.min(pos.length - 1, Math.floor((i / (k + 1)) * pos.length))];
    const mag = Math.pow(10, Math.floor(Math.log10(q || 1)));
    const r = Math.max(Math.round(q / mag) * mag, lim.length ? lim[lim.length - 1] + mag : 0);
    lim.push(Number(r.toPrecision(2)));
  }
  return [...new Set(lim)];
}

export function TabelaMapa({ linhas, unidade }: { linhas: { n: string; v: number | null; motivo?: string }[]; unidade: string }) {
  return (
    <div className="max-h-80 overflow-auto rounded-[var(--raio)] border border-borda">
      <table className="w-full text-sm">
        <caption className="sr-only">Tabela alternativa ao mapa</caption>
        <thead className="sticky top-0 bg-[var(--superficie-2)] text-left">
          <tr><th className="px-3 py-1.5">Município</th><th className="px-3 py-1.5 text-right">{unidade}</th></tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.n} className="border-t border-borda">
              <td className="px-3 py-1">{l.n}</td>
              <td className="num px-3 py-1 text-right">{l.v === null ? <span className="text-suave">sem dado{l.motivo ? ` (${l.motivo})` : ""}</span> : fmtNum(l.v, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
