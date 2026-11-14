import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { fmtNum } from "../util";

/* ---------- Marca Hélice-pulso ---------- */
export function Marca({ variante = "cor", className = "", titulo = "VigiGen" }:
  { variante?: "cor" | "escuro" | "mono"; className?: string; titulo?: string }) {
  const cores = {
    cor: ["var(--id-1)", "#9CC3EE", "var(--id-2)"],
    escuro: ["#FFFFFF", "rgba(255,255,255,.45)", "#EB6834"],
    mono: ["currentColor", "currentColor", "currentColor"],
  }[variante];
  return (
    <svg viewBox="0 0 120 64" className={className} role="img" aria-label={titulo}>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 23 V41 M42 23 V41" stroke={cores[1]} strokeWidth="4.5" opacity={variante === "mono" ? 0.45 : 1} />
        <path d="M6 32 C8 15, 28 15, 30 32 C32 49, 52 49, 54 32 C52 15, 32 15, 30 32 C28 49, 8 49, 6 32 Z" stroke={cores[0]} strokeWidth="6.5" />
        <path d="M54 32 H61 L68 7 L77 57 L83 32 H113" stroke={cores[2]} strokeWidth="6.5" />
      </g>
    </svg>
  );
}

/* ---------- StatusBadge: o ÚNICO caminho para exibir estado ---------- */
export type Nivel = 1 | 2 | 3 | 4;
const NIVEIS: Record<Nivel, { rotulo: string; desc: string }> = {
  1: { rotulo: "Baixo", desc: "Condições favoráveis, sem sinal" },
  2: { rotulo: "Atenção", desc: "Condição climática propensa" },
  3: { rotulo: "Alerta", desc: "Transmissão sustentada" },
  4: { rotulo: "Emergência", desc: "Incidência alta, risco de epidemia" },
};

export function IconeNivel({ nivel, tamanho = 18 }: { nivel: Nivel | null; tamanho?: number }) {
  const cor = nivel ? `var(--estado-${nivel})` : "var(--estado-nulo)";
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 20 20" aria-hidden="true">
      {nivel === 1 && (<><circle cx="10" cy="10" r="8" fill="none" stroke={cor} strokeWidth="2.4" /><path d="M5.5 10h9" stroke={cor} strokeWidth="2.4" strokeLinecap="round" /></>)}
      {nivel === 2 && <path d="M10 2.5 18 17H2Z" fill="none" stroke={cor} strokeWidth="2.2" strokeLinejoin="round" />}
      {nivel === 3 && <path d="M10 2.5 18 17H2Z" fill={cor} stroke={cor} strokeWidth="2.2" strokeLinejoin="round" />}
      {nivel === 4 && <path d="M6.7 2h6.6L18 6.7v6.6L13.3 18H6.7L2 13.3V6.7Z" fill={cor} />}
      {nivel === null && <circle cx="10" cy="10" r="7.5" fill="none" stroke={cor} strokeWidth="2" strokeDasharray="3 2.5" />}
    </svg>
  );
}

export function StatusBadge({ nivel, grande = false, descricao = false }: { nivel: Nivel | null; grande?: boolean; descricao?: boolean }) {
  const info = nivel ? NIVEIS[nivel] : null;
  const corTexto = nivel ? `var(--estado-${nivel}-texto)` : "var(--texto-suave)";
  return (
    <span className={`inline-flex items-center gap-2 ${grande ? "text-2xl font-bold" : "text-sm font-semibold"}`}
      style={{ color: corTexto }} role="status"
      aria-label={info ? `Nível ${nivel}: ${info.rotulo}. ${info.desc}` : "Nível de alerta: sem dado"}>
      <IconeNivel nivel={nivel} tamanho={grande ? 30 : 16} />
      <span>{info ? info.rotulo : "Sem dado"}</span>
      {grande && info && <span className="text-sm font-medium text-suave">nível {nivel} de 4</span>}
      {descricao && info && <span className="text-xs font-normal text-suave">· {info.desc}</span>}
    </span>
  );
}

/* ---------- Sparkline de 12 pontos ---------- */
export function Sparkline({ valores, rotulo }: { valores: (number | null)[]; rotulo: string }) {
  const w = 120, h = 32, pad = 3;
  const v = valores.map((x) => (x === null || x === undefined ? null : x));
  const nums = v.filter((x): x is number => x !== null);
  if (nums.length < 2) return <span className="text-xs text-suave">série curta</span>;
  const max = Math.max(...nums, 1), min = Math.min(...nums, 0);
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (v.length - 1);
  const y = (val: number) => h - pad - ((val - min) / (max - min || 1)) * (h - 2 * pad);
  let d = "", area = "";
  v.forEach((val, i) => {
    if (val === null) return;
    d += `${d ? "L" : "M"}${x(i).toFixed(1)},${y(val).toFixed(1)}`;
  });
  const primeiros = v.findIndex((q) => q !== null);
  const ultimoI = v.length - 1 - [...v].reverse().findIndex((q) => q !== null);
  area = `${d}L${x(ultimoI).toFixed(1)},${h - pad}L${x(primeiros).toFixed(1)},${h - pad}Z`;
  const ultimo = v[ultimoI] as number;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={rotulo}>
      <path d={area} fill="var(--destaque)" opacity="0.12" />
      <path d={d} fill="none" stroke="var(--destaque)" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx={x(ultimoI)} cy={y(ultimo)} r="2.8" fill="var(--destaque)" />
    </svg>
  );
}

/* ---------- KpiCard: período e fonte são obrigatórios no tipo ---------- */
export interface Variacao { valor: number; unidade?: string; contra: string; maiorEhPior?: boolean }
export interface KpiProps {
  titulo: string;
  periodo: string;                       // obrigatório: número sem período é número errado
  fonte: { nome: string; atualizado: string };  // obrigatório
  valor: ReactNode | null;               // null => "sem dado para este período"
  semDadoMotivo?: string;
  unidade?: string;
  variacao?: Variacao | null;
  serie?: (number | null)[];
  rodapeExtra?: ReactNode;
  destaque?: boolean;
  /** o que o número mede e como ler; aparece ao passar o mouse ou focar o "i" */
  ajuda?: string;
}

export function KpiCard(p: KpiProps) {
  return (
    <article className="cartao flex min-w-0 flex-col gap-2 p-4" aria-label={p.titulo}>
      <header className="flex items-start justify-between gap-2">
        <h3 className="rotulo inline-flex items-center gap-1">{p.titulo}{p.ajuda && <Dica texto={p.ajuda} rotulo={`Sobre: ${p.titulo}`} />}</h3>
        <span className="num shrink-0 rounded-pilula bg-[var(--superficie-2)] px-2 py-0.5 text-[0.7rem] font-semibold text-suave">{p.periodo}</span>
      </header>
      {p.valor === null ? (
        <div className="flex min-h-[3.2rem] flex-col justify-center">
          <span className="text-base font-semibold text-suave">Sem dado para este período</span>
          {p.semDadoMotivo && <span className="text-xs text-suave">{p.semDadoMotivo}</span>}
        </div>
      ) : (
        <div className="flex min-h-[3.2rem] flex-wrap items-end justify-between gap-2">
          <div className={`num font-bold leading-none ${p.destaque ? "text-[var(--estado-4-texto)]" : ""}`} style={{ fontSize: "2.1rem" }}>
            {p.valor}{p.unidade && <span className="ml-1 text-sm font-medium text-suave">{p.unidade}</span>}
          </div>
          {p.serie && <Sparkline valores={p.serie} rotulo={`${p.titulo}: últimas ${p.serie.length} semanas`} />}
        </div>
      )}
      {p.variacao && <VariacaoTexto v={p.variacao} />}
      {p.rodapeExtra && <div className="text-xs text-suave">{p.rodapeExtra}</div>}
      <footer className="mt-auto border-t border-borda pt-2 text-[0.72rem] text-suave">
        Fonte: {p.fonte.nome} · {p.fonte.atualizado}
      </footer>
    </article>
  );
}

function VariacaoTexto({ v }: { v: Variacao }) {
  const sobe = v.valor > 0, igual = v.valor === 0;
  const seta = igual ? "→" : sobe ? "▲" : "▼";
  const sinal = sobe ? "+" : "";
  const ruim = v.maiorEhPior ? sobe : !sobe;
  const cor = igual ? "var(--texto-suave)" : ruim ? "var(--estado-4-texto)" : "var(--estado-1-texto)";
  return (
    <p className="num text-xs font-semibold" style={{ color: cor }}>
      <span aria-hidden="true">{seta}</span> {sinal}{fmtNum(v.valor, v.unidade === "%" ? 1 : 0)}{v.unidade ?? ""} <span className="font-normal text-suave">vs. {v.contra}</span>
    </p>
  );
}

export function Secao({ titulo, subtitulo, acoes, children, id }: { titulo: string; subtitulo?: ReactNode; acoes?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="cartao min-w-0 p-4 sm:p-5" aria-labelledby={id}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="text-lg font-bold leading-tight">{titulo}</h2>
          {subtitulo && <p className="text-sm text-suave">{subtitulo}</p>}
        </div>
        {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
      </header>
      {children}
    </section>
  );
}

export function Alternador<T extends string>({ opcoes, valor, aoMudar, rotulo }:
  { opcoes: { v: T; r: string }[]; valor: T; aoMudar: (v: T) => void; rotulo: string }) {
  // radiogroup com foco itinerante: Tab entra no grupo, setas trocam a opção (padrão ARIA)
  function teclas(e: React.KeyboardEvent<HTMLButtonElement>, i: number) {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    const j = e.key === "Home" ? 0 : e.key === "End" ? opcoes.length - 1 : d ? (i + d + opcoes.length) % opcoes.length : -1;
    if (j < 0) return;
    e.preventDefault();
    aoMudar(opcoes[j].v);
    (e.currentTarget.parentElement?.querySelectorAll("button")[j] as HTMLButtonElement | undefined)?.focus();
  }
  return (
    <div role="radiogroup" aria-label={rotulo} className="inline-flex flex-wrap gap-2">
      {opcoes.map((o, i) => (
        <button key={o.v} type="button" role="radio" aria-checked={valor === o.v} tabIndex={valor === o.v ? 0 : -1}
          onClick={() => aoMudar(o.v)} onKeyDown={(e) => teclas(e, i)}
          className={`br-button small ${valor === o.v ? "primary" : "secondary"}`}>
          {o.r}
        </button>
      ))}
    </div>
  );
}

/* Nota = br-message do gov.br DS (info ou warning), com ícone em SVG próprio
   no lugar do Font Awesome, para não carregar uma fonte de ícones inteira. */
export function Nota({ children, tipo = "info" }: { children: ReactNode; tipo?: "info" | "aviso" }) {
  const aviso = tipo === "aviso";
  return (
    <div className={`br-message ${aviso ? "warning" : "info"} nota`}>
      <div className="icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24">
          {aviso
            ? <><path d="M12 2.5 22.5 21h-21Z" fill="currentColor" /><path d="M12 9v5.5M12 17.2v.3" stroke="var(--warning-alternative)" strokeWidth="2.4" strokeLinecap="round" /></>
            : <><circle cx="12" cy="12" r="10" fill="currentColor" /><path d="M12 11v6M12 7.2v.3" stroke="var(--info-alternative)" strokeWidth="2.4" strokeLinecap="round" /></>}
        </svg>
      </div>
      <div className="content" role={aviso ? "alert" : undefined}>
        <span className="message-title">{aviso ? "Atenção. " : "Informação. "}</span>
        <span className="message-body">{children}</span>
      </div>
    </div>
  );
}

/* ---------- Dica: informação ao passar o mouse, focar pelo teclado ou tocar ---------- */
export function Dica({ texto, rotulo = "Mais informações" }: { texto: ReactNode; rotulo?: string }) {
  const [aberta, setAberta] = useState(false);
  const id = useId();
  const caixa = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!aberta) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberta(false); };
    const fora = (e: PointerEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberta(false); };
    addEventListener("keydown", esc); addEventListener("pointerdown", fora);
    return () => { removeEventListener("keydown", esc); removeEventListener("pointerdown", fora); };
  }, [aberta]);
  return (
    <span ref={caixa} className="dica relative inline-flex normal-case"
      onMouseEnter={() => setAberta(true)} onMouseLeave={() => setAberta(false)}>
      <button type="button" className="dica-botao" aria-label={rotulo} aria-describedby={aberta ? id : undefined}
        aria-expanded={aberta} onClick={() => setAberta((x) => !x)} onFocus={() => setAberta(true)} onBlur={() => setAberta(false)}>
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 11v6M12 7.2v.3" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
      </button>
      {aberta && <span role="tooltip" id={id} className="dica-caixa">{texto}</span>}
    </span>
  );
}

/* ---------- Barra de meta (ex.: SLA 95%) ---------- */
export function BarraMeta({ valor, meta, rotulo }: { valor: number | null; meta: number; rotulo: string }) {
  const atende = valor !== null && valor >= meta;
  const txt = valor === null ? "sem medição" : `${fmtNum(valor, 1)}% (meta ${meta}%)`;
  return (
    <div className="flex min-w-0 items-center gap-2" title={`${rotulo}: ${txt}`}>
      <div className="relative h-3 min-w-[6rem] flex-1 overflow-hidden rounded-pilula bg-[var(--superficie-2)]" role="meter"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={valor ?? undefined} aria-valuetext={txt} aria-label={rotulo}>
        {valor !== null && <div className="h-full rounded-pilula" style={{ width: `${Math.min(100, valor)}%`, background: atende ? "var(--estado-1)" : "var(--estado-4)" }} />}
        <div className="absolute inset-y-0 w-0.5 bg-[var(--texto)]" style={{ left: `${meta}%` }} aria-hidden="true" />
      </div>
      <span className="num w-[7.5rem] shrink-0 text-right text-xs font-semibold" style={{ color: valor === null ? "var(--texto-suave)" : atende ? "var(--estado-1-texto)" : "var(--estado-4-texto)" }}>
        {valor === null ? "sem medição" : `${atende ? "✓" : "✗"} ${fmtNum(valor, 1)}%`}
      </span>
    </div>
  );
}
