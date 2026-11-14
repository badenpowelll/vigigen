import { useMemo, useState } from "react";
import type { Ctx } from "./ctx";
import { Alternador, Nota, Secao } from "../componentes/basicos";
import { Mapa, TabelaMapa, limitesQuantis, type ValorMapa } from "../componentes/Mapa";
import { DOENCA_ROTULO, fmtNum, fmtPct, fmtSE, fmtTrimestre } from "../util";

type Camada = "incidencia" | "casos" | "cobertura";

export function TelaMapa({ dados, doenca, g, setG }: Ctx) {
  const [camada, setCamada] = useState<Camada>("incidencia");
  const [verTabela, setVerTabela] = useState(false);
  const sem = dados.semana[doenca];
  const cobMun = dados.resumo?.cobertura_municipal_trimestre ?? [];
  const nomes = useMemo(() => new Map((dados.malha?.features ?? []).map((f) => [f.properties.g, f.properties.n])), [dados.malha]);

  const { valores, unidade, formatar, periodo } = useMemo(() => {
    const mp = new Map<number, ValorMapa>();
    if (camada === "cobertura") {
      cobMun.forEach((x) => mp.set(x.g, x.v === null ? { v: null, motivo: x.mot ?? "sem denominador" } : { v: x.v * 100, detalhe: `${x.num} seq. / ${fmtNum(x.den)} casos` }));
      return { valores: mp, unidade: "% dos casos sequenciados", formatar: (v: number) => fmtNum(v, 2), periodo: cobMun[0] ? fmtTrimestre(cobMun[0].p) : "—" };
    }
    sem?.municipios.forEach((x) => {
      const v = camada === "incidencia" ? x.i : x.c;
      mp.set(x.g, v === null ? { v: null, motivo: "sem registro nesta SE" } : { v, detalhe: camada === "incidencia" ? `${fmtNum(x.c)} casos` : `${fmtNum(x.i, 1)} por 100 mil` });
    });
    return {
      valores: mp, periodo: fmtSE(sem?.se),
      unidade: camada === "incidencia" ? "casos por 100 mil hab." : "casos notificados",
      formatar: (v: number) => fmtNum(v, camada === "incidencia" && v < 10 ? 1 : 0),
    };
  }, [camada, sem, cobMun]);

  const limites = useMemo(() => limitesQuantis([...valores.values()].map((v) => v.v ?? NaN)), [valores]);
  const linhas = useMemo(() => [...nomes.entries()].map(([gg, n]) => {
    const v = valores.get(gg);
    return { n, v: v?.v ?? null, motivo: v ? v.motivo : "sem registro" };
  }).sort((a, b) => (b.v ?? -1) - (a.v ?? -1)), [nomes, valores]);

  const todosZero = camada === "cobertura" && [...valores.values()].every((v) => v.v === null || v.v === 0);

  return (
    <Secao titulo="Mapa de calor do Rio Grande do Norte" subtitulo={`${camada === "cobertura" ? "Cobertura de sequenciamento" : DOENCA_ROTULO[doenca]} · ${periodo}`}
      acoes={<>
        <Alternador rotulo="Camada do mapa" valor={camada} aoMudar={setCamada}
          opcoes={[{ v: "incidencia", r: "Incidência" }, { v: "casos", r: "Casos" }, { v: "cobertura", r: "Cobertura genômica" }]} />
        <button type="button" className="br-button secondary small" aria-pressed={verTabela} onClick={() => setVerTabela((x) => !x)}>
          {verTabela ? "Ver mapa" : "Ver como tabela"}
        </button>
      </>}>
      {todosZero && (
        <div className="mb-3"><Nota tipo="aviso">
          Nenhum município do RN tem sequência depositada com coleta neste trimestre. A cobertura é 0% onde houve casos e fica
          "sem dado" onde não houve casos ou onde há sequência do RN sem município identificável. Isto reflete o que está
          depositado no GenBank, não a capacidade de sequenciamento do estado.
        </Nota></div>
      )}
      {dados.malha ? (verTabela
        ? <TabelaMapa linhas={linhas} unidade={unidade} />
        : <Mapa malha={dados.malha} valores={valores} limites={limites} formatar={formatar} unidade={unidade}
            titulo={`Mapa: ${unidade}, ${periodo}`} selecionado={g} aoSelecionar={setG} />)
        : <Nota>Sem malha municipal carregada.</Nota>}
      <p className="mt-3 text-xs text-suave">
        Malha: IBGE, limites municipais {dados.malha?.ano_referencia ?? ""} (geometria simplificada para exibição).
        Classes por quantis dos valores positivos; a hachura marca município sem dado, que não é o mesmo que zero.
        {camada === "cobertura" && ` Cobertura = sequências com coleta no trimestre e município identificado ÷ casos notificados de dengue. Valor exibido em %: ${fmtPct(0.0001, 2)} equivale a 1 sequência a cada 10 mil casos.`}
      </p>
    </Secao>
  );
}
