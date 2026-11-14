// Sininho de notificação: conta só alertas reais gravados no banco que ainda
// esperam revisão humana (novo ou em análise). Sem alerta, sem número.
import { useEffect, useRef, useState } from "react";
import type { Alerta } from "../dados/tipos";
import { DOENCA_ROTULO, fmtDataHora, fmtTrimestre } from "../util";

const PENDENTE = new Set(["novo", "em_analise"]);
const STATUS: Record<string, string> = { novo: "Novo", em_analise: "Em análise" };

export function Sininho({ alertas, nomes, aoAbrir }: {
  alertas: Alerta[] | null; nomes: { g: number; n: string }[]; aoAbrir: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const pendentes = (alertas ?? []).filter((a) => PENDENTE.has(a.status))
    .sort((a, b) => b.criado.localeCompare(a.criado));
  const n = pendentes.length;
  const nome = (g: number | null) => (g === null ? "Rio Grande do Norte" : nomes.find((m) => m.g === g)?.n ?? String(g));

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    addEventListener("mousedown", fora); addEventListener("keydown", esc);
    return () => { removeEventListener("mousedown", fora); removeEventListener("keydown", esc); };
  }, [aberto]);

  const rotulo = alertas === null ? "Notificações: sem leitura do banco"
    : n === 0 ? "Notificações: nenhum alerta aguardando revisão"
      : `Notificações: ${n} alerta${n > 1 ? "s" : ""} aguardando revisão`;

  return (
    <div ref={caixa} className="relative">
      <button type="button" className="br-button circle small relative" aria-label={rotulo} title={rotulo}
        aria-expanded={aberto} aria-haspopup="dialog" onClick={() => setAberto((x) => !x)}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
          <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z" />
        </svg>
        {n > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[1.25rem] rounded-full bg-[var(--danger)] px-1 text-center text-[0.7rem] font-bold leading-5 text-white">
            {n > 99 ? "99+" : n}
          </span>
        )}
      </button>
      {aberto && (
        <div role="dialog" aria-label="Notificações"
          className="absolute right-0 z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-[var(--raio)] border border-borda bg-superficie p-3 text-sm text-texto"
          style={{ boxShadow: "var(--surface-shadow-md)" }}>
          <p className="mb-2 font-bold">Notificações</p>
          {alertas === null ? (
            <p className="text-suave">Sem leitura do banco, então não há como saber se há alertas.</p>
          ) : n === 0 ? (
            <p className="text-suave">Nenhum alerta aguardando revisão. O sininho só acende quando as regras de detecção gravam um alerta real no banco.</p>
          ) : (
            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {pendentes.slice(0, 8).map((a) => (
                <li key={a.id} className="border-b border-borda pb-2 last:border-0">
                  <span className="font-semibold">{nome(a.g)}</span> · {DOENCA_ROTULO[a.a ?? "dengue"]} · {a.tipo} · {fmtTrimestre(a.p)}
                  <span className="block text-xs text-suave">{STATUS[a.status]} · criado em {fmtDataHora(a.criado)}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="br-button secondary small mt-3 w-full" onClick={() => { setAberto(false); aoAbrir(); }}>
            Ver todos os alertas
          </button>
        </div>
      )}
    </div>
  );
}
