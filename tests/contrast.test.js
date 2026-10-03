import { describe, expect, it } from "vitest";
import fs from "node:fs";

/**
 * Contraste MEDIDO con la fórmula de WCAG 2.1 sobre los valores REALES de
 * tokens.css (se leen del archivo): tema claro y tema oscuro, par por par.
 * Si alguien cambia un color y rompe AA, este test falla con el par y la razón.
 *
 * Texto: ≥ 4.5:1 (AA). Elementos gráficos que transmiten información (reglas
 * de color, puntos de estado, foco): ≥ 3:1 (WCAG 1.4.11).
 */
const css = fs.readFileSync("src/styles/tokens.css", "utf8");

function tokensIn(body) {
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]));
}

/** Tema claro: el primer bloque :root. */
function lightBlock() {
  const start = css.indexOf(":root {");
  return tokensIn(css.slice(start, css.indexOf("\n}", start)));
}

/** Tema oscuro: el :root DENTRO de @media (prefers-color-scheme: dark) (lo decide el sistema operativo). */
function darkBlock() {
  const media = css.indexOf("@media (prefers-color-scheme: dark) {");
  if (media < 0) return {};
  const start = css.indexOf(":root {", media);
  return tokensIn(css.slice(start, css.indexOf("\n  }", start)));
}

const light = lightBlock();
const dark = { ...light, ...darkBlock() };

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [texto, fondo] tal como se combinan en base.css, chat.css, panel.css y voice.css.
const TEXT_PAIRS = [
  ["ink-900", "bg"],
  ["ink-900", "surface"],
  ["ink-900", "navy-100"],
  ["ink-900", "amber-100"],
  ["ink-500", "surface"],
  ["ink-500", "bg"],
  ["ink-500", "sunken"],
  ["ink-500", "navy-100"],
  ["navy-900", "surface"],
  ["navy-900", "bg"],
  ["navy-900", "sunken"],
  ["navy-900", "navy-100"],
  ["navy-700", "surface"],
  ["navy-700", "navy-100"],
  ["navy-500", "surface"],
  ["navy-500", "bg"],
  ["amber-800", "amber-100"],
  ["amber-800", "surface"],
  ["amber-800", "navy-100"],
  ["red-700", "red-100"],
  ["red-700", "surface"],
  ["red-700", "navy-100"],
  ["green-800", "green-100"],
  ["green-800", "surface"],
  ["on-chrome", "chrome"],
  ["on-chrome-muted", "chrome"],
  ["on-primary", "primary"],
  ["on-primary", "primary-hover"],
  ["on-primary", "danger"],
  ["on-primary", "danger-hover"],
  // Llamada en vivo (D1): texto sobre su superficie oscura y sobre los rellenos de acento.
  ["on-live-surface", "live-surface"],
  ["on-live-surface-muted", "live-surface"],
  ["live-call", "live-surface"],
  ["live-agent", "live-surface"],
  ["on-live", "live-call"],
  ["on-live", "live-agent"],
];

const GRAPHIC_PAIRS = [
  ["amber-600", "surface"],
  ["amber-600", "chrome"],
  ["red-700", "surface"],
  ["navy-700", "surface"],
  ["green-800", "surface"],
  ["chrome-danger", "chrome"],
  // Borde de campos de formulario y botones secundarios contra todo fondo donde se apoyan (WCAG 1.4.11).
  ["border-strong", "surface"],
  ["border-strong", "bg"],
  ["border-strong", "sunken"],
  // Estado "conectando / esperando asesor" de la llamada: regla ámbar sobre la superficie en vivo.
  ["amber-600", "live-surface"],
];

const color = (theme, token) => theme[token] ?? theme[`color-${token}`];

describe.each([
  ["claro", light],
  ["oscuro", dark],
])("contraste del tema %s", (_name, theme) => {
  it.each(TEXT_PAIRS)("texto %s sobre %s ≥ 4.5:1", (fg, bg) => {
    expect(color(theme, fg), fg).toBeDefined();
    expect(color(theme, bg), bg).toBeDefined();
    expect(contrast(color(theme, fg), color(theme, bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(GRAPHIC_PAIRS)("gráfico %s sobre %s ≥ 3:1", (fg, bg) => {
    expect(contrast(color(theme, fg), color(theme, bg))).toBeGreaterThanOrEqual(3);
  });

  it("el foco se ve sobre la superficie y el fondo (≥ 3:1)", () => {
    for (const bg of ["surface", "bg"]) {
      expect(contrast(theme.focus, color(theme, bg))).toBeGreaterThanOrEqual(3);
    }
  });
});

/**
 * PORTADA (F4): sigue el tema del sistema como toda la app, así que sus pares se
 * miden en LOS DOS temas. Cada par, tal como se combina en la sección "PORTADA"
 * de base.css. Los dos del bloque principal usan tokens propios
 * (primary-rule, on-primary-accent): en oscuro el ámbar de siempre no alcanza.
 */
describe.each([
  ["claro", light],
  ["oscuro", dark],
])("portada, tema %s: contraste de cada par que usa", (_name, theme) => {
  const LANDING_TEXT = [
    ["navy-900", "bg"], // marca y título
    ["ink-500", "bg"], // entradilla, línea del staff, pie de figura, etiqueta del asistente
    ["navy-500", "bg"], // enlace "Entrar al panel de asesores"
    ["on-primary", "primary"], // bloque del cliente
    ["on-primary-accent", "primary"], // "Escribir al banco →" al pasar el cursor o enfocar
    ["ink-900", "navy-100"], // mensaje del cliente
    ["ink-500", "navy-100"], // etiqueta "Cliente"
    ["ink-900", "bg"], // mensaje del asistente
    ["ink-900", "amber-100"], // mensaje de la asesora
    ["amber-800", "amber-100"], // etiqueta "Laura · asesora"
  ];
  const LANDING_GRAPHIC = [
    ["primary-rule", "primary"], // regla del bloque del cliente (y al ensancharse)
    ["amber-600", "bg"], // regla del enlace del staff al pasar el cursor o enfocar
    ["navy-700", "surface"], // regla del mensaje del cliente
    ["ink-500", "surface"], // regla del mensaje del asistente
    ["amber-600", "surface"], // regla del mensaje de la asesora
    ["focus", "bg"], // contorno de foco (se dibuja por fuera, sobre el fondo)
  ];

  it.each(LANDING_TEXT)("texto %s sobre %s ≥ 4.5:1", (fg, bg) => {
    expect(contrast(color(theme, fg), color(theme, bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(LANDING_GRAPHIC)("gráfico %s sobre %s ≥ 3:1", (fg, bg) => {
    expect(contrast(color(theme, fg), color(theme, bg))).toBeGreaterThanOrEqual(3);
  });

  it("los pares listados son EXACTAMENTE los colores que usa la portada en base.css", () => {
    const base = fs.readFileSync("src/styles/base.css", "utf8");
    const start = base.indexOf("/* === PORTADA (bloque F4) ===");
    const section = base.slice(start, base.indexOf("@media (min-width: 48rem)", start));
    const used = new Set([...section.matchAll(/var\(--color-([\w-]+)\)/g)].map((m) => m[1]));
    const listed = new Set([...LANDING_TEXT, ...LANDING_GRAPHIC].flat());
    // "border" es el separador fino (decorativo, no transmite información): no requiere 3:1.
    expect([...used].filter((t) => !listed.has(t) && t !== "border").sort()).toEqual([]);
  });
});

describe("tema oscuro", () => {
  it("redefine TODOS los colores del tema claro (ninguno queda claro sobre oscuro por olvido)", () => {
    const darkOnly = darkBlock();
    const colorTokens = Object.keys(light).filter((k) => k.startsWith("color-") || k === "focus");
    expect(colorTokens.filter((k) => !(k in darkOnly))).toEqual([]);
  });

  it("la fórmula coincide con valores conocidos (negro/blanco 21:1)", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

describe("acento en vivo: por qué solo va en la superficie de la llamada", () => {
  it("sobre las superficies claras NO alcanza ni 3:1 (por eso no se usa ahí)", () => {
    for (const token of ["color-live-call", "color-live-agent"]) {
      expect(contrast(light[token], light["color-surface"])).toBeLessThan(3);
    }
  });
});

describe("una sola animación y el acento solo en llamadas (reglas del sistema de diseño)", () => {
  const styles = fs
    .readdirSync("src/styles")
    .filter((f) => f.endsWith(".css"))
    .map((f) => ({ file: f, css: fs.readFileSync(`src/styles/${f}`, "utf8") }));

  it("hay exactamente UNA animación (@keyframes) en todo el CSS: el traspaso de la llamada", () => {
    const keyframes = styles.flatMap(({ file, css }) =>
      [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => `${file}:${m[1]}`)
    );
    expect(keyframes).toEqual(["voice.css:callbar-handoff"]);
  });

  it("los tokens del acento en vivo solo se usan en voice.css (componentes de llamada)", () => {
    const users = styles
      .filter(({ file, css }) => file !== "tokens.css" && /var\(--color-(live|on-live)/.test(css))
      .map((s) => s.file);
    expect(users).toEqual(["voice.css"]);
  });

  it("la animación respeta prefers-reduced-motion", () => {
    const voice = styles.find((s) => s.file === "voice.css").css;
    expect(voice).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*callbar--handoff[\s\S]*animation: none/);
  });
});
