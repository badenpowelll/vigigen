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
import type { Ctx } from "./telas/ctx";
import { TelaAdmin } from "./admin/TelaAdmin";
import { sair, trocarSenha, type Perfil } from "./dados/auth";
import { ligarTelemetria, registrar } from "./dados/telemetria";

const ABAS = [
  { id: "visao", r: "Visão geral" },
  { id: "serie", r: "Série temporal" },
  { id: "mapa", r: "Mapa" },
  { id: "alertas", r: "Alertas" },
  { id: "qualidade", r: "Qualidade do dado" },
  { id: "perfil", r: "Perfil do município" },
  { id: "sobre", r: "Fontes e método" },
  { id: "admin", r: "Administração" },
] as const;
type Aba = (typeof ABAS)[number]["id"];

function abaDoHash(admin: boolean): Aba {
  const h = location.hash.replace("#", "");
  const a = (ABAS.find((x) => x.id === h)?.id ?? "visao") as Aba;
  return a === "admin" && !admin ? "visao" : a;
}

/** perfil: presente no painel web com login; null no artefato do claude.ai. */
export default function App({ perfil = null }: { perfil?: Perfil | null }) {
  const dados = useDados();
  const admin = !!perfil?.administrador;
  const abas = ABAS.filter((a) => a.id !== "admin" || admin);
  const [aba, setAba] = useState<Aba>(() => abaDoHash(admin));
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
    const f = () => setAba(abaDoHash(admin));
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, [admin]);
  useEffect(() => { registrarUso(`aba:${aba}`); registrar("navegacao", `aba: ${ABAS.find((a) => a.id === aba)?.r}`); }, [aba]);
  useEffect(ligarTelemetria, []);

  const irPara = (a: Aba) => { setAba(a); try { history.replaceState(null, "", `#${a}`); } catch { /* sandbox */ } };

  const nomeSel = g === null ? "Rio Grande do Norte" : municipios.find((m) => m.g === g)?.n ?? "—";
  const ctx: Ctx = { dados, doenca, g, nomeSel, serieMun, setG: (x) => { setG(x); registrarUso("selecao_municipio"); }, irPara };

  return (
    <div className="min-h-screen">
      <header className="bg-imd text-white">
        <div className="gutter mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-3">
            <Marca variante="escuro" className="h-9 w-auto" />
            <div className="leading-tight">
              <h1 className="text-xl font-bold tracking-tight">VigiGen</h1>
              <p className="text-[0.8rem] text-white/80">Vigilância genômica de arboviroses · Rio Grande do Norte</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Origem {...dados} />
            {perfil && <Conta perfil={perfil} />}
          </div>
        </div>
        <nav className="gutter mx-auto max-w-7xl overflow-x-auto" aria-label="Seções do painel">
          <ul className="flex gap-1 whitespace-nowrap">
            {abas.map((a) => (
              <li key={a.id}>
                <a href={`#${a.id}`} onClick={(e) => { e.preventDefault(); irPara(a.id); }}
                  aria-current={aba === a.id ? "page" : undefined}
                  className={`inline-block rounded-t-xl px-3 py-2 text-sm font-semibold ${aba === a.id ? "bg-fundo text-imd dark:text-texto" : "text-white/85 hover:bg-white/10"}`}>
                  {a.r}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <div className="gutter mx-auto max-w-7xl py-4">
        <div className={`mb-4 flex flex-wrap items-end gap-3 ${aba === "admin" ? "hidden" : ""}`}>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="rotulo">Território</span>
            <select value={g ?? ""} onChange={(e) => ctx.setG(e.target.value ? Number(e.target.value) : null)}
              className="max-w-full rounded-pilula border border-borda bg-superficie px-4 py-1.5 text-sm font-semibold">
              <option value="">Rio Grande do Norte (estado)</option>
              {municipios.map((m) => <option key={m.g} value={m.g}>{m.n}</option>)}
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <span className="rotulo">Agravo</span>
            <Alternador rotulo="Agravo" valor={doenca} aoMudar={(d) => { setDoenca(d); registrarUso(`doenca:${d}`); }}
              opcoes={DOENCAS.map((d) => ({ v: d, r: DOENCA_ROTULO[d] }))} />
          </div>
        </div>

        {dados.aviso && aba !== "admin" && <div className="mb-4"><Nota tipo="aviso">{dados.aviso}</Nota></div>}
        {!dados.resumo && !dados.carregando && aba !== "admin" && (
          <Nota tipo="aviso">Sem dado para exibir: o painel não conseguiu ler o banco e este build não traz retrato embutido.</Nota>
        )}
        {!dados.resumo && dados.carregando && aba !== "admin" && <p className="text-suave">Lendo o banco do VigiGen…</p>}

        {aba === "admin" && admin && perfil && <main><TelaAdmin meuId={perfil.user_id} /></main>}

        {dados.resumo && aba !== "admin" && (
          <main>
            {aba === "visao" && <VisaoGeral {...ctx} />}
            {aba === "serie" && <TelaSerie {...ctx} />}
            {aba === "mapa" && <TelaMapa {...ctx} />}
            {aba === "alertas" && <TelaAlertas {...ctx} />}
            {aba === "qualidade" && <TelaQualidade {...ctx} />}
            {aba === "perfil" && <TelaPerfil {...ctx} />}
            {aba === "sobre" && <TelaSobre {...ctx} />}
          </main>
        )}

        <footer className="mt-8 border-t border-borda pt-4 text-xs text-suave">
          Dados atualizados automaticamente, com a origem e a data de cada número visíveis. InfoDengue é semanal;
          sequências públicas chegam por lote, com defasagem de semanas a meses. Nenhum alerta se confirma sozinho:
          todo alerta passa por revisão humana. Projeto de doutorado em Bioinformática, UFERSA.
        </footer>
      </div>
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
    <div className="rounded-pilula bg-white/10 px-3 py-1 text-xs" role="status">
      <span className="font-semibold">{carregando && origem === "retrato" ? "Tentando dado ao vivo… " : ""}{texto}</span>
      {lidoEm && <span className="text-white/80"> · {fmtDataHora(lidoEm)} ({haQuanto(lidoEm)})</span>}
    </div>
  );
}

function Conta({ perfil }: { perfil: Perfil }) {
  const [nova, setNova] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-pilula bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20">
        {perfil.nome || perfil.email}{perfil.administrador ? " · administrador" : ""} ▾
      </summary>
      <div className="cartao absolute right-0 z-20 mt-2 w-72 p-3 text-sm text-texto">
        <p className="break-all font-semibold">{perfil.email}</p>
        <p className="mb-2 text-xs text-suave">
          {perfil.vinculos.length ? perfil.vinculos.map((v) => `${v.papel} · ${v.organizacao}`).join("; ") : perfil.administrador ? "Administrador do sistema" : "Sem vínculo com organização"}
        </p>
        <form className="flex flex-col gap-2 border-t border-borda pt-2" onSubmit={async (e) => {
          e.preventDefault();
          const erro = await trocarSenha(nova);
          setMsg(erro ?? "Senha trocada.");
          if (!erro) setNova("");
        }}>
          <label className="flex flex-col gap-1"><span className="rotulo">Nova senha (mínimo 10)</span>
            <input type="password" minLength={10} required autoComplete="new-password" className="entrada" value={nova} onChange={(e) => setNova(e.target.value)} /></label>
          <button className="botao" type="submit">Trocar minha senha</button>
          {msg && <p className="text-xs" role="status">{msg}</p>}
        </form>
        <button className="botao-primario mt-3 w-full text-sm" onClick={() => void sair()}>Sair</button>
      </div>
    </details>
  );
}
