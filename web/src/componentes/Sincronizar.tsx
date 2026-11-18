// Botão "Sincronizar" do cabeçalho: pede ao banco que rode agora as cargas do
// agendamento automático e acompanha cada fonte até o fim. Ao terminar, relê o
// painel do banco. As cargas continuam no servidor mesmo se a página fechar.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Origem } from "../dados/fonte";
import {
  aberta, lerSincronizacao, pedirSincronizacao, ROTULO_ESTADO, rotuloItem,
  type ItemSincronizacao, type Sincronizacao,
} from "../dados/sincronizacao";
import { fmtDataHora, haQuanto } from "../util";
import { registrar } from "../dados/telemetria";

const INTERVALO_MS = 15_000;

export function Sincronizar({ origem, aoConcluir }: { origem: Origem; aoConcluir: () => Promise<boolean> }) {
  const [s, setS] = useState<Sincronizacao | null>(null);
  const [pedindo, setPedindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [relendo, setRelendo] = useState(false);
  const [releitura, setReleitura] = useState<"ok" | "falhou" | null>(null);
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const anterior = useRef<Sincronizacao | null>(null);

  // terminou (de aberta para concluída nesta sessão): relê o painel sem cache
  const aplicar = useCallback((nova: Sincronizacao | null) => {
    const antes = anterior.current;
    anterior.current = nova;
    setS(nova);
    if (antes && aberta(antes) && nova && nova.id === antes.id && !aberta(nova)) {
      setRelendo(true);
      aoConcluir().then((ok) => setReleitura(ok ? "ok" : "falhou")).finally(() => setRelendo(false));
    }
  }, [aoConcluir]);

  // ao abrir o painel, retoma uma sincronização que já esteja em andamento (sem erro na tela se a 022 não existir)
  useEffect(() => {
    let vivo = true;
    lerSincronizacao(origem).then((x) => { if (vivo) aplicar(x); }).catch(() => { /* silencioso na leitura inicial */ });
    return () => { vivo = false; };
  }, [origem, aplicar]);

  // acompanha enquanto houver sincronização aberta
  useEffect(() => {
    if (!aberta(s)) return;
    const t = setInterval(() => {
      lerSincronizacao(origem).then(aplicar).catch((e: Error) => setErro(e.message));
    }, INTERVALO_MS);
    return () => clearInterval(t);
  }, [s, origem, aplicar]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    addEventListener("mousedown", fora); addEventListener("keydown", esc);
    return () => { removeEventListener("mousedown", fora); removeEventListener("keydown", esc); };
  }, [aberto]);

  async function sincronizar() {
    setAberto(true);
    setErro(null);
    setReleitura(null);
    setPedindo(true);
    registrar("acao", "sincronizar: pedir", { origem });
    try {
      const nova = await pedirSincronizacao(origem);
      anterior.current = nova;   // a conclusão só dispara releitura se vier depois deste pedido
      setS(nova);
      if (!aberta(nova) && !nova.aviso) {
        // terminou já no pedido (raro): relê agora
        setRelendo(true);
        setReleitura((await aoConcluir()) ? "ok" : "falhou");
        setRelendo(false);
      }
    } catch (e) {
      setErro((e as Error).message);
      registrar("erro", "sincronizar: pedido recusado", { mensagem: (e as Error).message });
    } finally {
      setPedindo(false);
    }
  }

  const emAndamento = pedindo || aberta(s) || relendo;
  const itens = s?.itens ?? [];
  const prontos = itens.filter((i) => i.estado !== "pendente" && i.estado !== "disparado").length;
  const falhas = itens.filter((i) => i.estado === "erro").length;

  const rotuloBotao = pedindo ? "Pedindo…"
    : aberta(s) ? `Sincronizando ${prontos}/${itens.length}`
      : relendo ? "Relendo o painel…"
        : "Sincronizar";
  const descricao = emAndamento
    ? "Sincronização manual em andamento. Abrir detalhes."
    : "Sincronizar: buscar agora, nas fontes oficiais, as atualizações que o agendamento automático buscaria";

  return (
    <div ref={caixa} className="relative flex items-center gap-1">
      <button type="button" className="br-button secondary small inline-flex items-center gap-2"
        onClick={() => (emAndamento ? setAberto((x) => !x) : void sincronizar())}
        aria-label={descricao} title={descricao} aria-busy={emAndamento}
        data-rastro="cabeçalho: sincronizar">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor"
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={emAndamento ? "girando" : ""}>
          <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" /><path d="M3 21v-5h5" />
          <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" /><path d="M21 3v5h-5" />
        </svg>
        <span>{rotuloBotao}</span>
      </button>
      {!emAndamento && s && (
        <button type="button" className="tema-botao" aria-label="Ver detalhes da última sincronização"
          title="Detalhes da última sincronização" aria-expanded={aberto} onClick={() => setAberto((x) => !x)}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
        </button>
      )}

      {aberto && (
        <div role="dialog" aria-label="Sincronização manual"
          className="absolute left-0 top-full z-20 sm:left-auto sm:right-0 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-[var(--raio)] border border-borda bg-superficie p-3 text-sm text-texto"
          style={{ boxShadow: "var(--surface-shadow-md)" }}>
          <p className="mb-1 font-bold">Sincronização manual</p>
          <p className="mb-2 text-xs text-suave">
            Busca agora as mesmas fontes do agendamento automático, uma carga por fonte de cada vez. Cada resposta
            é gravada crua no banco antes de virar número. As cargas seguem no servidor mesmo se você fechar a página.
          </p>

          {erro && <p className="mb-2 rounded border border-[var(--danger)] px-2 py-1 font-semibold text-[var(--danger)]" role="alert">{erro}</p>}
          {pedindo && !s && <p className="text-suave" role="status">Enviando o pedido ao banco…</p>}

          {s && (
            <>
              {s.aviso && <p className="mb-2 text-xs font-semibold" role="status">{avisoLegivel(s.aviso)}</p>}
              <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto" aria-label="Fontes da sincronização">
                {itens.map((i) => <Linha key={i.tarefa} i={i} />)}
              </ul>
              <div className="mt-2 border-t border-borda pt-2 text-xs text-suave" role="status" aria-live="polite">
                <p>Pedida em {fmtDataHora(s.pedido_em)} ({haQuanto(s.pedido_em)}).</p>
                {aberta(s) && <p>{prontos} de {itens.length} fontes terminadas. Conferindo a cada 15 segundos.</p>}
                {!aberta(s) && (
                  <p>
                    Terminada em {fmtDataHora(s.concluida_em)}
                    {s.indicadores_em ? ", com os indicadores recalculados" : ""}
                    {falhas ? `; ${falhas} fonte${falhas > 1 ? "s" : ""} falhou` : ""}.
                  </p>
                )}
                {s.mensagem && <p>{s.mensagem}</p>}
                {relendo && <p>Relendo o painel do banco…</p>}
                {releitura === "ok" && <p className="font-semibold text-texto">Painel relido do banco com os dados novos.</p>}
                {releitura === "falhou" && <p className="font-semibold text-texto">A sincronização terminou, mas o painel não conseguiu reler o banco. Recarregue a página.</p>}
              </div>
            </>
          )}
          {!emAndamento && (
            <button type="button" className="br-button primary small mt-3 w-full" onClick={() => void sincronizar()}>
              Sincronizar agora
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Linha({ i }: { i: ItemSincronizacao }) {
  const cor = i.estado === "erro" ? "var(--danger)"
    : i.estado === "ok" || i.estado === "vazio" ? "var(--success)"
      : "var(--texto-suave)";
  const detalhe = i.estado === "erro" ? (i.http_status ? `HTTP ${i.http_status}: ` : "") + (i.mensagem ?? "")
    : i.estado === "ok" && i.registros != null ? `${i.registros.toLocaleString("pt-BR")} registros`
      : i.estado === "pendente" && i.mensagem ? i.mensagem
        : i.finalizado_em ? fmtDataHora(i.finalizado_em) : "";
  return (
    <li className="flex items-start justify-between gap-2">
      <span className="min-w-0">
        <span className="font-semibold">{rotuloItem(i)}</span>
        {detalhe && <span className="block break-words text-xs text-suave">{detalhe}</span>}
      </span>
      <span className="shrink-0 text-xs font-semibold" style={{ color: cor }}>{ROTULO_ESTADO[i.estado]}</span>
    </li>
  );
}

function avisoLegivel(a: string): string {
  if (/em andamento/.test(a)) return "Já havia uma sincronização em andamento; acompanhando a mesma.";
  if (/menos de 10 minutos/.test(a)) return "A última sincronização terminou há menos de 10 minutos. Aguarde para pedir outra.";
  return a;
}
