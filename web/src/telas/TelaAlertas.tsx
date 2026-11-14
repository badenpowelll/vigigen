import { useState } from "react";
import type { Ctx } from "./ctx";
import { Nota, Secao } from "../componentes/basicos";
import { revisarAlerta, supabase } from "../dados/supabase";
import { DOENCA_ROTULO, fmtDataHora, fmtNum } from "../util";
import { SIGLA_VIRUS, estadoDeteccao, genomicaDe, motivoSemGenomica } from "../dados/calc";

const STATUS: Record<string, string> = { novo: "Novo, aguardando revisão", em_analise: "Em análise", confirmado: "Confirmado por revisor", descartado: "Descartado por revisor" };

export function TelaAlertas({ dados, g, nomeSel, doenca }: Ctx) {
  const r = dados.resumo!;
  const gen = genomicaDe(r, doenca);
  const agr = DOENCA_ROTULO[doenca].toLowerCase();
  const det = estadoDeteccao(r, doenca, g);
  const lista = det.alertas;
  const [erro, setErro] = useState<string | null>(null);
  const podeRevisar = dados.origem === "supabase" && !!supabase;

  return (
    <div className="flex flex-col gap-4">
      <Secao titulo={`Alertas de mudança de perfil de linhagem · ${DOENCA_ROTULO[doenca]} · ${nomeSel}`} subtitulo="Cada alerta precisa de revisão humana. Nenhum alerta se confirma sozinho.">
        {det.estado === "sem_sequencias" ? (
          <Nota tipo="aviso">
            <strong>Sem sequências.</strong> {motivoSemGenomica(doenca, gen.estado)} Sem sequências não há classificação nem detecção.
            A ausência de alertas aqui não significa ausência de mudança.
          </Nota>
        ) : det.estado === "aguardando_classificacao" || det.estado === "qc_insuficiente" ? (
          <div className="flex flex-col gap-3">
            <Nota tipo="aviso">
              <strong>{det.estado === "qc_insuficiente" ? "Controle de qualidade insuficiente." : "Aguardando classificação."}</strong>{" "}
              Há {fmtNum(gen.r?.genbank.total)} sequências de {agr} ingeridas e 0 classificadas
              {det.estado === "qc_insuficiente" ? `; ${fmtNum(det.excluidasQc)} foram excluídas no controle de qualidade, com o motivo registrado` : ""}.
              A detecção depende da classificação de {doenca === "dengue" ? "sorotipo, genótipo e linhagem" : "genótipo ou linhagem"}
              {doenca === "dengue" ? "" : `, que para ${SIGLA_VIRUS[doenca]} ainda não está definida (${gen.classificacao ?? "o dataset Nextclade precisa ser verificado"})`}.
              A ausência de alertas aqui não significa ausência de mudança.
            </Nota>
            <div className="text-sm">
              <p className="font-semibold">O que falta para os alertas de {agr} existirem</p>
              <ol className="ml-5 list-decimal text-suave">
                <li>Rodar o Nextclade com um dataset oficial de {SIGLA_VIRUS[doenca]} sobre as sequências, no GitHub Actions ou localmente{doenca === "dengue" ? "" : " (dataset ainda a verificar)"}.</li>
                <li>Aplicar o controle de qualidade e registrar cada exclusão com o motivo.</li>
                <li>Rodar as regras de detecção: R1 linhagem inédita no território, R2 aumento de proporção com intervalo de Wilson, R3 queda da razão sequências/casos; janela de 8 trimestres e mínimo de 10 sequências.</li>
                <li>Cada alerta nasce como "novo" e só muda de estado por ação de um revisor de vigilância ou laboratório, com registro em auditoria.</li>
              </ol>
            </div>
          </div>
        ) : det.estado === "deteccao_pendente" ? (
          <Nota tipo="aviso">
            <strong>Detecção pendente.</strong> Há {fmtNum(det.classificadas)} sequências de {agr} classificadas, mas não há registro de execução
            das regras R1, R2 e R3 {doenca === "dengue" ? "visível para o seu perfil" : `para ${SIGLA_VIRUS[doenca]} (a detecção roda hoje só sobre dengue)`}.
            Sem essa execução, a ausência de alertas não é um resultado.
          </Nota>
        ) : det.estado === "concluida_sem_alertas" ? (
          <Nota>
            <strong>Detecção concluída sem alertas</strong> para {nomeSel}: última execução em {fmtDataHora(det.deteccaoEm)}, sobre {fmtNum(det.classificadas)} sequências de {agr} classificadas.
            {typeof r.deteccao?.resumo?.pares_abaixo_do_minimo === "number" && ` ${fmtNum(r.deteccao.resumo.pares_abaixo_do_minimo as number)} pares território-trimestre ficaram abaixo do mínimo de sequências e não puderam ser avaliados.`}
          </Nota>
        ) : (
          <ul className="flex flex-col gap-2">
            {lista.map((a) => (
              <li key={a.id} className="rounded-[var(--raio)] border border-borda p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>{a.tipo}</strong>
                  <span className="text-sm font-semibold">{STATUS[a.status]}</span>
                </div>
                <p className="text-sm text-suave">Período {a.p} · criado {fmtDataHora(a.criado)}{a.rev ? ` · revisado ${fmtDataHora(a.rev)}` : ""}</p>
                <pre tabIndex={0} aria-label="Evidência do alerta" className="mt-2 overflow-x-auto rounded-[var(--surface-rounder-sm)] bg-[var(--superficie-2)] p-2 text-xs">{JSON.stringify(a.ev, null, 2)}</pre>
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
