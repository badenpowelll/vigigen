import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { supabase } from "./dados/supabase";
import { useSessao } from "./dados/auth";
import { TelaLogin } from "./telas/TelaLogin";
import "./tema.css";

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
