// Tema claro/escuro e ajuda de atalhos de teclado.
import { useEffect, useRef, useState } from "react";

type Tema = "sistema" | "claro" | "escuro";
const ROTULO: Record<Tema, string> = { sistema: "Tema do sistema", claro: "Tema claro", escuro: "Tema escuro" };

export function lerTema(): Tema {
  try { const t = localStorage.getItem("vigigen:tema"); if (t === "claro" || t === "escuro") return t; } catch { /* sem armazenamento */ }
  return "sistema";
}

export function aplicarTema(t: Tema) {
  const el = document.documentElement;
  if (t === "sistema") el.removeAttribute("data-theme"); else el.setAttribute("data-theme", t === "escuro" ? "dark" : "light");
}

/** Alterna sistema → claro → escuro; a escolha fica só neste navegador. */
export function SeletorTema() {
  const [tema, setTema] = useState<Tema>(lerTema);
  useEffect(() => {
    aplicarTema(tema);
    try { if (tema === "sistema") localStorage.removeItem("vigigen:tema"); else localStorage.setItem("vigigen:tema", tema); } catch { /* sem armazenamento */ }
  }, [tema]);
  return (
    <div role="radiogroup" aria-label="Tema de cores" className="tema-grupo">
      {(["claro", "escuro", "sistema"] as Tema[]).map((t, i, arr) => (
        <button key={t} type="button" role="radio" aria-checked={tema === t} aria-label={ROTULO[t]} title={ROTULO[t]}
          tabIndex={tema === t ? 0 : -1} className="tema-botao"
          onClick={() => setTema(t)}
          onKeyDown={(e) => {
            const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            const prox = arr[(i + d + arr.length) % arr.length];
            setTema(prox);
            (e.currentTarget.parentElement?.querySelectorAll("button")[(i + d + arr.length) % arr.length] as HTMLButtonElement | undefined)?.focus();
          }}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {t === "claro" && <><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></>}
            {t === "escuro" && <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />}
            {t === "sistema" && <><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16v4" /></>}
          </svg>
        </button>
      ))}
    </div>
  );
}

const ATALHOS: [string, string][] = [
  ["Tab / Shift+Tab", "avança / volta entre os controles"],
  ["Enter ou Espaço", "ativa botão, município do mapa ou opção"],
  ["Setas", "trocam a opção em grupos (agravo, camada, tema) e percorrem as semanas nos gráficos"],
  ["Esc", "fecha janelas, dicas e o painel de notificações"],
  ["Alt+Shift+número", "vai para a aba daquele número (lista abaixo)"],
  ["Alt+Shift+D / C / Z", "agravo Dengue / Chikungunya / Zika"],
  ["Alt+Shift+M", "vai para o seletor de município"],
  ["Alt+Shift+P", "vai para o conteúdo principal"],
];

export function Atalhos({ abas }: { abas: string[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={botao} type="button" className="br-button secondary small" aria-haspopup="dialog"
        onClick={() => ref.current?.showModal?.()}>
        Atalhos de teclado
      </button>
      <dialog ref={ref} aria-labelledby="atalhos-titulo" className="atalhos-dialogo"
        onClose={() => botao.current?.focus()}
        onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
        <h2 id="atalhos-titulo" className="mb-2 text-lg font-bold">Atalhos de teclado</h2>
        <p className="mb-3 text-sm text-suave">Todo o painel funciona só com o teclado. Os atalhos usam Alt+Shift para não disputar teclas com leitores de tela.</p>
        <table className="tabela-relatorio w-full text-sm">
          <thead><tr><th className="text-left" scope="col">Tecla</th><th className="text-left" scope="col">Ação</th></tr></thead>
          <tbody>
            {ATALHOS.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}
          </tbody>
        </table>
        <p className="mt-3 text-sm"><strong>Abas:</strong> {abas.map((a, i) => `${i + 1} ${a}`).join(" · ")}</p>
        <form method="dialog" className="mt-4 text-right"><button className="br-button primary small" autoFocus>Fechar</button></form>
      </dialog>
    </>
  );
}
