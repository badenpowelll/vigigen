import { IMAGENS } from "./vetorImagens";

const VIRUS = [
  { id: "dengue" as const, nome: "Dengue (DENV)", familia: "Flaviviridae, gênero Orthoflavivirus", nota: "4 sorotipos (DENV-1 a DENV-4), com genótipos e linhagens" },
  { id: "chikungunya" as const, nome: "Chikungunya (CHIKV)", familia: "Togaviridae, gênero Alphavirus", nota: "no Brasil circulam sobretudo os genótipos ECSA e Asiático" },
  { id: "zika" as const, nome: "Zika (ZIKV)", familia: "Flaviviridae, gênero Orthoflavivirus", nota: "linhagem asiática na epidemia das Américas de 2015–2016" },
];

/** Os três vírus têm o mesmo vetor: mostrar um mosquito por vírus seria errado. */
export function Vetor() {
  const img = (id: string) => IMAGENS.find((x) => x.id === id);
  const aedes = img("aedes");
  return (
    <section aria-labelledby="titulo-vetor" className="mt-4 rounded-[var(--raio)] border border-borda p-4">
      <h3 id="titulo-vetor" className="text-base font-bold">Três vírus, um vetor</h3>
      <div className="mt-2 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <figure className="min-w-0">
          {aedes && <img src={aedes.src} alt={aedes.alt} className="w-full rounded-[var(--surface-rounder-sm)]" loading="lazy" />}
          <figcaption className="mt-1 text-sm">
            <strong><i>Aedes aegypti</i></strong> transmite dengue, chikungunya e Zika no Brasil; o <i>Aedes albopictus</i> tem papel
            secundário, ainda em estudo. Por isso o mapa separa os vírus por cor, não por mosquito.
            {aedes && <span className="block text-xs text-suave">Foto: {aedes.credito} · {aedes.licenca} · <a href={aedes.origem} target="_blank" rel="noreferrer">origem</a></span>}
          </figcaption>
        </figure>
        <ul className="grid min-w-0 gap-3 sm:grid-cols-3">
          {VIRUS.map((v) => {
            const f = img(v.id);
            return (
              <li key={v.id} className="min-w-0 rounded-[var(--surface-rounder-sm)] border-t-4 p-2" style={{ borderTopColor: `var(--${v.id}-5)` }}>
                {f && <img src={f.src} alt={f.alt} className="mb-1 w-full rounded" loading="lazy" />}
                <p className="text-sm font-bold">{v.nome}</p>
                <p className="text-xs text-suave">{v.familia}; {v.nota}.</p>
                {f && <p className="mt-1 text-[0.7rem] text-suave">Imagem: {f.credito} · {f.licenca} · <a href={f.origem} target="_blank" rel="noreferrer">origem</a></p>}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
