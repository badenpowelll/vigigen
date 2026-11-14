/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["variant", ["@media (prefers-color-scheme: dark) { &:not([data-theme=light] *) }", "&:is([data-theme=dark] *)"]],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Rawline", "Raleway", "Segoe UI", "Roboto", "Arial", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        fundo: "var(--fundo)", superficie: "var(--superficie)", borda: "var(--borda)",
        texto: "var(--texto)", suave: "var(--texto-suave)", imd: "var(--imd)", "imd-forte": "var(--imd-forte)",
        destaque: "var(--destaque)",
      },
      borderRadius: { pilula: "30px" },
    },
  },
  plugins: [],
};
