import { useMemo, useState } from "react";
import type { Ctx } from "./ctx";
import { Alternador, Nota, Secao } from "../componentes/basicos";
import { Mapa, TabelaMapa, limitesQuantis, type ValorMapa } from "../componentes/Mapa";
import { DOENCAS, type Doenca } from "../dados/tipos";
import { Vetor } from "../componentes/Vetor";
import { DOENCA_ROTULO, fmtData, fmtNum, fmtSE, fmtTrimestre } from "../util";
import { genomicaDe, motivoSemGenomica } from "../dados/calc";

type Camada = "incidencia" | "casos" | "cobertura";

export function TelaMapa({ dados, doenca, g, setG, setDoenca }: Ctx) {
  const [camada, setCamada] = useState<Camada>("incidencia");
  const [tres, setTres] = useState(false);
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
      return { valores: mp, unidade: "sequências públicas por 100 casos", formatar: (v: number) => fmtNum(v, 2), periodo: cobMun[0] ? fmtTrimestre(cobMun[0].p) : "—" };
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
        ? `Razão de sequências públicas identificáveis por casos notificados (${agr}) · ${periodo} · consulta ao GenBank em ${fmtData(consultaGb)}`
        : `${DOENCA_ROTULO[doenca]} · ${periodo}`}
      acoes={<>
        {setDoenca && <Alternador rotulo="Vírus no mapa" valor={doenca} aoMudar={(d) => { setTres(false); setDoenca(d as Doenca); }}
          opcoes={DOENCAS.map((d) => ({ v: d, r: DOENCA_ROTULO[d] }))} />}
        <Alternador rotulo="Camada do mapa" valor={camada} aoMudar={setCamada}
          opcoes={[{ v: "incidencia", r: "Incidência" }, { v: "casos", r: "Casos" }, { v: "cobertura", r: "Sequências / casos" }]} />
        {camada !== "cobertura" && (
          <button type="button" className="br-button secondary small" aria-pressed={tres} onClick={() => setTres((x) => !x)}>
            {tres ? "Ver um vírus" : "Comparar os três vírus"}
          </button>
        )}
        <button type="button" className="br-button secondary small" aria-pressed={verTabela} onClick={() => setVerTabela((x) => !x)}>
          {verTabela ? "Ver mapa" : "Ver como tabela"}
        </button>
      </>}>
      {camada === "cobertura" && gen.estado !== "ok" && (
        <div className="mb-3"><Nota tipo="aviso">{motivoSemGenomica(doenca, gen.estado)}</Nota></div>
      )}
      {camada === "cobertura" && gen.estado === "ok" && estados && (
        cobMun.length === 0 ? (
          <div className="mb-3"><Nota tipo="aviso">
            <strong>Indicador não calculado.</strong> Não há registro do indicador por município para {agr} neste banco. Isto é dado não
            carregado ou não calculado, não ausência de sequência nem zero.
          </Nota></div>
        ) : estados.calculavel === 0 && estados.zero > 0 ? (
          <div className="mb-3"><Nota tipo="aviso">
            <strong>Zero observado.</strong> Em {fmtNum(estados.zero)} município(s) houve casos de {agr} no trimestre e nenhuma sequência pública
            com município identificável. Isto é ausência de registro no GenBank, não prova de que não houve sequenciamento.
          </Nota></div>
        ) : estados.calculavel === 0 ? (
          <div className="mb-3"><Nota tipo="aviso">
            <strong>Sem razão calculável.</strong> Nenhum município tem ao mesmo tempo casos e sequência com município no trimestre; os demais
            ficam sem dado, com o motivo. Nada aqui é zero.
          </Nota></div>
        ) : null
      )}
      {dados.malha ? (verTabela
        ? <TabelaMapa linhas={linhas} unidade={unidade} />
        : tres && camada !== "cobertura"
          ? <TresVirus dados={dados} camada={camada} g={g} setG={setG} />
          : <Mapa malha={dados.malha} valores={valores} limites={limites} formatar={formatar} unidade={unidade}
              paleta={camada === "cobertura" ? undefined : doenca}
              titulo={`Mapa de ${DOENCA_ROTULO[doenca].toLowerCase()}: ${unidade}, ${periodo}`} selecionado={g} aoSelecionar={setG} />)
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
      <div className="mt-4"><Nota>
        <strong>Calor dentro do município (bairros e quarteirões): planejado.</strong> As fontes públicas usadas hoje (InfoDengue, GenBank)
        só chegam ao município. O calor por bairro depende de dados de focos e de notificação georreferenciada da secretaria, que
        entram no doutorado por termo de cooperação. Até lá, o zoom mostra o município inteiro com a sua cor, sem inventar detalhe.
      </Nota></div>
      <Vetor />
      <p className="mt-3 text-xs text-suave">
        Cores: dengue em vermelho, chikungunya em verde-azulado e Zika em roxo; quanto mais escuro (ou mais claro, no tema escuro), maior o valor.
        Malha: IBGE, limites municipais {dados.malha?.ano_referencia ?? ""} (geometria simplificada para exibição).
        Classes por quantis dos valores positivos; a hachura marca município sem dado, que não é o mesmo que zero.
        {camada === "cobertura" && ` Razão = sequências de ${agr} no GenBank com coleta no trimestre e município identificado ÷ casos notificados de ${agr} (InfoDengue) no mesmo trimestre e município, mostrada por 100 casos: 0,01 equivale a 1 sequência a cada 10 mil casos. Mede o que está depositado e identificável na base pública, não o sequenciamento realizado pelos laboratórios, e não é representativa da circulação viral.`}
      </p>
    </Secao>
  );
}

/** Os três vírus lado a lado, cada um com a própria semana e a própria escala de cor. */
function TresVirus({ dados, camada, g, setG }: { dados: Ctx["dados"]; camada: "incidencia" | "casos"; g: number | null; setG: (g: number | null) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {DOENCAS.map((d) => <MapaDoVirus key={d} d={d} dados={dados} camada={camada} g={g} setG={setG} />)}
    </div>
  );
}

function MapaDoVirus({ d, dados, camada, g, setG }: { d: Doenca; dados: Ctx["dados"]; camada: "incidencia" | "casos"; g: number | null; setG: (g: number | null) => void }) {
  const sem = dados.semana[d];
  const valores = useMemo(() => {
    const mp = new Map<number, ValorMapa>();
    sem?.municipios.forEach((x) => {
      const v = camada === "incidencia" ? x.i : x.c;
      mp.set(x.g, v === null ? { v: null, motivo: "sem registro nesta SE" } : { v, detalhe: camada === "incidencia" ? `${fmtNum(x.c)} casos` : `${fmtNum(x.i, 1)} por 100 mil` });
    });
    return mp;
  }, [sem, camada]);
  const limites = useMemo(() => limitesQuantis([...valores.values()].map((v) => v.v ?? NaN)), [valores]);
  const unidade = camada === "incidencia" ? "por 100 mil hab." : "casos";
  if (!dados.malha) return null;
  return (
    <section aria-label={`${DOENCA_ROTULO[d]}, ${fmtSE(sem?.se)}`} className="min-w-0">
      <h3 className="mb-1 text-sm font-bold">{DOENCA_ROTULO[d]} <span className="font-normal text-suave">· {sem ? fmtSE(sem.se) : "sem dado carregado"}</span></h3>
      {sem ? (
        <Mapa malha={dados.malha} valores={valores} limites={limites} unidade={unidade} paleta={d} compacto
          formatar={(v) => fmtNum(v, camada === "incidencia" && v < 10 ? 1 : 0)}
          titulo={`Mapa de ${DOENCA_ROTULO[d].toLowerCase()}: ${unidade}, ${fmtSE(sem.se)}`} selecionado={g} aoSelecionar={setG} />
      ) : <Nota tipo="aviso">Sem semana de {DOENCA_ROTULO[d].toLowerCase()} neste banco.</Nota>}
    </section>
  );
}
