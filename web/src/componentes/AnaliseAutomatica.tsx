import { useMemo } from "react";
import type { Ctx } from "../telas/ctx";
import type { Doenca } from "../dados/tipos";
import { Nota, Secao } from "./basicos";
import { genomicaDe } from "../dados/calc";
import {
  PLANO_MS, condutasSugeridas, faltamSequencias, incidenciaSemNotificacao, maiorIncidencia, nivelAlto,
  subidaSemanal, transmissaoCrescendo, type Resposta,
} from "../dados/analise";
import { DOENCA_ROTULO, fmtSE } from "../util";

/** Bloco de perguntas respondidas por regras fixas sobre os dados já carregados no painel. */
export function AnaliseAutomatica({ dados, doenca, setG, setDoenca, irPara }: Pick<Ctx, "dados" | "doenca" | "setG" | "setDoenca" | "irPara">) {
  const sem = dados.semana[doenca];
  const nomes = useMemo(() => new Map((dados.malha?.features ?? []).map((f) => [f.properties.g, f.properties.n])), [dados.malha]);
  const respostas: Resposta[] = useMemo(() => {
    const gen = genomicaDe(dados.resumo, doenca);
    return [
      maiorIncidencia(dados.semana),
      condutasSugeridas(sem, doenca),
      transmissaoCrescendo(sem, doenca),
      subidaSemanal(sem, doenca),
      nivelAlto(sem, doenca),
      incidenciaSemNotificacao(sem, doenca),
      faltamSequencias(gen.r?.cobertura_municipal_trimestre ?? [], nomes, doenca, gen.estado === "ok"),
    ];
  }, [dados.semana, dados.resumo, sem, doenca, nomes]);

  const abrir = (g: number, d?: Doenca) => { if (d && setDoenca) setDoenca(d); setG(g); irPara("visao"); };

  return (
    <Secao id="analise-automatica" titulo="Análise automática dos dados"
      subtitulo={`Perguntas respondidas a partir dos dados do painel · foco em ${DOENCA_ROTULO[doenca].toLowerCase()} (${fmtSE(sem?.se)}); troque o vírus no seletor do mapa`}>
      <Nota>
        <strong>Como esta análise é gerada.</strong> Não é um modelo de inteligência artificial. O texto sai de regras fixas, descritas em
        "Como foi calculado" em cada resposta, aplicadas aos dados do InfoDengue e do GenBank já carregados no painel. Com os mesmos dados, o
        texto é sempre o mesmo, e qualquer pessoa pode refazer a conta. As condutas são sugestões escritas a partir do{" "}
        <a className="underline" href={PLANO_MS.url} target="_blank" rel="noreferrer">{PLANO_MS.titulo}</a> ({PLANO_MS.autoria}, {PLANO_MS.ano});
        o VigiGen não tem dado sobre o que cada gestão fez de fato.
      </Nota>
      <ol className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
        {respostas.map((r, k) => (
          <li key={r.id} className={`cartao p-4 ${r.id === "condutas" ? "xl:col-span-2" : ""}`}>
            <h3 className="font-bold leading-snug">{k + 1}. {r.pergunta}</h3>
            <p className="mt-1 text-sm">{r.resumo}</p>
            {r.itens.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                {r.itens.map((it) => (
                  <li key={r.id + it.n}>
                    <button type="button" className="inline-flex min-h-6 items-center font-semibold underline underline-offset-2" onClick={() => abrir(it.g, it.d)}
                      title="Abrir na visão geral">{it.n}</button>
                    <span className="text-suave">: {it.texto}</span>
                  </li>
                ))}
              </ul>
            )}
            {r.aviso && <p className="mt-2 border-l-4 border-[var(--warning)] pl-2 text-xs">{r.aviso}</p>}
            <details className="mt-2 text-xs text-suave">
              <summary className="cursor-pointer font-semibold">Como foi calculado</summary>
              <p className="mt-1">{r.regra}</p>
              <p className="mt-1">Fonte: {r.fonte}.</p>
            </details>
          </li>
        ))}
      </ol>
    </Secao>
  );
}
