import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default [
  { ignores: ["dist/", "node_modules/", "coverage/", "test-results/", "playwright-report/", "e2e/.generated/"] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.browser } },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      // Nunca se inserta HTML desde strings: todo se construye con lib/dom.js (textContent).
      "no-restricted-properties": [
        "error",
        { property: "innerHTML", message: "Usa lib/dom.js (h) o textContent: innerHTML abre la puerta a XSS." },
        { property: "outerHTML", message: "Usa lib/dom.js." },
        { property: "insertAdjacentHTML", message: "Usa lib/dom.js." },
      ],
    },
  },
  {
    files: ["src/sw/**", "src/workers/**"],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.worker, __PRECACHE_URLS__: "readonly" } },
  },
  {
    files: ["vite.config.js", "scripts/**", "eslint.config.js", "playwright.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Los tests pueden leer innerHTML para VERIFICAR que no hay HTML inyectado.
    files: ["tests/**"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { "no-restricted-properties": "off" },
  },
  {
    // E2E: código de Node que además evalúa funciones dentro de la página (page.evaluate).
    files: ["e2e/**"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  prettier,
];
