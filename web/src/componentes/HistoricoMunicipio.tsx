import { useEffect, useMemo, useState } from "react";
import type { Ctx } from "../telas/ctx";
import type { Doenca, Serie } from "../dados/tipos";
import { DOENCAS } from "../dados/tipos";
import { Alternador, IconeNivel, Nota, Secao, type Nivel } from "./basicos";
import { DOENCA_ROTULO, fmtNum, fmtSE } from "../util";

const ROTULO_NIVEL: Record<number, string> = { 1: "Baixo", 2: "Atenção", 3: "Alerta", 4: "Emergência" };

/** Data de uma SE do InfoDengue ("AAAA-MM-DD", início da semana), sem deslocar pelo fuso. */
export function fmtDia(iso: string, somaDias = 0): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + somaDias);
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
}

export interface LinhaSemana { se: number; dt: string; c: number | null; ce: number | null; i: number | null; rt: number | null; nv: number | null }

export function linhasDaSerie(s: Serie | null | undefined): LinhaSemana[] {
  if (!s) return [];
  return s.se.map((se, k) => ({ se, dt: s.dt[k], c: s.c[k], ce: s.ce[k], i: s.i[k], rt: s.rt[k], nv: s.nv[k] }));
}

/** Resumo do histórico: semanas com caso, pico e última semana com caso. */
export function resumoHistorico(ls: LinhaSemana[]) {
  const com = ls.filter((l) => (l.c ?? 0) > 0);
  const pico = com.reduce<LinhaSemana | null>((a, l) => (!a || (l.c ?? 0) > (a.c ?? 0) ? l : a), null);
  const total = com.reduce((t, l) => t + (l.c ?? 0), 0);
  return { semanas: ls.length, comCaso: com.length, total, pico, ultima: com.length ? com[com.length - 1] : null };
}

/** Faixa de semanas coloridas pelo nível do InfoDengue (cinza = sem registro). */
function FaixaNiveis({ ls, rotulo }: { ls: LinhaSemana[]; rotulo: string }) {
  const W = 1000, H = 18, w = W / Math.max(ls.length, 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-4 w-full rounded-sm" role="img" aria-label={rotulo}>
      {ls.map((l, k) => (
        <rect key={l.se} x={k * w} y={0} width={w + 0.5} height={H}
          fill={l.nv ? `var(--estado-${l.nv})` : "var(--estado-nulo)"} opacity={l.nv ? 1 : 0.35}>
          <title>{`${fmtSE(l.se)} (${fmtDia(l.dt)}): ${l.nv ? ROTULO_NIVEL[l.nv] : "sem registro"}, ${fmtNum(l.c)} caso(s)`}</title>
        </rect>
      ))}
    </svg>
  );
}

const POR_PAGINA = 52;

/** Histórico semanal de um município para os três vírus, com tabela. Só dado publicado pelo InfoDengue. */
export function HistoricoMunicipio({ dados, g, nomeSel, doenca }: Pick<Ctx, "dados" | "g" | "nomeSel" | "doenca">) {
  const [series, setSeries] = useState<Partial<Record<Doenca, Serie | null>>>({});
  const [carregando, setCarregando] = useState(true);
  const [virus, setVirus] = useState<Doenca>(doenca);
  const [soComCaso, setSoComCaso] = useState(true);
  const [todas, setTodas] = useState(false);

  useEffect(() => { setVirus(doenca); }, [doenca]);
  useEffect(() => {
    if (g === null) return;
    let vivo = true;
    setCarregando(true); setSeries({}); setTodas(false);
    Promise.all(DOENCAS.map((d) => dados.serieMunicipio(g, d))).then((r) => {
      if (vivo) { setSeries(Object.fromEntries(DOENCAS.map((d, k) => [d, r[k]]))); setCarregando(false); }
    });
    return () => { vivo = false; };
  }, [g, dados.serieMunicipio, dados.origem]);

  const porVirus = useMemo(() => Object.fromEntries(DOENCAS.map((d) => [d, linhasDaSerie(series[d])])) as Record<Doenca, LinhaSemana[]>, [series]);
  const linhas = useMemo(() => {
    const ls = porVirus[virus].filter((l) => !soComCaso || (l.c ?? 0) > 0).slice().reverse();
    return ls;
  }, [porVirus, virus, soComCaso]);
  const visiveis = todas ? linhas : linhas.slice(0, POR_PAGINA);
  const faltando = DOENCAS.filter((d) => !series[d]);

  if (g === null) return null;
  return (
    <Secao id="historico-municipio" titulo={`Histórico semanal de ${nomeSel}`}
      subtitulo="Dengue, chikungunya e Zika por semana epidemiológica, desde 2020 · InfoDengue (Fiocruz/FGV)">
      <Nota>
        <strong>Por semana, não por dia, hora ou endereço.</strong> As fontes públicas usadas hoje publicam o município por semana
        epidemiológica. Dia e hora do caso, bairro e local provável de infecção estão nos microdados do SINAN, que têm dado pessoal e só
        entram no VigiGen pelo convênio com a secretaria, já agregados e pseudonimizados. Até lá, a menor unidade aqui é a semana no município.
        Clima (temperatura e chuva do INMET) ainda não está no banco, então não aparece nesta linha do tempo.
      </Nota>

      {carregando ? <p className="mt-3 text-suave">Lendo o histórico de {nomeSel}…</p> : (
        <>
          {faltando.length > 0 && (
            <div className="mt-3"><Nota>
              Sem série de {faltando.map((d) => DOENCA_ROTULO[d]).join(" e ")} para {nomeSel} nesta visualização.
              {dados.origem === "retrato" ? " O retrato embutido traz poucas séries por município; com o banco lido ao vivo todas aparecem." : " O banco não devolveu série para este vírus."} Isto não é zero.
            </Nota></div>
          )}

          <div className="mt-4 flex flex-col gap-3">
            {DOENCAS.filter((d) => series[d]).map((d) => {
              const ls = porVirus[d];
              const r = resumoHistorico(ls);
              const corpo = `${r.comCaso} de ${r.semanas} semanas com caso notificado, ${fmtNum(r.total)} casos no total`
                + (r.pico ? `; pico na ${fmtSE(r.pico.se)} (semana de ${fmtDia(r.pico.dt)}), com ${fmtNum(r.pico.c)} casos` : "")
                + (r.ultima ? `; último caso notificado na ${fmtSE(r.ultima.se)}` : "") + ".";
              const texto = `${DOENCA_ROTULO[d]} em ${nomeSel}: ${corpo}`;
              return (
                <div key={d}>
                  <p className="mb-1 text-sm"><strong>{DOENCA_ROTULO[d]}.</strong> <span className="text-suave">{corpo.charAt(0).toUpperCase() + corpo.slice(1)}</span></p>
                  <FaixaNiveis ls={ls} rotulo={`Nível de alerta semana a semana. ${texto}`} />
                  <div className="mt-0.5 flex justify-between text-xs text-suave"><span>{ls[0] ? fmtSE(ls[0].se) : ""}</span><span>{ls.length ? fmtSE(ls[ls.length - 1].se) : ""}</span></div>
                </div>
              );
            })}
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-suave">
              Cor de cada semana = nível do InfoDengue:
              {[1, 2, 3, 4].map((k) => <span key={k} className="inline-flex items-center gap-1"><IconeNivel nivel={k as Nivel} tamanho={12} />{ROTULO_NIVEL[k]}</span>)}
              <span>cinza claro = sem registro</span>
            </p>
          </div>

          {DOENCAS.some((d) => series[d]) && (
            <div className="mt-5">
              <div className="mb-2 flex flex-wrap items-end gap-3">
                <Alternador rotulo="Vírus da tabela" valor={virus} aoMudar={(d) => { setVirus(d as Doenca); setTodas(false); }}
                  opcoes={DOENCAS.filter((d) => series[d]).map((d) => ({ v: d, r: DOENCA_ROTULO[d] }))} />
                <label className="inline-flex min-h-6 items-center gap-2 text-sm">
                  <input type="checkbox" checked={soComCaso} onChange={(e) => { setSoComCaso(e.target.checked); setTodas(false); }} className="accent-[var(--interactive)]" />
                  Só semanas com caso notificado
                </label>
              </div>
              <p className="mb-2 text-xs text-suave" aria-live="polite">
                {linhas.length} semana(s) de {DOENCA_ROTULO[virus].toLowerCase()}{soComCaso ? " com caso" : ""}, da mais recente para a mais antiga.
              </p>
              {linhas.length ? (
                <div className="max-h-[32rem] overflow-auto rounded-[var(--raio)] border border-borda" tabIndex={0} role="region"
                  aria-label={`Tabela do histórico semanal de ${DOENCA_ROTULO[virus]} em ${nomeSel}, com rolagem`}>
                  <table className="tabela-relatorio w-full text-sm">
                    <caption className="sr-only">Histórico semanal de {DOENCA_ROTULO[virus]} em {nomeSel}, InfoDengue</caption>
                    <thead className="sticky top-0 bg-superficie">
                      <tr>
                        <th scope="col" className="text-left">Semana</th><th scope="col" className="text-left">Período</th>
                        <th scope="col" className="text-right">Casos notificados</th><th scope="col" className="text-right">Casos estimados</th>
                        <th scope="col" className="text-right">Incidência</th><th scope="col" className="text-right">Rt</th><th scope="col" className="text-left">Nível</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiveis.map((l) => (
                        <tr key={l.se}>
                          <th scope="row" className="text-left font-normal">{fmtSE(l.se)}</th>
                          <td className="whitespace-nowrap">{fmtDia(l.dt)} a {fmtDia(l.dt, 6)}</td>
                          <td className="num text-right">{l.c === null ? <span className="text-suave">sem registro</span> : fmtNum(l.c)}</td>
                          <td className="num text-right">{l.ce === null ? "—" : fmtNum(l.ce)}</td>
                          <td className="num text-right">{l.i === null ? "—" : fmtNum(l.i, 1)}</td>
                          <td className="num text-right">{l.rt === null ? "—" : fmtNum(l.rt, 2)}</td>
                          <td><span className="inline-flex items-center gap-1.5"><IconeNivel nivel={(l.nv ?? null) as Nivel | null} tamanho={14} />{l.nv ? ROTULO_NIVEL[l.nv] : <span className="text-suave">sem dado</span>}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Nota>Nenhuma semana com caso notificado de {DOENCA_ROTULO[virus].toLowerCase()} em {nomeSel} desde 2020.</Nota>}
              {linhas.length > POR_PAGINA && (
                <button type="button" className="br-button secondary small mt-2" onClick={() => setTodas((x) => !x)}>
                  {todas ? `Mostrar só as ${POR_PAGINA} mais recentes` : `Mostrar todas as ${linhas.length} semanas`}
                </button>
              )}
              <p className="mt-2 text-xs text-suave">
                Fonte: InfoDengue (Fiocruz/FGV). Casos estimados corrigem o atraso de notificação; a incidência desta tabela é a dos casos notificados
                por 100 mil habitantes (na lista de municípios do estado ela vem do InfoDengue, sobre os estimados); Rt é o número de reprodução (acima de 1, a transmissão cresce). As semanas recentes ainda podem ser revisadas pelo InfoDengue.
              </p>
            </div>
          )}
        </>
      )}
    </Secao>
  );
}
