import { useEffect, useMemo, useRef, useState } from "react";
import { scaleLinear, scaleTime } from "d3-scale";
import { line } from "d3-shape";
import { fmtNum } from "../util";

export interface SerieLinha { nome: string; cor: string; pontos: { t: Date; v: number | null }[]; tracejado?: boolean }

const ANOS = (ini: Date, fim: Date) => {
  const a: Date[] = [];
  for (let y = ini.getUTCFullYear(); y <= fim.getUTCFullYear(); y++) a.push(new Date(Date.UTC(y, 0, 1)));
  return a.filter((d) => d >= ini && d <= fim);
};

/** Largura real do contêiner, para o texto do SVG sair no tamanho certo. */
function useLargura(padrao: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(padrao);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Linhas no tempo. Eixo x compartilhável: passe `dominio` igual para gráficos alinhados. */
export function GraficoLinhas({ series, dominio, unidade, titulo, altura = 240 }:
  { series: SerieLinha[]; dominio: [Date, Date]; unidade: string; titulo: string; altura?: number }) {
  const [caixa, W] = useLargura(720);
  const H = altura, m = { t: 12, r: 12, b: 26, l: 52 };
  const [foco, setFoco] = useState<number | null>(null);
  const { x, y, caminhos, ticks } = useMemo(() => {
    const max = Math.max(1, ...series.flatMap((s) => s.pontos.map((p) => p.v ?? 0)));
    const x = scaleTime().domain(dominio).range([m.l, W - m.r]);
    const y = scaleLinear().domain([0, max]).nice(4).range([H - m.b, m.t]);
    const gen = line<{ t: Date; v: number | null }>().defined((p) => p.v !== null).x((p) => x(p.t)).y((p) => y(p.v as number));
    return { x, y, caminhos: series.map((s) => gen(s.pontos.filter((p) => p.t >= dominio[0])) ?? ""), ticks: y.ticks(4) };
  }, [series, dominio, H, W]);

  const base = series[0]?.pontos ?? [];
  const pontoFoco = foco !== null ? base[foco] : null;
  // índice do primeiro ponto visível no domínio, para o teclado
  const primeiro = Math.max(0, base.findIndex((p) => p.t >= dominio[0]));

  function teclado(ev: React.KeyboardEvent<SVGSVGElement>) {
    if (!base.length) return;
    const passo = ev.shiftKey ? 4 : 1;
    let i = foco ?? base.length - 1;
    if (ev.key === "ArrowLeft") i = Math.max(primeiro, i - passo);
    else if (ev.key === "ArrowRight") i = Math.min(base.length - 1, i + passo);
    else if (ev.key === "Home") i = primeiro;
    else if (ev.key === "End") i = base.length - 1;
    else if (ev.key === "Escape") { setFoco(null); return; }
    else return;
    ev.preventDefault(); setFoco(i);
  }

  function mover(ev: React.PointerEvent<SVGRectElement>) {
    const r = (ev.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const t = x.invert(px).getTime();
    let best = 0, dist = Infinity;
    base.forEach((p, i) => { const dd = Math.abs(p.t.getTime() - t); if (dd < dist) { dist = dd; best = i; } });
    setFoco(best);
  }

  return (
    <figure className="min-w-0">
      <div className="overflow-x-auto" ref={caixa}>
        <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="grafico-foco block h-auto w-full min-w-[320px]" role="img" tabIndex={0}
          aria-label={`${titulo}. Use as setas para percorrer as semanas.`} onKeyDown={teclado} onBlur={() => setFoco(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--borda)" />
              <text x={m.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--texto-suave)" className="num">{fmtNum(t)}</text>
            </g>
          ))}
          {ANOS(dominio[0], dominio[1]).map((a) => (
            <g key={a.getTime()}>
              <line x1={x(a)} x2={x(a)} y1={m.t} y2={H - m.b} stroke="var(--borda)" strokeDasharray="2 3" />
              <text x={x(a) + 3} y={H - 8} fontSize="11" fill="var(--texto-suave)" className="num">{a.getUTCFullYear()}</text>
            </g>
          ))}
          {series.map((s, i) => (
            <path key={s.nome} d={caminhos[i]} fill="none" stroke={s.cor} strokeWidth={1.8}
              strokeDasharray={s.tracejado ? "4 3" : undefined} strokeLinejoin="round" />
          ))}
          {pontoFoco && <line x1={x(pontoFoco.t)} x2={x(pontoFoco.t)} y1={m.t} y2={H - m.b} stroke="var(--texto-suave)" />}
          {pontoFoco && series.map((s) => {
            const v = s.pontos[foco!]?.v;
            return v == null ? null : <circle key={s.nome} cx={x(pontoFoco.t)} cy={y(v)} r={4} fill={s.cor} stroke="var(--superficie)" strokeWidth={1.5} />;
          })}
          <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} fill="transparent"
            onPointerMove={mover} onPointerDown={mover} onPointerLeave={() => setFoco(null)} />
        </svg>
        {pontoFoco && (
          <div className="grafico-dica" aria-hidden="true"
            style={{ left: `${(x(pontoFoco.t) / W) * 100}%`, top: 4, transform: x(pontoFoco.t) > W * 0.6 ? "translateX(calc(-100% - 10px))" : "translateX(10px)" }}>
            <div className="font-semibold">Semana de {pontoFoco.t.toLocaleDateString("pt-BR")}</div>
            {series.map((s) => (
              <div key={s.nome} className="num flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.cor }} />{s.nome}: <strong>{s.pontos[foco!]?.v == null ? "sem dado" : fmtNum(s.pontos[foco!]!.v)}</strong>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-suave">
        {series.map((s) => (
          <span key={s.nome} className="inline-flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden="true"><line x1="0" x2="18" y1="4" y2="4" stroke={s.cor} strokeWidth="2.5" strokeDasharray={s.tracejado ? "4 3" : undefined} /></svg>
            {s.nome}
          </span>
        ))}
        <span>· {unidade}</span>
        {pontoFoco && (
          <span className="num ml-auto font-semibold text-texto" aria-live="polite">
            {pontoFoco.t.toLocaleDateString("pt-BR")}: {series.map((s) => `${s.nome} ${fmtNum(s.pontos[foco!]?.v ?? null)}`).join(" · ")}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/** Barras empilhadas 100% por ano, no mesmo eixo de tempo das linhas. */
export function BarrasComposicao({ dados, categorias, cores, dominio, titulo }:
  { dados: { a: number; s: string; n: number }[]; categorias: string[]; cores: Record<string, string>; dominio: [Date, Date]; titulo: string }) {
  const [caixa, W] = useLargura(720);
  const H = 150, m = { t: 8, r: 12, b: 26, l: 52 };
  const x = scaleTime().domain(dominio).range([m.l, W - m.r]);
  const anos = [...new Set(dados.map((d) => d.a))].filter((a) => new Date(Date.UTC(a, 11, 31)) >= dominio[0]).sort();
  const vazios: number[] = [];
  for (let a = dominio[0].getUTCFullYear(); a <= dominio[1].getUTCFullYear(); a++) if (!anos.includes(a)) vazios.push(a);
  const y = scaleLinear().domain([0, 1]).range([H - m.b, m.t]);
  return (
    <figure className="min-w-0">
      <div className="overflow-x-auto" ref={caixa}>
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full min-w-[320px]" role="img" aria-label={titulo}>
          <defs>
            <pattern id="hachura-sem-dado" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--mag-nulo)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--estado-nulo)" strokeWidth="1.4" opacity="0.6" />
            </pattern>
          </defs>
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--borda)" />
              <text x={m.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--texto-suave)">{t * 100}%</text>
            </g>
          ))}
          {vazios.map((a) => {
            const x0 = x(new Date(Date.UTC(a, 0, 1))) + 2, x1 = Math.min(x(new Date(Date.UTC(a + 1, 0, 1))), W - m.r) - 2;
            return (
              <g key={"v" + a}>
                <rect x={x0} width={Math.max(0, x1 - x0)} y={m.t} height={H - m.b - m.t} fill="url(#hachura-sem-dado)" opacity={0.6} />
                <text x={(x0 + x1) / 2} y={(H - m.b + m.t) / 2} textAnchor="middle" fontSize="11" fill="var(--texto-suave)">sem sequência</text>
                <text x={(x0 + x1) / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--texto-suave)" className="num">{a}</text>
              </g>
            );
          })}
          {anos.map((a) => {
            const linhas = dados.filter((d) => d.a === a);
            const tot = linhas.reduce((s, d) => s + d.n, 0);
            const x0 = x(new Date(Date.UTC(a, 0, 1))) + 2, x1 = Math.min(x(new Date(Date.UTC(a + 1, 0, 1))), W - m.r) - 2;
            let acc = 0;
            return (
              <g key={a}>
                {categorias.map((c) => {
                  const n = linhas.find((l) => l.s === c)?.n ?? 0;
                  if (!n) return null;
                  const y0 = y(acc / tot), y1 = y((acc + n) / tot);
                  acc += n;
                  return (
                    <rect key={c} x={x0} width={Math.max(0, x1 - x0)} y={y1} height={y0 - y1} fill={cores[c]} stroke="var(--superficie)" strokeWidth={1}>
                      <title>{`${a} · ${c}: ${n} sequências (${fmtNum((n / tot) * 100, 0)}%)`}</title>
                    </rect>
                  );
                })}
                <text x={(x0 + x1) / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--texto-suave)" className="num">{W < 560 ? `'${String(a).slice(2)}` : `${a} · n=${tot}`}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-suave">
        {categorias.map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: cores[c] }} />{c}</span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Radar de percentis (0–100). A linha tracejada é a mediana do estado (50). */
export function Radar({ eixos, titulo }: { eixos: { nome: string; p: number | null }[]; titulo: string }) {
  const S = 300, c = S / 2, R = 108;
  const n = eixos.length;
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, r: number) => [c + Math.cos(ang(i)) * r, c + Math.sin(ang(i)) * r];
  const poli = (vals: (number | null)[]) => vals.map((v, i) => pt(i, ((v ?? 0) / 100) * R).join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="mx-auto block h-auto w-full max-w-[340px]" role="img" aria-label={titulo}>
      {[25, 50, 75, 100].map((r) => (
        <polygon key={r} points={poli(eixos.map(() => r))} fill="none" stroke="var(--borda)" strokeDasharray={r === 50 ? "4 3" : undefined} strokeWidth={r === 50 ? 1.5 : 1} />
      ))}
      {eixos.map((e, i) => {
        const [lx, ly] = pt(i, R + 22);
        const [ex, ey] = pt(i, R);
        return (
          <g key={e.nome}>
            <line x1={c} y1={c} x2={ex} y2={ey} stroke="var(--borda)" />
            <text x={lx} y={ly} textAnchor="middle" dy="0.32em" fontSize="11" fill="var(--texto-suave)">{e.nome}</text>
          </g>
        );
      })}
      <polygon points={poli(eixos.map((e) => e.p))} fill="var(--destaque)" fillOpacity={0.18} stroke="var(--destaque)" strokeWidth={2} />
      {eixos.map((e, i) => e.p === null ? null : (
        <circle key={e.nome} cx={pt(i, (e.p / 100) * R)[0]} cy={pt(i, (e.p / 100) * R)[1]} r={5} fill="var(--destaque)" tabIndex={0}
          aria-label={`${e.nome}: percentil ${fmtNum(e.p)} entre os municípios do RN`}>
          <title>{`${e.nome}: percentil ${fmtNum(e.p)} (50 = mediana do estado)`}</title>
        </circle>
      ))}
    </svg>
  );
}
