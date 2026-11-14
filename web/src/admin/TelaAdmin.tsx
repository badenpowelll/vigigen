// Menu Administração: auditoria de uso, SLA, alertas do sistema e usuários.
// Só aparece para quem tem perfil.administrador; o banco confere de novo.
import { useMemo, useState } from "react";
import { Alternador, Nota, Secao } from "../componentes/basicos";
import { fmtDataHora, fmtNum, haQuanto } from "../util";
import {
  baixarCsv, navegador, PAPEIS, rpc, TIPOS_EVENTO, useLeitura,
  type AlertaSistema, type Evento, type ResumoUso, type Sla, type Usuario, type Usuarios,
} from "./api";

type Sub = "auditoria" | "sla" | "alertas" | "usuarios";

export function TelaAdmin({ meuId }: { meuId: string }) {
  const [sub, setSub] = useState<Sub>("auditoria");
  return (
    <div className="flex flex-col gap-4">
      <Alternador rotulo="Seção da administração" valor={sub} aoMudar={setSub}
        opcoes={[
          { v: "auditoria", r: "Auditoria" }, { v: "sla", r: "SLA" },
          { v: "alertas", r: "Alertas do sistema" }, { v: "usuarios", r: "Usuários e perfis" },
        ]} />
      {sub === "auditoria" && <Auditoria />}
      {sub === "sla" && <PainelSla />}
      {sub === "alertas" && <AlertasSistema />}
      {sub === "usuarios" && <GestaoUsuarios meuId={meuId} />}
    </div>
  );
}

const Erro = ({ msg }: { msg: string }) => (
  <p role="alert" className="text-sm font-semibold" style={{ color: "var(--estado-4-texto)" }}>{msg}</p>
);
const Lido = ({ em, recarregar }: { em: number | null; recarregar: () => void }) => (
  <button className="botao" onClick={recarregar} data-rastro="admin: atualizar">
    Atualizar{em ? ` · lido ${fmtDataHora(em)}` : ""}
  </button>
);

/* ---------------- Auditoria ---------------- */
function Auditoria() {
  const [dias, setDias] = useState<"1" | "7" | "30">("7");
  const [tipo, setTipo] = useState("");
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const desde = useMemo(() => new Date(Date.now() - Number(dias) * 86400000).toISOString(), [dias]);
  const resumo = useLeitura<ResumoUso>("admin_resumo_uso", { p_dias: Number(dias) });
  const eventos = useLeitura<Evento[]>("admin_eventos", {
    p_desde: desde, p_tipo: tipo || null, p_busca: buscaAplicada || null, p_limite: 1000,
  });
  const r = resumo.dado;
  const maxDia = Math.max(1, ...(r?.por_dia ?? []).map((d) => d.eventos));

  return (
    <>
      <Secao titulo="Uso do site" subtitulo="Cada clique, navegação, login e erro, com usuário, data e hora, IP, país e navegador."
        acoes={<>
          <Alternador rotulo="Período" valor={dias} aoMudar={setDias}
            opcoes={[{ v: "1", r: "24 h" }, { v: "7", r: "7 dias" }, { v: "30", r: "30 dias" }]} />
          <Lido em={resumo.lidoEm} recarregar={() => { resumo.recarregar(); eventos.recarregar(); }} />
        </>}>
        {resumo.erro && <Erro msg={resumo.erro} />}
        {r && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Numero rotulo="Eventos" valor={Object.values(r.por_tipo).reduce((a, b) => a + b, 0)} />
              <Numero rotulo="Usuários distintos" valor={r.usuarios_distintos} />
              <Numero rotulo="Sessões" valor={r.sessoes} />
              <Numero rotulo="Logins" valor={r.por_tipo.login ?? 0} />
              <Numero rotulo="Logins que falharam" valor={r.por_tipo.login_falha ?? 0} alerta={(r.por_tipo.login_falha ?? 0) > 0} />
              <Numero rotulo="Erros no site" valor={r.por_tipo.erro ?? 0} alerta={(r.por_tipo.erro ?? 0) > 0} />
            </div>
            {r.por_dia.length > 0 && (
              <figure className="mt-4">
                <figcaption className="rotulo mb-1">Eventos por dia (horário de Natal)</figcaption>
                <div className="flex h-28 items-end gap-1" role="img" aria-label="Eventos por dia">
                  {r.por_dia.map((d) => (
                    <div key={d.dia} className="flex h-full min-w-0 flex-1 flex-col items-center" title={`${d.dia}: ${d.eventos} eventos, ${d.usuarios} usuários`}>
                      <div className="flex w-full flex-1 items-end justify-center">
                        <div className="w-full max-w-[28px] rounded-t bg-[var(--destaque)]" style={{ height: `${(d.eventos / maxDia) * 100}%` }} />
                      </div>
                      <span className="num mt-1 text-[0.65rem] text-suave">{d.dia.slice(8, 10)}/{d.dia.slice(5, 7)}</span>
                    </div>
                  ))}
                </div>
              </figure>
            )}
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Lista titulo="O que mais se clicou" itens={r.top_alvos.map((a) => [a.alvo, fmtNum(a.n)])} />
              <Lista titulo="Quem mais usou" itens={r.top_usuarios.map((u) => [u.email, `${fmtNum(u.n)} · último ${haQuanto(u.ultimo)}`])} />
            </div>
          </>
        )}
      </Secao>

      <Secao titulo="Registro de eventos" subtitulo="Até 1.000 eventos mais recentes do período, do mais novo para o mais antigo."
        acoes={<button className="botao" disabled={!eventos.dado?.length} data-rastro="admin: baixar CSV de eventos"
          onClick={() => baixarCsv(`vigigen-eventos-${new Date().toISOString().slice(0, 10)}.csv`,
            (eventos.dado ?? []).map((e) => ({ ...e, navegador: navegador(e.user_agent) })))}>Baixar CSV</button>}>
        <form className="mb-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setBuscaAplicada(busca.trim()); }}>
          <label className="flex flex-col gap-1">
            <span className="rotulo">Tipo</span>
            <select className="entrada" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos</option>
              {Object.entries(TIPOS_EVENTO).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="rotulo">Buscar (e-mail, elemento, tela ou IP)</span>
            <input className="entrada" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </label>
          <button className="botao" type="submit">Filtrar</button>
        </form>
        {eventos.erro && <Erro msg={eventos.erro} />}
        {eventos.carregando && !eventos.dado && <p className="text-suave">Lendo…</p>}
        {eventos.dado && eventos.dado.length === 0 && <Nota>Nenhum evento registrado neste período com estes filtros.</Nota>}
        {eventos.dado && eventos.dado.length > 0 && (
          <div className="max-h-[32rem] overflow-auto">
            <table className="tabela">
              <thead><tr><th>Data e hora</th><th>Usuário</th><th>Tipo</th><th>O quê</th><th>Tela</th><th>IP</th><th>País</th><th>Navegador</th></tr></thead>
              <tbody>
                {eventos.dado.map((e) => (
                  <tr key={e.id}>
                    <td className="num whitespace-nowrap">{new Date(e.ocorrido_em).toLocaleString("pt-BR")}</td>
                    <td className="break-all">{e.email ?? "anônimo"}</td>
                    <td className="whitespace-nowrap" style={e.tipo === "login_falha" || e.tipo === "erro" ? { color: "var(--estado-4-texto)", fontWeight: 600 } : undefined}>
                      {TIPOS_EVENTO[e.tipo] ?? e.tipo}
                    </td>
                    <td className="max-w-[18rem] break-words">{e.alvo ?? "—"}</td>
                    <td className="whitespace-nowrap">{e.rota ?? "—"}</td>
                    <td className="num whitespace-nowrap">{e.ip ?? "—"}</td>
                    <td>{e.pais ?? "—"}</td>
                    <td className="whitespace-nowrap">{navegador(e.user_agent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>

      {r && (
        <Secao titulo="Trilha dos dados" subtitulo="Cargas, cálculos, revisões de alerta e mudanças de usuário registradas em public.auditoria (não pode ser apagada).">
          {r.trilha_dados.length === 0 ? <Nota>Nada registrado no período.</Nota> : (
            <div className="max-h-[24rem] overflow-auto">
              <table className="tabela">
                <thead><tr><th>Data e hora</th><th>Quem</th><th>Ação</th><th>Sobre</th><th>Detalhe</th></tr></thead>
                <tbody>
                  {r.trilha_dados.map((a) => (
                    <tr key={a.id}>
                      <td className="num whitespace-nowrap">{new Date(a.ocorrido_em).toLocaleString("pt-BR")}</td>
                      <td className="break-all">{a.ator}</td>
                      <td>{a.acao}</td>
                      <td>{a.entidade}{a.entidade_id ? ` ${a.entidade_id.slice(0, 40)}` : ""}</td>
                      <td><code className="block max-w-[24rem] overflow-x-auto whitespace-pre text-xs">{JSON.stringify(a.detalhe)}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Secao>
      )}
    </>
  );
}

function Numero({ rotulo, valor, alerta }: { rotulo: string; valor: number; alerta?: boolean }) {
  return (
    <div className="rounded-xl border border-borda p-3">
      <div className="rotulo">{rotulo}</div>
      <div className="num text-2xl font-bold" style={alerta ? { color: "var(--estado-4-texto)" } : undefined}>{fmtNum(valor)}</div>
    </div>
  );
}

function Lista({ titulo, itens }: { titulo: string; itens: [string, string][] }) {
  return (
    <div>
      <h3 className="rotulo mb-1">{titulo}</h3>
      {itens.length === 0 ? <p className="text-sm text-suave">Sem registros no período.</p> : (
        <ol className="text-sm">
          {itens.map(([a, b], i) => (
            <li key={i} className="flex justify-between gap-3 border-b border-borda py-1">
              <span className="min-w-0 break-words">{a}</span><span className="num shrink-0 text-suave">{b}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ---------------- SLA ---------------- */
function PainelSla() {
  const sla = useLeitura<Sla>("admin_sla", {});
  const s = sla.dado;
  return (
    <>
      <Secao titulo="SLA de atualização dos dados"
        subtitulo="Meta de cada fonte = maior intervalo da agenda automática + tolerância (D-014). Cumprimento = % das horas dos últimos 30 dias em que o dado estava dentro da meta."
        acoes={<Lido em={sla.lidoEm} recarregar={sla.recarregar} />}>
        {sla.erro && <Erro msg={sla.erro} />}
        {s && (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Fonte</th><th>Situação</th><th>Última atualização ok</th><th>Idade / meta</th><th>Cumprimento 30 dias</th><th>Agenda</th><th>Última falha</th></tr></thead>
              <tbody>
                {s.fontes.map((f) => (
                  <tr key={f.fonte}>
                    <td className="font-semibold">{f.rotulo}</td>
                    <td><Situacao ok={f.dentro} semDado={!f.ultima_ok} /></td>
                    <td className="num whitespace-nowrap">{f.ultima_ok ? `${fmtDataHora(f.ultima_ok)} (${haQuanto(f.ultima_ok)})` : "nunca"}</td>
                    <td className="num whitespace-nowrap">{f.idade_horas === null ? "—" : `${fmtNum(f.idade_horas, 1)} h`} / {fmtNum(f.meta_horas)} h</td>
                    <td className="num">{f.cumprimento_30d === null ? "sem histórico" : `${fmtNum(f.cumprimento_30d, 1)}% (${fmtNum(f.horas_medidas_30d)} h medidas)`}</td>
                    <td className="whitespace-nowrap">{f.agenda}</td>
                    <td className="max-w-[16rem] text-xs">{f.ultima_falha ? `${fmtDataHora(f.ultima_falha)}: ${f.ultima_falha_msg ?? ""}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>
      {s && (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Secao titulo="Tarefas agendadas (pg_cron, 7 dias)">
            <div className="overflow-x-auto">
              <table className="tabela">
                <thead><tr><th>Tarefa</th><th>Agenda</th><th>Execuções</th><th>Falhas</th><th>Última</th></tr></thead>
                <tbody>
                  {s.agendador.map((j) => (
                    <tr key={j.tarefa}>
                      <td className="whitespace-nowrap">{j.tarefa.replace("vigigen-", "")}{!j.ativa && " (pausada)"}</td>
                      <td className="num whitespace-nowrap">{j.agenda}</td>
                      <td className="num">{fmtNum(j.execucoes_7d)}</td>
                      <td className="num" style={j.falhas_7d ? { color: "var(--estado-4-texto)", fontWeight: 600 } : undefined}>
                        {fmtNum(j.falhas_7d)}{j.ultimo_erro ? ` · ${j.ultimo_erro}` : ""}
                      </td>
                      <td className="num whitespace-nowrap">{j.ultima ? `${fmtDataHora(j.ultima)} · ${j.ultimo_status === "succeeded" ? "ok" : j.ultimo_status}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Secao>
          <Secao titulo="Revisão humana dos alertas">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-suave">Pendentes</dt><dd className="num font-semibold">{fmtNum(s.revisao_alertas.pendentes)}</dd>
              <dt className="text-suave">Mais antigo pendente</dt><dd className="num">{s.revisao_alertas.pendente_mais_antigo ? haQuanto(s.revisao_alertas.pendente_mais_antigo) : "—"}</dd>
              <dt className="text-suave">Mediana até a revisão</dt><dd className="num">{s.revisao_alertas.mediana_horas_revisao === null ? "sem revisões ainda" : `${fmtNum(s.revisao_alertas.mediana_horas_revisao, 1)} h`}</dd>
            </dl>
          </Secao>
        </div>
      )}
    </>
  );
}

function Situacao({ ok, semDado }: { ok: boolean; semDado?: boolean }) {
  const [cor, txt] = semDado ? ["var(--estado-nulo)", "Sem execução"] : ok ? ["var(--estado-1-texto)", "Dentro da meta"] : ["var(--estado-4-texto)", "Atrasada"];
  return <span className="whitespace-nowrap font-semibold" style={{ color: cor }}>{ok ? "●" : "▲"} {txt}</span>;
}

/* ---------------- Alertas do sistema ---------------- */
const GRAV: Record<string, [string, string]> = {
  critico: ["Crítico", "var(--estado-4-texto)"], aviso: ["Atenção", "var(--estado-2-texto)"], info: ["Informação", "var(--texto-suave)"],
};
function AlertasSistema() {
  const al = useLeitura<AlertaSistema[]>("admin_alertas_sistema", {});
  return (
    <Secao titulo="Alertas do sistema"
      subtitulo="Calculados agora a partir do banco: atrasos de SLA, falhas de ingestão e do agendador, cargas paradas, logins falhos repetidos, erros no site, alertas sem revisão e convites expirados."
      acoes={<Lido em={al.lidoEm} recarregar={al.recarregar} />}>
      {al.erro && <Erro msg={al.erro} />}
      {al.dado && al.dado.length === 0 && <Nota>Nenhum alerta do sistema neste momento.</Nota>}
      {al.dado && al.dado.length > 0 && (
        <ul className="flex flex-col gap-2">
          {al.dado.map((a, i) => (
            <li key={i} className="rounded-xl border border-borda p-3" style={{ borderLeft: `4px solid ${GRAV[a.gravidade]?.[1]}` }}>
              <div className="flex flex-wrap justify-between gap-2">
                <strong>{a.titulo}</strong>
                <span className="text-sm font-semibold" style={{ color: GRAV[a.gravidade]?.[1] }}>{GRAV[a.gravidade]?.[0]} · {a.origem}</span>
              </div>
              <p className="text-sm">{a.detalhe}</p>
              {a.desde && <p className="text-xs text-suave">Desde {fmtDataHora(a.desde)}</p>}
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}

/* ---------------- Usuários e perfis ---------------- */
function GestaoUsuarios({ meuId }: { meuId: string }) {
  const u = useLeitura<Usuarios>("admin_usuarios", {});
  const [codigo, setCodigo] = useState<{ email: string; codigo: string; tipo: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const orgs = u.dado?.organizacoes ?? [];

  const agir = async (f: () => Promise<unknown>) => {
    setErro(null);
    try { await f(); u.recarregar(); } catch (e) { setErro((e as Error).message); }
  };

  return (
    <>
      {codigo && (
        <div className="cartao border-[var(--destaque)] p-4" role="status">
          <p className="font-semibold">Código de {codigo.tipo === "cadastro" ? "primeiro acesso" : "nova senha"} para {codigo.email}</p>
          <p className="num my-2 select-all text-3xl font-bold tracking-widest">{codigo.codigo}</p>
          <p className="text-sm text-suave">
            Aparece só agora (o banco guarda apenas o hash). Vale 7 dias e uma única vez. Envie à pessoa por um canal seu; ela abre o site,
            clica em "Recebi um código de acesso", informa e-mail, código e escolhe a senha.
          </p>
          <div className="mt-2 flex gap-2">
            <button className="botao" onClick={() => navigator.clipboard?.writeText(codigo.codigo)}>Copiar código</button>
            <button className="botao" onClick={() => setCodigo(null)}>Fechar</button>
          </div>
        </div>
      )}
      {erro && <Erro msg={erro} />}
      {u.erro && <Erro msg={u.erro} />}

      <Secao titulo="Usuários" subtitulo="Perfil, papel e território de cada pessoa. Desativar bloqueia o login na hora; a conta não é apagada para preservar a trilha de auditoria."
        acoes={<Lido em={u.lidoEm} recarregar={u.recarregar} />}>
        {u.dado && u.dado.usuarios.length === 0 && <Nota>Nenhum usuário ainda.</Nota>}
        <div className="flex flex-col gap-3">
          {u.dado?.usuarios.map((x) => (
            <EditorUsuario key={x.user_id + x.atualizado_em} u={x} orgs={orgs} souEu={x.user_id === meuId}
              salvar={(v) => agir(() => rpc("admin_salvar_usuario", v))}
              redefinir={() => agir(async () => setCodigo({ email: x.email, tipo: "redefinicao", codigo: await rpc<string>("admin_codigo_redefinicao", { p_user_id: x.user_id }) }))} />
          ))}
        </div>
      </Secao>

      <div className="grid gap-4 lg:grid-cols-2">
        <Secao titulo="Convidar pessoa" subtitulo="Gera um código de primeiro acesso. Sem convite ninguém consegue criar conta.">
          <FormConvite orgs={orgs} enviar={(v) => agir(async () => setCodigo({ email: v.p_email as string, tipo: "cadastro", codigo: await rpc<string>("admin_convidar", v) }))} />
        </Secao>
        <Secao titulo="Organizações" subtitulo="Território que cada vínculo enxerga: estado e laboratório veem o RN todo; município vê só o próprio.">
          <FormOrganizacao criar={(v) => agir(() => rpc("admin_criar_organizacao", v))} />
          <ul className="mt-3 text-sm">
            {orgs.map((o) => <li key={o.id} className="border-b border-borda py-1">{o.nome} <span className="text-suave">· {o.tipo}{o.geocodigo ? ` ${o.geocodigo}` : ""}</span></li>)}
            {orgs.length === 0 && <li className="text-suave">Nenhuma organização cadastrada.</li>}
          </ul>
        </Secao>
      </div>

      <Secao titulo="Convites e códigos">
        {u.dado && u.dado.convites.length === 0 ? <Nota>Nenhum convite.</Nota> : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>E-mail</th><th>Tipo</th><th>Perfil</th><th>Criado</th><th>Situação</th><th /></tr></thead>
              <tbody>
                {u.dado?.convites.map((c) => {
                  const pendente = !c.usado_em && new Date(c.expira_em) > new Date();
                  return (
                    <tr key={c.email}>
                      <td className="break-all">{c.email}</td>
                      <td>{c.tipo === "cadastro" ? "Primeiro acesso" : "Nova senha"}</td>
                      <td>{c.administrador ? "Administrador" : ""}{c.papel ? ` ${PAPEIS[c.papel]} · ${c.organizacao}` : ""}</td>
                      <td className="num whitespace-nowrap">{fmtDataHora(c.criado_em)}</td>
                      <td className="whitespace-nowrap">
                        {c.usado_em ? `usado ${fmtDataHora(c.usado_em)}` : pendente ? `pendente até ${fmtDataHora(c.expira_em)}` : "expirado"}
                        {c.tentativas > 0 && ` · ${c.tentativas} tentativa(s) erradas`}
                      </td>
                      <td>{pendente && <button className="botao" onClick={() => agir(() => rpc("admin_revogar_convite", { p_email: c.email }))}>Revogar</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Secao>
    </>
  );
}

type Orgs = Usuarios["organizacoes"];

function SeletorVinculo({ orgs, org, papel, mudar }: { orgs: Orgs; org: string; papel: string; mudar: (org: string, papel: string) => void }) {
  return (
    <>
      <label className="flex min-w-0 flex-col gap-1">
        <span className="rotulo">Organização</span>
        <select className="entrada" value={org} onChange={(e) => mudar(e.target.value, e.target.value ? papel || "leitura" : "")}>
          <option value="">Sem vínculo</option>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
        </select>
      </label>
      <label className="flex min-w-0 flex-col gap-1">
        <span className="rotulo">Papel</span>
        <select className="entrada" value={papel} disabled={!org} onChange={(e) => mudar(org, e.target.value)}>
          {!org && <option value="">—</option>}
          {Object.entries(PAPEIS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
        </select>
      </label>
    </>
  );
}

function EditorUsuario({ u, orgs, souEu, salvar, redefinir }: {
  u: Usuario; orgs: Orgs; souEu: boolean;
  salvar: (v: Record<string, unknown>) => void; redefinir: () => void;
}) {
  const v0 = u.vinculos[0];
  const [nome, setNome] = useState(u.nome ?? "");
  const [admin, setAdmin] = useState(u.administrador);
  const [ativo, setAtivo] = useState(u.ativo);
  const [org, setOrg] = useState(v0?.organizacao_id ?? "");
  const [papel, setPapel] = useState(v0?.papel ?? "");
  const mudou = nome !== (u.nome ?? "") || admin !== u.administrador || ativo !== u.ativo || org !== (v0?.organizacao_id ?? "") || papel !== (v0?.papel ?? "");

  return (
    <article className="rounded-xl border border-borda p-3" style={!u.ativo ? { opacity: 0.7 } : undefined}>
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <strong className="break-all">{u.email}</strong>{souEu && <span className="text-sm text-suave"> (você)</span>}
          {!u.ativo && <span className="ml-2 text-sm font-semibold" style={{ color: "var(--estado-4-texto)" }}>desativado</span>}
        </div>
        <span className="num text-xs text-suave">
          criado {fmtDataHora(u.criado_em)} · último login {u.ultimo_login ? fmtDataHora(u.ultimo_login) : "nunca"}
          {u.ultimo_ip ? ` · IP ${u.ultimo_ip}` : ""}
        </span>
      </header>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_auto_auto]">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="rotulo">Nome</span>
          <input className="entrada" value={nome} onChange={(e) => setNome(e.target.value)} />
        </label>
        <SeletorVinculo orgs={orgs} org={org} papel={papel} mudar={(o, p) => { setOrg(o); setPapel(p); }} />
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={admin} disabled={souEu} onChange={(e) => setAdmin(e.target.checked)} /> Administrador
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={ativo} disabled={souEu} onChange={(e) => setAtivo(e.target.checked)} /> Ativo
        </label>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="botao-primario text-sm" disabled={!mudou}
          onClick={() => salvar({ p_user_id: u.user_id, p_nome: nome, p_administrador: admin, p_ativo: ativo, p_organizacao_id: org || null, p_papel: org ? papel : null })}>
          Salvar perfil
        </button>
        <button className="botao" onClick={redefinir}>Gerar código de nova senha</button>
      </div>
    </article>
  );
}

function FormConvite({ orgs, enviar }: { orgs: Orgs; enviar: (v: Record<string, unknown>) => void }) {
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [admin, setAdmin] = useState(false);
  const [org, setOrg] = useState("");
  const [papel, setPapel] = useState("");
  return (
    <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => {
      e.preventDefault();
      enviar({ p_email: email.trim().toLowerCase(), p_nome: nome || null, p_administrador: admin, p_organizacao_id: org || null, p_papel: org ? papel : null });
      setEmail(""); setNome(""); setAdmin(false); setOrg(""); setPapel("");
    }}>
      <label className="flex min-w-0 flex-col gap-1"><span className="rotulo">E-mail</span>
        <input type="email" required className="entrada" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="flex min-w-0 flex-col gap-1"><span className="rotulo">Nome</span>
        <input className="entrada" value={nome} onChange={(e) => setNome(e.target.value)} /></label>
      <SeletorVinculo orgs={orgs} org={org} papel={papel} mudar={(o, p) => { setOrg(o); setPapel(p); }} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> Administrador</label>
      <div><button className="botao-primario text-sm" type="submit">Gerar convite</button></div>
    </form>
  );
}

function FormOrganizacao({ criar }: { criar: (v: Record<string, unknown>) => void }) {
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("estado");
  const [geo, setGeo] = useState("");
  return (
    <form className="grid gap-2 sm:grid-cols-[1.5fr_1fr_1fr_auto]" onSubmit={(e) => {
      e.preventDefault();
      criar({ p_nome: nome, p_tipo: tipo, p_geocodigo: tipo === "municipio" ? Number(geo) : null });
      setNome(""); setGeo("");
    }}>
      <label className="flex min-w-0 flex-col gap-1"><span className="rotulo">Nome</span>
        <input required className="entrada" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: SESAP/RN" /></label>
      <label className="flex min-w-0 flex-col gap-1"><span className="rotulo">Tipo</span>
        <select className="entrada" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="estado">Estado</option><option value="municipio">Município</option><option value="laboratorio">Laboratório</option>
        </select></label>
      <label className="flex min-w-0 flex-col gap-1"><span className="rotulo">Geocódigo IBGE</span>
        <input className="entrada num" disabled={tipo !== "municipio"} required={tipo === "municipio"} pattern="24\d{5}"
          value={geo} onChange={(e) => setGeo(e.target.value)} placeholder="24xxxxx" /></label>
      <div className="self-end"><button className="botao" type="submit">Criar</button></div>
    </form>
  );
}
