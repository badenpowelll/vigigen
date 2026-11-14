import { useEffect, useMemo, useRef, useState } from "react";
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
  /** clique no fundo do mapa (fora dos municípios) ou no botão "Estado inteiro": volta ao RN */
  aoSelecionarEstado?: () => void;
  /** prefixo da rampa de cor (variáveis CSS --<paleta>-1..6); sem ela, a rampa azul de magnitude */
  paleta?: string;
  /** mapa pequeno (comparação lado a lado): sem rótulo de dica longo */
  compacto?: boolean;
}

const MAG = ["var(--mag-1)", "var(--mag-2)", "var(--mag-3)", "var(--mag-4)", "var(--mag-5)", "var(--mag-6)"];
export const coresDe = (paleta?: string) => (paleta ? [1, 2, 3, 4, 5, 6].map((i) => `var(--${paleta}-${i})`) : MAG);

export function classe(v: number, limites: number[]) {
  let k = 0;
  while (k < limites.length && v >= limites[k]) k++;
  return k;
}

const K_MIN = 1, K_MAX = 12, K_ROTULOS = 2;
interface Vista { k: number; x: number; y: number }
const VISTA0: Vista = { k: 1, x: 0, y: 0 };

/** Zoom em torno de um ponto (coordenadas do viewBox), mantendo esse ponto parado. */
export function zoomEm(v: Vista, fator: number, px: number, py: number, W: number, H: number): Vista {
  const k = Math.min(K_MAX, Math.max(K_MIN, v.k * fator));
  const f = k / v.k;
  return limitar({ k, x: px - (px - v.x) * f, y: py - (py - v.y) * f }, W, H);
}
/** Não deixa o mapa sair do quadro. */
export function limitar(v: Vista, W: number, H: number): Vista {
  const minX = W - W * v.k, minY = H - H * v.k;
  return { k: v.k, x: Math.min(0, Math.max(minX, v.x)), y: Math.min(0, Math.max(minY, v.y)) };
}

export function Mapa({ malha, valores, limites, formatar, unidade, titulo, selecionado, aoSelecionar, aoSelecionarEstado, paleta, compacto }: Props) {
  const [foco, setFoco] = useState<number | null>(null);
  const [vista, setVista] = useState<Vista>(VISTA0);
  const [arrastando, setArrastando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const ponteiros = useRef(new Map<number, { x: number; y: number }>());
  const gesto = useRef<{ x: number; y: number; v: Vista; moveu: boolean; dist?: number } | null>(null);
  const W = 640, H = 420;
  const CLASSES = coresDe(paleta);
  const { caminhos } = useMemo(() => {
    const proj = geoMercator().fitExtent([[8, 8], [W - 8, H - 8]], malha);
    const gerador = geoPath(proj);
    return {
      caminhos: malha.features.map((f) => {
        const [cx, cy] = gerador.centroid(f);
        return { g: f.properties.g, n: f.properties.n, d: gerador(f) ?? "", cx, cy };
      }),
    };
  }, [malha]);

  // Converte um ponto da tela para o viewBox do svg.
  const noViewBox = (cx: number, cy: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width) return { x: W / 2, y: H / 2 };
    return { x: ((cx - r.left) / r.width) * W, y: ((cy - r.top) / r.height) * H };
  };
  const avisar = (t: string) => { setAviso(t); window.setTimeout(() => setAviso((a) => (a === t ? null : a)), 1800); };
  const zoomBotao = (fator: number) => setVista((v) => zoomEm(v, fator, W / 2, H / 2, W, H));
  const centrarEm = (g: number) => {
    const c = caminhos.find((x) => x.g === g);
    if (!c || !Number.isFinite(c.cx)) return;
    setVista((v) => {
      if (v.k <= 1) return v;
      const sx = c.cx * v.k + v.x, sy = c.cy * v.k + v.y;
      if (sx > 40 && sx < W - 40 && sy > 40 && sy < H - 40) return v;
      return limitar({ k: v.k, x: W / 2 - c.cx * v.k, y: H / 2 - c.cy * v.k }, W, H);
    });
  };

  // Roda do mouse: com Ctrl (ou Cmd) aproxima; sem, a página rola normalmente.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const f = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) { avisar("Use Ctrl + rolagem (ou os botões + e −) para aproximar"); return; }
      e.preventDefault();
      const p = noViewBox(e.clientX, e.clientY);
      setVista((v) => zoomEm(v, e.deltaY < 0 ? 1.25 : 0.8, p.x, p.y, W, H));
    };
    el.addEventListener("wheel", f, { passive: false });
    return () => el.removeEventListener("wheel", f);
  }, []);

  const aoBaixar = (e: React.PointerEvent<SVGSVGElement>) => {
    ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...ponteiros.current.values()];
    const dist = pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : undefined;
    gesto.current = { x: e.clientX, y: e.clientY, v: vista, moveu: false, dist };
  };
  const aoMover = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!ponteiros.current.has(e.pointerId) || !gesto.current) return;
    ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...ponteiros.current.values()];
    const r = svgRef.current!.getBoundingClientRect();
    const escala = W / (r.width || W);
    if (pts.length === 2 && gesto.current.dist) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const m = noViewBox((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
      gesto.current.moveu = true;
      setVista(zoomEm(gesto.current.v, d / gesto.current.dist, m.x, m.y, W, H));
      return;
    }
    const dx = (e.clientX - gesto.current.x) * escala, dy = (e.clientY - gesto.current.y) * escala;
    if (!gesto.current.moveu && Math.hypot(dx, dy) < 4) return;
    if (gesto.current.v.k <= 1) return;   // sem zoom, não há o que arrastar
    gesto.current.moveu = true;
    setArrastando(true);
    setVista(limitar({ k: gesto.current.v.k, x: gesto.current.v.x + dx, y: gesto.current.v.y + dy }, W, H));
  };
  const aoSoltar = (e: React.PointerEvent<SVGSVGElement>) => {
    ponteiros.current.delete(e.pointerId);
    setArrastando(false);
    if (ponteiros.current.size === 0) window.setTimeout(() => { gesto.current = null; }, 0);
  };
  const foiArraste = () => !!gesto.current?.moveu;

  const aoTeclar = (e: React.KeyboardEvent) => {
    const passo = 40;
    if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBotao(1.5); avisar(`Zoom ${Math.round(Math.min(K_MAX, vista.k * 1.5) * 100)}%`); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomBotao(1 / 1.5); }
    else if (e.key === "0") { e.preventDefault(); setVista(VISTA0); avisar("Mapa inteiro"); }
    else if (vista.k > 1 && e.shiftKey && e.key.startsWith("Arrow")) {
      e.preventDefault();
      const d = { ArrowLeft: [passo, 0], ArrowRight: [-passo, 0], ArrowUp: [0, passo], ArrowDown: [0, -passo] }[e.key] ?? [0, 0];
      setVista((v) => limitar({ k: v.k, x: v.x + d[0], y: v.y + d[1] }, W, H));
    }
  };

  const ativo = foco ?? selecionado;
  const infoAtivo = ativo ? caminhos.find((c) => c.g === ativo) : null;
  const valAtivo = ativo ? valores.get(ativo) : undefined;
  const traco = 1 / vista.k;
  const verRotulos = vista.k >= K_ROTULOS;
  const visivel = (c: { cx: number; cy: number }) => {
    const sx = c.cx * vista.k + vista.x, sy = c.cy * vista.k + vista.y;
    return sx > -20 && sx < W + 20 && sy > -10 && sy < H + 10;
  };

  return (
    <figure className="min-w-0">
      <button type="button" className="pular-mapa" onClick={(e) => (e.currentTarget.parentElement?.querySelector("figcaption") as HTMLElement | null)?.focus()}>
        Pular o mapa ({caminhos.length} municípios); a mesma informação está em "Ver como tabela"
      </button>
      <div className="relative overflow-hidden rounded-[var(--raio)] border border-borda bg-[var(--superficie-2)]" onKeyDown={aoTeclar}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className={`mapa-palco block h-auto w-full ${arrastando ? "arrastando" : ""}`}
          role="group" aria-label={`${titulo}. Tecla + aproxima, − afasta, 0 volta ao mapa inteiro, Shift + setas move o mapa aproximado.`}
          aria-roledescription="mapa interativo"
          onPointerDown={aoBaixar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar} onPointerLeave={aoSoltar}
          onDoubleClick={(e) => { const p = noViewBox(e.clientX, e.clientY); setVista((v) => zoomEm(v, e.shiftKey ? 0.5 : 2, p.x, p.y, W, H)); }}>
          <defs>
            <pattern id="hachura-sem-dado" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--mag-nulo)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--estado-nulo)" strokeWidth="1.4" opacity="0.6" />
            </pattern>
          </defs>
          {aoSelecionarEstado && (
            <rect width={W} height={H} fill="transparent" aria-hidden="true"
              onClick={() => { if (!foiArraste()) aoSelecionarEstado(); }} />
          )}
          <g transform={`translate(${vista.x},${vista.y}) scale(${vista.k})`}>
            {caminhos.map((c) => {
              const val = valores.get(c.g);
              const tem = val && val.v !== null && val.v !== undefined;
              const fill = !tem ? "url(#hachura-sem-dado)" : val!.v === 0 ? "var(--superficie)" : CLASSES[classe(val!.v as number, limites)];
              const rotulo = `${c.n}: ${tem ? `${formatar(val!.v as number)} ${unidade}` : `sem dado${val?.motivo ? ` (${val.motivo})` : ""}`}${val?.detalhe ? `; ${val.detalhe}` : ""}`;
              return (
                <path key={c.g} d={c.d} fill={fill} stroke={tem && val!.v === 0 ? "var(--borda)" : "var(--mag-traco)"} strokeWidth={0.6 * traco}
                  tabIndex={0} role="button" aria-label={rotulo} aria-pressed={selecionado === c.g}
                  onMouseEnter={() => setFoco(c.g)} onMouseLeave={() => setFoco(null)}
                  onFocus={() => { setFoco(c.g); centrarEm(c.g); }} onBlur={() => setFoco(null)}
                  onClick={() => { if (!foiArraste()) aoSelecionar(c.g); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); aoSelecionar(c.g); } }}
                  style={{ cursor: "pointer", outline: "none" }}>
                  <title>{rotulo}</title>
                </path>
              );
            })}
            {selecionado && caminhos.filter((c) => c.g === selecionado).map((c) => (
              <path key={"sel" + c.g} d={c.d} fill="none" stroke="var(--texto)" strokeWidth={2.2 * traco} pointerEvents="none" />
            ))}
            {foco && foco !== selecionado && caminhos.filter((c) => c.g === foco).map((c) => (
              <path key={"foco" + c.g} d={c.d} fill="none" stroke="var(--destaque)" strokeWidth={2 * traco} pointerEvents="none" />
            ))}
            {verRotulos && caminhos.filter((c) => Number.isFinite(c.cx) && visivel(c)).map((c) => (
              <text key={"r" + c.g} x={c.cx} y={c.cy} textAnchor="middle" dominantBaseline="middle" className="mapa-rotulo"
                fontSize={9 / vista.k} strokeWidth={2.5 / vista.k} aria-hidden="true">{c.n}</text>
            ))}
          </g>
        </svg>
        <div className="mapa-zoom">
          <button type="button" aria-label="Aproximar o mapa" title="Aproximar (+)" onClick={() => zoomBotao(1.5)} disabled={vista.k >= K_MAX}>+</button>
          <button type="button" aria-label="Afastar o mapa" title="Afastar (−)" onClick={() => zoomBotao(1 / 1.5)} disabled={vista.k <= K_MIN}>−</button>
          <button type="button" aria-label="Ver o mapa inteiro" title="Mapa inteiro (0)" onClick={() => setVista(VISTA0)} disabled={vista.k === 1}>⟲</button>
        </div>
        {aviso && <div className="mapa-aviso" role="status">{aviso}</div>}
        {infoAtivo && (
          <div className={`pointer-events-none absolute left-2 top-2 max-w-[70%] rounded-[var(--surface-rounder-sm)] border border-borda bg-superficie/95 px-3 py-1.5 shadow ${compacto ? "text-xs" : "text-sm"}`}>
            <strong>{infoAtivo.n}</strong>
            <div className="num text-suave">
              {valAtivo && valAtivo.v !== null ? `${formatar(valAtivo.v)} ${unidade}` : `sem dado${valAtivo?.motivo ? `: ${valAtivo.motivo}` : ""}`}
            </div>
            {valAtivo?.detalhe && <div className="text-xs text-suave">{valAtivo.detalhe}</div>}
            {!compacto && <div className="text-xs text-suave">Clique para selecionar o município no painel</div>}
          </div>
        )}
      </div>
      <figcaption className="mt-2 outline-none" tabIndex={-1}>
        <Legenda limites={limites} formatar={formatar} unidade={unidade} cores={CLASSES} />
        {aoSelecionarEstado && !compacto && (
          <button type="button" className="br-button secondary small mt-2" onClick={aoSelecionarEstado} aria-pressed={selecionado === null}>
            Ver o Rio Grande do Norte inteiro
          </button>
        )}
        {!compacto && <p className="mt-1 text-xs text-suave">Zoom: botões + e −, duplo clique, Ctrl + rolagem ou pinça no celular; arraste para mover. Teclado: + e − aproximam, 0 volta ao mapa inteiro, Shift + setas movem. Nomes dos municípios aparecem ao aproximar.{aoSelecionarEstado ? " Clique fora dos municípios para ver o estado inteiro." : ""}</p>}
      </figcaption>
    </figure>
  );
}

function Legenda({ limites, formatar, unidade, cores }: { limites: number[]; formatar: (v: number) => string; unidade: string; cores: string[] }) {
  const faixas = cores.map((cor, i) => {
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
    <div className="max-h-80 overflow-auto rounded-[var(--raio)] border border-borda" tabIndex={0} role="region" aria-label={`Tabela do mapa: ${unidade}`}>
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
