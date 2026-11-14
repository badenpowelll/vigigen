/** Imagens de licença livre do vetor e dos vírus, embutidas como data URI.
 *  Cada uma leva autor, licença e link da página de origem. Lista vazia = o
 *  painel mostra só o texto (nenhuma imagem é inventada ou gerada). */
export interface ImagemLivre {
  id: "aedes" | "dengue" | "chikungunya" | "zika";
  src: string;
  alt: string;
  credito: string;
  licenca: string;
  origem: string;
}
export const IMAGENS: ImagemLivre[] = [];
