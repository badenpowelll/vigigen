import { useMemo, useState } from "react";
import type { Ctx } from "./ctx";
import { Alternador, Nota, Secao } from "../componentes/basicos";
import { Mapa, TabelaMapa, limitesQuantis, type ValorMapa } from "../componentes/Mapa";
import { DOENCA_ROTULO, fmtData, fmtNum, fmtPct, fmtSE, fmtTrimestre } from "../util";
import { estadoCobertura, genomicaDe, motivoSemGenomica } from "../dados/calc";

type Camada = "incidencia" | "casos" | "cobertura";

export function TelaMapa({ dados, doenca, g, setG }: Ctx) {
  const [camada, setCamada] = useState<Camada>("incidencia");
  const [verTabela, setVerTabela] = useState(false);
  const sem = dados.semana[doenca];
  const gen = useMemo(() => genomicaDe(dados.resumo, doenca), [dados.resumo, doenca]);
  const agr = DOENCA_ROTULO[doenca].toLowerCase();
  const cobMun = gen.r?.cobertura_municipal_trimestre ?? [];
  const nomes = useMemo(() => new Map((dados.malha?.features ?? []).map((f) => [f.properties.g, f.properties.n])), [dados.malha]);

  const { valores, unidade, formatar, periodo } = useMemo(() => {
    const mp = new Map<number, ValorMapa>();
    if (camada === "cobertura") {
      cobMun.forEach((x) => mp.set(x.g, x.v === null ? { v: null, motivo: x.mot ?? "sem denominador" } : { v: x.v * 100, detalhe: `${x.num} seq. / ${fmtNum(x.den)} casos` }));
      return { valores: mp, unidade: "% · sequências públicas identificáveis ÷ casos notificados", formatar: (v: number) => fmtNum(v, 2), periodo: cobMun[0] ? fmtTrimestre(cobMun[0].p) : "—" };
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

  // Só vale para a camada de cobertura e quando o agravo tem sequências ingeridas;
  // sem isso o aviso de "não ingerido" acima já explica a ausência.
  const estCob = camada === "cobertura" && gen.estado === "ok" ? estadoCobertura([...valores.values()].map((v) => v.v)) : null;

  // Quatro estados da cobertura, contados sobre os municípios da malha (nada é inferido).
  const estados = useMemo(() => {
    if (camada !== "cobertura") return null;
    const c = { calculavel: 0, zero: 0, semCasos: 0, semMunicipio: 0, insuficiente: 0 };
    for (const gg of nomes.keys()) {
      const x = cobMun.find((y) => y.g === gg);
      if (!x) c.insuficiente++;
      else if (x.v === null) (x.mot ?? "").startsWith("sem casos") ? c.semCasos++ : c.semMunicipio++;
      else if (x.v === 0) c.zero++;
      else c.calculavel++;
    }
    return c;
  }, [camada, nomes, cobMun]);
  const gb = gen.estado === "ok" ? gen.r?.genbank : undefined;
  const rnSeq = gen.r?.sequencias_rn ?? [];
  const rnSemMun = rnSeq.filter((x) => !x.por_nome);
  const ultimoAnoColeta = Math.max(...(gen.r?.por_ano_brasil ?? []).map((x) => x.a));
  const consultaGb = gen.consultaEm;

  return (
    <Secao titulo="Mapa de calor do Rio Grande do Norte"
      subtitulo={camada === "cobertura"
        ? `Cobertura genômica observável no GenBank (${agr}) · ${periodo} · consulta ao GenBank em ${fmtData(consultaGb)}`
        : `${DOENCA_ROTULO[doenca]} · ${periodo}`}
      acoes={<>
        <Alternador rotulo="Camada do mapa" valor={camada} aoMudar={setCamada}
          opcoes={[{ v: "incidencia", r: "Incidência" }, { v: "casos", r: "Casos" }, { v: "cobertura", r: "Cobertura genômica" }]} />
        <button type="button" className="br-button secondary small" aria-pressed={verTabela} onClick={() => setVerTabela((x) => !x)}>
          {verTabela ? "Ver mapa" : "Ver como tabela"}
        </button>
      </>}>
      {camada === "cobertura" && gen.estado !== "ok" && (
        <div className="mb-3"><Nota tipo="aviso">{motivoSemGenomica(doenca, gen.estado)}</Nota></div>
      )}
      {estCob === "zero_observado" && (
        <div className="mb-3"><Nota tipo="aviso">
          Nenhum município do RN tem sequência depositada com coleta neste trimestre. A cobertura é 0% onde houve casos e fica
          "sem dado" onde não houve casos ou onde há sequência do RN sem município identificável. Isto reflete o que está
          depositado no GenBank, não a capacidade de sequenciamento do estado.
        </Nota></div>
      )}
      {estCob === "nao_calculado" && (
        <div className="mb-3"><Nota tipo="aviso">
          Sem dado: o indicador de cobertura municipal de {agr} não foi calculado ou não foi carregado nesta leitura.
          Isto não significa que não haja sequência depositada.
        </Nota></div>
      )}
      {estCob === "so_sem_dado" && (
        <div className="mb-3"><Nota tipo="aviso">
          Sem dado em todos os municípios neste trimestre: o indicador foi calculado, mas nenhum município tem valor
          (sem casos notificados ou sequência do RN sem município identificável). Nenhum zero foi observado.
        </Nota></div>
      )}
      {dados.malha ? (verTabela
        ? <TabelaMapa linhas={linhas} unidade={unidade} />
        : <Mapa malha={dados.malha} valores={valores} limites={limites} formatar={formatar} unidade={unidade}
            titulo={`Mapa: ${unidade}, ${periodo}`} selecionado={g} aoSelecionar={setG} />)
        : <Nota>Sem malha municipal carregada.</Nota>}
      {estados && (
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm lg:grid-cols-5">
          {[
            ["Percentual calculável", estados.calculavel, "há sequência com município e casos no trimestre"],
            ["Zero observado", estados.zero, "houve casos e nenhuma sequência com município"],
            ["Sem casos", estados.semCasos, "sem casos notificados no trimestre (sem denominador)"],
            ["Sem município identificável", estados.semMunicipio, "há sequência do RN no trimestre, mas sem município"],
            ["Dados insuficientes", estados.insuficiente, "sem registro do indicador para o município"],
          ].map(([r, n, d]) => (
            <div key={r as string} className="rounded-[var(--raio)] border border-borda p-3">
              <dt className="rotulo">{r}</dt>
              <dd className="num mt-1 text-xl font-bold">{fmtNum(n as number)} <span className="text-xs font-normal text-suave">município(s)</span></dd>
              <dd className="text-xs text-suave">{d}</dd>
            </div>
          ))}
        </dl>
      )}
      {camada === "cobertura" && gb && (
        <div className="mt-4 rounded-[var(--raio)] border border-borda p-3 text-sm">
          <p className="rotulo">Nível estadual · o que a base genômica permite ver</p>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            <li>{fmtNum(gb.rn)} sequência(s) de {agr} do RN em toda a base, e {fmtNum(rnSemMun.filter((x) => x.geo).length)} delas só com o estado no local de origem
              {rnSemMun.length > 0 && <> ({rnSemMun.map((x) => `${x.acc}, coleta ${x.coleta ?? "sem data"}`).join("; ")})</>}.</li>
            <li>Ano de coleta mais recente entre as {fmtNum(gb.total)} sequências brasileiras: {Number.isFinite(ultimoAnoColeta) ? ultimoAnoColeta : "sem dado"}.</li>
            <li>Coletas com só o ano informado não entram no cálculo trimestral; a oportunidade usa só coletas com dia.</li>
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs text-suave">
        Malha: IBGE, limites municipais {dados.malha?.ano_referencia ?? ""} (geometria simplificada para exibição).
        Classes por quantis dos valores positivos; a hachura marca município sem dado, que não é o mesmo que zero.
        {camada === "cobertura" && ` Cobertura observável = sequências de ${agr} no GenBank com coleta no trimestre e município identificado ÷ casos notificados de ${agr} (InfoDengue) no mesmo trimestre e município. Valor em %: ${fmtPct(0.0001, 2)} equivale a 1 sequência a cada 10 mil casos. Mede o que está depositado e identificável na base pública, não o sequenciamento realizado pelos laboratórios, e não é representativa da circulação viral.`}
      </p>
    </Secao>
  );
}
