import { useEffect, useMemo, useState } from "react";
import { useDados } from "./dados/useDados";
import type { Doenca, Serie } from "./dados/tipos";
import { DOENCAS } from "./dados/tipos";
import { Alternador, Marca, Nota } from "./componentes/basicos";
import { DOENCA_ROTULO, fmtDataHora, haQuanto, registrarUso } from "./util";
import { VisaoGeral } from "./telas/VisaoGeral";
import { TelaMapa } from "./telas/TelaMapa";
import { TelaSerie } from "./telas/TelaSerie";
import { TelaAlertas } from "./telas/TelaAlertas";
import { TelaQualidade } from "./telas/TelaQualidade";
import { TelaPerfil } from "./telas/TelaPerfil";
import { TelaSobre } from "./telas/TelaSobre";
import { TelaRelatorios } from "./telas/TelaRelatorios";
import type { Ctx } from "./telas/ctx";

const ABAS = [
  { id: "visao", r: "Visão geral" },
  { id: "serie", r: "Série temporal" },
  { id: "mapa", r: "Mapa" },
  { id: "alertas", r: "Alertas" },
  { id: "qualidade", r: "Qualidade do dado" },
  { id: "perfil", r: "Perfil do município" },
  { id: "relatorios", r: "Relatórios" },
  { id: "sobre", r: "Fontes e método" },
] as const;
type Aba = (typeof ABAS)[number]["id"];

function abaDoHash(): Aba {
  const h = location.hash.replace("#", "");
  return (ABAS.find((a) => a.id === h)?.id ?? "visao") as Aba;
}

export default function App() {
  const dados = useDados();
  const [aba, setAba] = useState<Aba>(abaDoHash);
  const [doenca, setDoenca] = useState<Doenca>("dengue");
  const [g, setG] = useState<number | null>(null);
  const [serieMun, setSerieMun] = useState<Serie | null>(null);

  const municipios = useMemo(
    () => (dados.malha?.features ?? []).map((f) => f.properties).sort((a, b) => a.n.localeCompare(b.n, "pt-BR")),
    [dados.malha],
  );

  // Natal como padrão, achado pelo nome (não por código fixo no código-fonte).
  useEffect(() => {
    if (g === null && municipios.length) {
      const natal = municipios.find((m) => m.n.toLocaleLowerCase("pt-BR") === "natal");
      if (natal) setG(natal.g);
    }
  }, [municipios, g]);

  useEffect(() => {
    let vivo = true;
    setSerieMun(null);
    if (g !== null) dados.serieMunicipio(g, doenca).then((s) => vivo && setSerieMun(s));
    return () => { vivo = false; };
  }, [g, doenca, dados.serieMunicipio, dados.origem]);

  useEffect(() => {
    const f = () => setAba(abaDoHash());
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  useEffect(() => { registrarUso(`aba:${aba}`); }, [aba]);

  const irPara = (a: Aba) => { setAba(a); try { history.replaceState(null, "", `#${a}`); } catch { /* sandbox */ } };

  const nomeSel = g === null ? "Rio Grande do Norte" : municipios.find((m) => m.g === g)?.n ?? "—";
  const ctx: Ctx = { dados, doenca, g, nomeSel, serieMun, setG: (x) => { setG(x); registrarUso("selecao_municipio"); }, irPara };

  return (
    <div className="min-h-screen">
      <header className="bg-superficie text-texto" style={{ boxShadow: "var(--sombra)" }}>
        <div className="gutter mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-3">
            <Marca className="h-9 w-auto" />
            <div className="leading-tight">
              <h1 className="text-xl font-bold tracking-tight text-imd dark:text-texto">VigiGen</h1>
              <p className="text-[0.8rem] text-suave">Vigilância genômica de arboviroses · Rio Grande do Norte</p>
            </div>
          </div>
          <Origem {...dados} />
        </div>
        <nav className="gutter mx-auto max-w-7xl overflow-x-auto border-t border-borda" aria-label="Seções do painel">
          <ul className="flex gap-1 whitespace-nowrap">
            {ABAS.map((a) => (
              <li key={a.id}>
                <a href={`#${a.id}`} onClick={(e) => { e.preventDefault(); irPara(a.id); }}
                  aria-current={aba === a.id ? "page" : undefined}
                  className={`inline-block border-b-4 px-3 py-2.5 text-sm font-semibold ${aba === a.id ? "border-imd text-imd dark:border-destaque dark:text-texto" : "border-transparent text-suave hover:bg-[var(--superficie-2)] hover:text-texto"}`}>
                  {a.r}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <div className="gutter mx-auto max-w-7xl py-4">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="br-rotulo">Território</span>
            <select value={g ?? ""} onChange={(e) => ctx.setG(e.target.value ? Number(e.target.value) : null)}
              className="br-campo max-w-full">
              <option value="">Rio Grande do Norte (estado)</option>
              {municipios.map((m) => <option key={m.g} value={m.g}>{m.n}</option>)}
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <span className="br-rotulo">Agravo</span>
            <Alternador rotulo="Agravo" valor={doenca} aoMudar={(d) => { setDoenca(d); registrarUso(`doenca:${d}`); }}
              opcoes={DOENCAS.map((d) => ({ v: d, r: DOENCA_ROTULO[d] }))} />
          </div>
        </div>

        {dados.aviso && <div className="mb-4"><Nota tipo="aviso">{dados.aviso}</Nota></div>}
        {!dados.resumo && !dados.carregando && (
          <Nota tipo="aviso">Sem dado para exibir: o painel não conseguiu ler o banco e este build não traz retrato embutido.</Nota>
        )}
        {!dados.resumo && dados.carregando && <p className="text-suave">Lendo o banco do VigiGen…</p>}

        {dados.resumo && (
          <main>
            {aba === "visao" && <VisaoGeral {...ctx} />}
            {aba === "serie" && <TelaSerie {...ctx} />}
            {aba === "mapa" && <TelaMapa {...ctx} />}
            {aba === "alertas" && <TelaAlertas {...ctx} />}
            {aba === "qualidade" && <TelaQualidade {...ctx} />}
            {aba === "perfil" && <TelaPerfil {...ctx} />}
            {aba === "relatorios" && <TelaRelatorios {...ctx} />}
            {aba === "sobre" && <TelaSobre {...ctx} />}
          </main>
        )}

      </div>
      <footer className="br-rodape mt-8">
        <div className="gutter mx-auto flex max-w-7xl flex-col gap-3 py-6 text-sm sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <Marca variante="escuro" className="h-8 w-auto" />
            <span className="font-bold">VigiGen</span>
          </div>
          <p className="max-w-3xl opacity-90">
            Dados atualizados automaticamente, com a origem e a data de cada número visíveis. InfoDengue é semanal;
            sequências públicas chegam por lote, com defasagem de semanas a meses. Nenhum alerta se confirma sozinho:
            todo alerta passa por revisão humana. Projeto de doutorado em Bioinformática, UFERSA.
          </p>
        </div>
      </footer>
    </div>
  );
}

function Origem({ origem, lidoEm, carregando }: ReturnType<typeof useDados>) {
  const texto =
    origem === "conector" ? "Lido do banco agora, pelo seu conector Supabase"
      : origem === "supabase" ? "Lido do banco agora"
        : origem === "retrato" ? "Retrato embutido do banco"
          : "Sem leitura";
  return (
    <div className="rounded-pilula bg-[var(--superficie-2)] px-3 py-1 text-xs" role="status">
      <span className="font-semibold">{carregando && origem === "retrato" ? "Tentando dado ao vivo… " : ""}{texto}</span>
      {lidoEm && <span className="text-suave"> · {fmtDataHora(lidoEm)} ({haQuanto(lidoEm)})</span>}
    </div>
  );
}
