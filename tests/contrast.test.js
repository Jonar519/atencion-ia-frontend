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

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]));
}

const light = block(":root");
const dark = { ...light, ...block(':root[data-theme="dark"]') };

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

describe("tema oscuro", () => {
  it("redefine TODOS los colores del tema claro (ninguno queda claro sobre oscuro por olvido)", () => {
    const darkOnly = block(':root[data-theme="dark"]');
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
