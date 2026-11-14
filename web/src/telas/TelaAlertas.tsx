import { useState } from "react";
import type { Ctx } from "./ctx";
import { Nota, Secao } from "../componentes/basicos";
import { revisarAlerta, supabase } from "../dados/supabase";
import { DOENCA_ROTULO, fmtDataHora, fmtNum } from "../util";
import { SIGLA_VIRUS, genomicaDe } from "../dados/calc";

const STATUS: Record<string, string> = { novo: "Novo, aguardando revisão", em_analise: "Em análise", confirmado: "Confirmado por revisor", descartado: "Descartado por revisor" };

export function TelaAlertas({ dados, g, nomeSel, doenca }: Ctx) {
  const r = dados.resumo!;
  const gen = genomicaDe(r, doenca);
  const agr = DOENCA_ROTULO[doenca].toLowerCase();
  // alertas antigos (antes da migração 013) não têm agravo e são de dengue
  const lista = r.alertas.filter((a) => (a.a ?? "dengue") === doenca && (g === null || a.g === g));
  const [erro, setErro] = useState<string | null>(null);
  const podeRevisar = dados.origem === "supabase" && !!supabase;

  return (
    <div className="flex flex-col gap-4">
      <Secao titulo={`Alertas de mudança de perfil de linhagem · ${DOENCA_ROTULO[doenca]} · ${nomeSel}`} subtitulo="Cada alerta precisa de revisão humana. Nenhum alerta se confirma sozinho.">
        {doenca !== "dengue" && lista.length === 0 ? (
          <Nota tipo="aviso">
            Sem dado para {agr}: as regras R1, R2 e R3 rodam por vírus e dependem de classificação de genótipo ou linhagem.
            Para {SIGLA_VIRUS[doenca]} ela ainda não está definida ({gen.classificacao ?? "o dataset Nextclade precisa ser verificado"}).
            {gen.estado === "ok" ? ` Há ${fmtNum(gen.r?.genbank.total)} sequências de ${agr} ingeridas, ainda sem classificação.` : " As sequências deste vírus ainda não foram ingeridas do GenBank."}
            {" "}A ausência de alertas aqui não significa ausência de mudança.
          </Nota>
        ) : r.classificacao.total === 0 ? (
          <div className="flex flex-col gap-3">
            <Nota tipo="aviso">
              <strong>Sem dado para este período.</strong> Ainda não há alertas porque a detecção depende da classificação de
              linhagem, e ela não rodou: {fmtNum(gen.r?.genbank.total)} sequências de dengue foram ingeridas e 0 foram classificadas pelo Nextclade.
              A ausência de alertas aqui não significa ausência de mudança.
            </Nota>
            <div className="text-sm">
              <p className="font-semibold">O que falta para os alertas existirem</p>
              <ol className="ml-5 list-decimal text-suave">
                <li>Rodar o Nextclade (dataset oficial de dengue) sobre as sequências, no GitHub Actions ou localmente.</li>
                <li>Aplicar o controle de qualidade (cobertura mínima de 70% do genoma) e registrar cada exclusão com o motivo.</li>
                <li>Rodar as regras de detecção: R1 linhagem inédita no território, R2 aumento de proporção com intervalo de Wilson, R3 queda da cobertura de sequenciamento; janela de 8 trimestres e mínimo de 10 sequências.</li>
                <li>Cada alerta nasce como "novo" e só muda de estado por ação de um revisor de vigilância ou laboratório, com registro em auditoria.</li>
              </ol>
            </div>
          </div>
        ) : lista.length === 0 ? (
          <Nota>Nenhum alerta registrado para {nomeSel}. Classificadas até agora: {fmtNum(r.classificacao.total)} sequências.</Nota>
        ) : (
          <ul className="flex flex-col gap-2">
            {lista.map((a) => (
              <li key={a.id} className="rounded-[var(--raio)] border border-borda p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>{a.tipo}</strong>
                  <span className="text-sm font-semibold">{STATUS[a.status]}</span>
                </div>
                <p className="text-sm text-suave">Período {a.p} · criado {fmtDataHora(a.criado)}{a.rev ? ` · revisado ${fmtDataHora(a.rev)}` : ""}</p>
                <pre className="mt-2 overflow-x-auto rounded-[var(--surface-rounder-sm)] bg-[var(--superficie-2)] p-2 text-xs">{JSON.stringify(a.ev, null, 2)}</pre>
                {podeRevisar && a.status !== "confirmado" && a.status !== "descartado" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(["em_analise", "confirmado", "descartado"] as const).map((s) => (
                      <button key={s} type="button" className={`br-button small ${s === "confirmado" ? "primary" : "secondary"}`}
                        onClick={() => revisarAlerta(a.id, s).catch((e) => setErro(String(e.message ?? e)))}>{STATUS[s]}</button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {erro && <p className="mt-2 text-sm" style={{ color: "var(--estado-4-texto)" }}>Revisão não gravada: {erro}</p>}
      </Secao>
    </div>
  );
}
