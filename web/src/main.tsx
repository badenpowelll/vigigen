import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { aplicarTema, lerTema } from "./componentes/Acessibilidade";
// Padrão Digital de Governo 3.7.0 (pacote oficial @govbr-ds/core, MIT):
// só os tokens e os componentes usados, para não trazer o reset global.
import "@govbr-ds/core/dist/core-tokens.min.css";
import "@govbr-ds/core/dist/components/button/button.min.css";
import "@govbr-ds/core/dist/components/message/message.min.css";
import { supabase } from "./dados/supabase";
import { useSessao } from "./dados/auth";
import { TelaLogin } from "./telas/TelaLogin";
import "./tema.css";

// tema escolhido aplicado antes da primeira pintura (sem piscar)
aplicarTema(lerTema());

// Painel web (com Supabase configurado): exige login. Artefato do claude.ai
// (sem Supabase): abre direto, lendo pelo conector do visitante ou pelo retrato.
function Raiz() {
  const { sessao, perfil, pronto } = useSessao();
  if (!supabase) return <App />;
  if (!pronto) return <p className="gutter py-8 text-suave">Verificando acesso…</p>;
  if (!sessao) return <TelaLogin />;
  return <App perfil={perfil} />;
}

createRoot(document.getElementById("raiz")!).render(<StrictMode><Raiz /></StrictMode>);
