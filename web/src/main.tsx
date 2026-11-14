import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { aplicarTema, lerTema } from "./componentes/Acessibilidade";

// tema escolhido aplicado antes da primeira pintura (sem piscar)
aplicarTema(lerTema());
// Padrão Digital de Governo 3.7.0 (pacote oficial @govbr-ds/core, MIT):
// só os tokens e os componentes usados, para não trazer o reset global.
import "@govbr-ds/core/dist/core-tokens.min.css";
import "@govbr-ds/core/dist/components/button/button.min.css";
import "@govbr-ds/core/dist/components/message/message.min.css";
import "./tema.css";

createRoot(document.getElementById("raiz")!).render(<StrictMode><App /></StrictMode>);
