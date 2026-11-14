import { useMemo, useState } from "react";
import type { MunicipioSemana } from "../dados/tipos";
import { IconeNivel, type Nivel } from "./basicos";
import { fmtNum } from "../util";

type Coluna = "n" | "nv" | "c" | "ce" | "i" | "rt";
const ROTULO_NIVEL: Record<number, string> = { 1: "Baixo", 2: "Atenção", 3: "Alerta", 4: "Emergência" };

/** Ordena municípios por coluna; valores ausentes vão sempre para o fim (sem dado não é zero). */
export function ordenarMunicipios(lista: MunicipioSemana[], col: Coluna, desc: boolean): MunicipioSemana[] {
  return [...lista].sort((a, b) => {
    if (col === "n") return (desc ? -1 : 1) * a.n.localeCompare(b.n, "pt-BR");
    const va = a[col], vb = b[col];
    if (va === null && vb === null) return a.n.localeCompare(b.n, "pt-BR");
    if (va === null) return 1;
    if (vb === null) return -1;
    return (desc ? vb - va : va - vb) || a.n.localeCompare(b.n, "pt-BR");
  });
}

function semAcento(t: string) { return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR"); }

/** Tabela dos municípios do RN na semana, para a visão do estado. Clicar no nome abre o município. */
export function ListaMunicipios({ municipios, periodo, aoSelecionar }: {
  municipios: MunicipioSemana[]; periodo: string; aoSelecionar: (g: number) => void;
}) {
  const [col, setCol] = useState<Coluna>("i");
  const [desc, setDesc] = useState(true);
  const [busca, setBusca] = useState("");
  const linhas = useMemo(() => {
    const q = semAcento(busca.trim());
    const f = q ? municipios.filter((m) => semAcento(m.n).includes(q)) : municipios;
    return ordenarMunicipios(f, col, desc);
  }, [municipios, col, desc, busca]);

  const cab = (c: Coluna, rotulo: string, direita = false) => (
    <th scope="col" className={direita ? "text-right" : "text-left"}
      aria-sort={col === c ? (desc ? "descending" : "ascending") : "none"}>
      <button type="button" className="font-semibold underline-offset-2 hover:underline"
        onClick={() => { if (col === c) setDesc(!desc); else { setCol(c); setDesc(c !== "n"); } }}>
        {rotulo}{col === c ? (desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  return (
    <div>
      <label className="mb-2 flex max-w-xs flex-col gap-1">
        <span className="br-rotulo">Buscar município</span>
        <input type="search" className="br-campo texto" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Digite o nome" />
      </label>
      <p className="mb-2 text-xs text-suave" aria-live="polite">
        {linhas.length} de {municipios.length} municípios · {periodo} · clique no nome para abrir o município
      </p>
      <div className="max-h-[28rem] overflow-auto rounded-[var(--raio)] border border-borda" tabIndex={0}
        role="region" aria-label="Tabela de municípios do Rio Grande do Norte, com rolagem">
        <table className="tabela-relatorio w-full text-sm">
          <caption className="sr-only">Municípios do Rio Grande do Norte na {periodo}: nível de alerta, casos notificados, casos estimados, incidência por 100 mil habitantes calculada sobre os casos estimados, e Rt, do InfoDengue</caption>
          <thead className="sticky top-0 bg-superficie">
            <tr>{cab("n", "Município")}{cab("nv", "Nível")}{cab("c", "Casos notificados", true)}{cab("ce", "Casos estimados", true)}{cab("i", "Incidência", true)}{cab("rt", "Rt", true)}</tr>
          </thead>
          <tbody>
            {linhas.map((m) => (
              <tr key={m.g}>
                <th scope="row" className="text-left font-normal">
                  <button type="button" className="text-left underline underline-offset-2" onClick={() => aoSelecionar(m.g)}>{m.n}</button>
                </th>
                <td>
                  <span className="inline-flex items-center gap-1.5">
                    <IconeNivel nivel={(m.nv ?? null) as Nivel | null} tamanho={14} />
                    {m.nv ? ROTULO_NIVEL[m.nv] : <span className="text-suave">sem dado</span>}
                  </span>
                </td>
                <td className="num text-right">{m.c === null ? <span className="text-suave">sem registro</span> : fmtNum(m.c)}</td>
                <td className="num text-right">{m.ce === null ? <span className="text-suave">—</span> : fmtNum(m.ce)}</td>
                <td className="num text-right">{m.i === null ? <span className="text-suave">—</span> : fmtNum(m.i, 1)}</td>
                <td className="num text-right">{m.rt === null ? <span className="text-suave">—</span> : fmtNum(m.rt, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-suave">Fonte: InfoDengue (Fiocruz/FGV). A incidência é a do InfoDengue, calculada sobre os casos estimados (que corrigem o atraso de notificação) e a população do IBGE; por isso um município pode ter incidência com 0 caso notificado. "Sem registro" e "—" indicam que o InfoDengue não publicou o valor nesta semana; isso não é zero.</p>
    </div>
  );
}
