import type { Ctx } from "./ctx";
import { Secao } from "../componentes/basicos";
import { fmtDataHora, fmtNum } from "../util";

const FONTES = [
  { id: "infodengue", nome: "InfoDengue (Fiocruz / FGV)", url: "https://info.dengue.mat.br/services/api", uso: "Casos notificados e estimados, incidência, Rt e nível de alerta por município e semana epidemiológica. Endpoint /api/alertcity, formato JSON. Atualização semanal." },
  { id: "genbank", nome: "NCBI GenBank (E-utilities)", url: "https://www.ncbi.nlm.nih.gov/books/NBK25501/", uso: "Sequências de vírus dengue depositadas com origem Brasil: esearch + efetch (GBSet XML). Metadados de coleta, origem, sorotipo declarado e FASTA." },
  { id: "ibge", nome: "IBGE: Localidades e malha municipal", url: "https://servicodados.ibge.gov.br/api/docs/localidades", uso: "Lista oficial dos 167 municípios do RN e limites municipais. A API de localidades falhou por certificado TLS; a malha veio do GeoServer oficial do IBGE (BC250 2025), com o erro registrado." },
];

export function TelaSobre({ dados }: Ctx) {
  const r = dados.resumo!;
  return (
    <div className="flex flex-col gap-4">
      <Secao titulo="Fontes" subtitulo="Toda resposta externa é gravada crua, com data e hash, antes de qualquer transformação.">
        <ul className="flex flex-col gap-3">
          {FONTES.map((f) => {
            const st = r.fontes?.[f.id];
            return (
              <li key={f.id} className="rounded-[var(--raio)] border border-borda p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <a href={f.url} target="_blank" rel="noreferrer" className="font-semibold underline">{f.nome}</a>
                  <span className="num text-xs text-suave">
                    {st ? `última carga ${fmtDataHora(st.finalizado_em)} · ${fmtNum(st.registros)} registros` : "sem carga concluída"}
                    {r.em_andamento.includes(f.id) ? " · carga em andamento" : ""}
                  </span>
                </div>
                <p className="mt-1 text-sm text-suave">{f.uso}</p>
              </li>
            );
          })}
        </ul>
      </Secao>
      <Secao titulo="Método">
        <div className="flex max-w-prose flex-col gap-2 text-sm">
          <p><strong>Cobertura genômica observável no GenBank</strong> = sequências de dengue depositadas com coleta no período e município identificado ÷ casos notificados de dengue no mesmo período e território. Fica sem dado, com o motivo, quando não há casos ou quando há sequência do RN sem município.</p>
          <p><strong>Oportunidade</strong> = dias entre a coleta e a criação do registro no GenBank, por sorotipo e ano. Mediana com P25 e P75; só coletas com data exata.</p>
          <p><strong>Origem da sequência</strong> vem do campo geo_loc_name (country) do GenBank. Sequências com "/RN/" no nome da cepa, mas sem RN no geo_loc, são contadas à parte e não entram nos indicadores.</p>
          <p><strong>Duplicidade (achado de 14/11/2026, em investigação)</strong>: 17 títulos de registro aparecem mais de uma vez na base, o que pode indicar segmentos diferentes de uma mesma amostra. As contagens ainda tratam cada registro como uma sequência.</p>
          <p><strong>Nível de alerta</strong> é o do InfoDengue (1 a 4), mostrado sempre com cor, ícone e rótulo.</p>
          <p><strong>Atualização</strong>: cargas automáticas agendadas no banco (InfoDengue segunda e quinta, GenBank todo dia, IBGE mensal) e indicadores recalculados a cada 6 horas. Os dados não são instantâneos: cada número mostra a origem e a data.</p>
          <p><strong>Acesso</strong>: o banco usa Row Level Security. Cada usuário só vê o território da própria organização; o laboratório e o estado veem tudo; toda revisão de alerta fica em auditoria que não pode ser apagada.</p>
        </div>
      </Secao>
      <Secao titulo="Sobre o projeto">
        <p className="max-w-prose text-sm">
          VigiGen é o artefato de uma tese de doutorado em Bioinformática na UFRN/IMD, construída com Design Science Research.
          A interface segue o Padrão Digital de Governo (gov.br Design System 3.7.0); a marca é a do próprio VigiGen. Painel gerado em {fmtDataHora(r.gerado_em)}.
        </p>
      </Secao>
    </div>
  );
}
