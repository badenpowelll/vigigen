import { useMemo } from "react";
import type { Ctx } from "./ctx";
import type { MunicipioSemana } from "../dados/tipos";
import { Nota, Secao } from "../componentes/basicos";
import { Radar } from "../componentes/Graficos";
import { DOENCA_ROTULO, fmtNum, fmtSE, lerUso, mediana, percentil } from "../util";

const EIXOS: { k: keyof MunicipioSemana; nome: string; casas: number }[] = [
  { k: "i", nome: "Incidência", casas: 1 },
  { k: "c", nome: "Casos", casas: 0 },
  { k: "ce", nome: "Casos estimados", casas: 0 },
  { k: "rt", nome: "Rt", casas: 2 },
  { k: "prt", nome: "P(Rt>1)", casas: 2 },
  { k: "nv", nome: "Nível", casas: 0 },
];

export function TelaPerfil({ dados, doenca, g, nomeSel }: Ctx) {
  const sem = dados.semana[doenca];
  const m = g !== null ? sem?.municipios.find((x) => x.g === g) : undefined;

  const linhas = useMemo(() => {
    if (!sem || !m) return [];
    return EIXOS.map((e) => {
      const todos = sem.municipios.map((x) => x[e.k]).filter((v): v is number => typeof v === "number");
      const v = typeof m[e.k] === "number" ? (m[e.k] as number) : null;
      const med = mediana(todos);
      return { ...e, v, med, p: v === null ? null : percentil(todos, v), dif: v !== null && med ? (v - med) / med : null };
    });
  }, [sem, m]);

  if (g === null) return <Secao titulo="Perfil do município"><Nota>Escolha um município no seletor "Território" para comparar com a mediana do estado.</Nota></Secao>;
  if (!m) return <Secao titulo={`Perfil · ${nomeSel}`}><Nota>Sem dado para este período: o InfoDengue não publicou {nomeSel} em {fmtSE(sem?.se)}.</Nota></Secao>;

  const maxDif = Math.max(1, ...linhas.map((l) => Math.abs(l.dif ?? 0)));
  const uso = lerUso();

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Secao titulo={`Perfil de ${nomeSel}`} subtitulo={`${DOENCA_ROTULO[doenca]} · ${fmtSE(sem?.se)} · percentil entre os ${sem?.municipios.length} municípios do RN`}>
          <Radar eixos={linhas.map((l) => ({ nome: l.nome, p: l.p }))} titulo={`Radar de percentis de ${nomeSel}`} />
          <p className="text-center text-xs text-suave">O anel tracejado é o percentil 50, a mediana do estado.</p>
        </Secao>
        <Secao titulo="Diferença para a mediana do estado" subtitulo="(valor do município − mediana) ÷ mediana">
          <ul className="flex flex-col gap-2">
            {linhas.map((l) => (
              <li key={l.nome} className="grid grid-cols-[7.5rem_minmax(0,1fr)_5.5rem] items-center gap-2 text-sm">
                <span>{l.nome}</span>
                <span className="relative h-4 rounded bg-[var(--superficie-2)]" aria-hidden="true">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--texto-suave)]" />
                  {l.dif !== null && (
                    <span className="absolute inset-y-0.5 rounded-sm" style={{
                      background: l.dif >= 0 ? "var(--estado-3)" : "var(--mag-3)",
                      left: l.dif >= 0 ? "50%" : `${50 - (Math.abs(l.dif) / maxDif) * 50}%`,
                      width: `${(Math.abs(l.dif) / maxDif) * 50}%`,
                    }} />
                  )}
                </span>
                <span className="num text-right">
                  {l.dif === null ? <span className="text-suave">sem dado</span> : <>{l.dif >= 0 ? "▲ +" : "▼ "}{fmtNum(l.dif * 100, 0)}%</>}
                </span>
                <span className="col-span-3 -mt-1 text-xs text-suave">
                  valor {l.v === null ? "sem dado" : fmtNum(l.v, l.casas)} · mediana RN {fmtNum(l.med, l.casas)}
                </span>
              </li>
            ))}
          </ul>
        </Secao>
      </div>
      <Secao titulo="Uso deste painel neste navegador" subtitulo="Contagem local, guardada só no seu navegador, para a avaliação de usabilidade da tese. Nada é enviado.">
        {Object.keys(uso).length
          ? <ul className="num grid grid-cols-2 gap-x-4 text-sm sm:grid-cols-3">{Object.entries(uso).sort((a, b) => b[1] - a[1]).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
          : <Nota>Nenhum uso registrado ainda neste navegador.</Nota>}
      </Secao>
    </div>
  );
}
