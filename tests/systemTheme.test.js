import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * TEMA = EL DEL SISTEMA OPERATIVO, en TODAS las pantallas y para todos los
 * roles, sin ninguna forma de elegirlo en la interfaz (reemplaza el modelo del
 * F1: tema por superficie + preferencia del perfil).
 *
 * jsdom no evalúa media queries, así que aquí se exige la ESTRUCTURA que lo
 * garantiza; el comportamiento real (todas las pantallas en claro y en oscuro,
 * y el cambio en vivo sin recargar) lo prueba Chrome en e2e/system-theme.spec.js.
 */
const read = (file) => fs.readFileSync(file, "utf8");

function filesIn(dir, ext) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesIn(full, ext);
    return full.endsWith(ext) ? [full] : [];
  });
}

const tokens = read("src/styles/tokens.css");

describe("el tema lo decide SOLO el sistema operativo", () => {
  it("los colores oscuros viven bajo @media (prefers-color-scheme: dark): cambia en vivo, sin recargar ni JavaScript", () => {
    const media = tokens.indexOf("@media (prefers-color-scheme: dark) {");
    expect(media).toBeGreaterThan(0);
    const inside = tokens.slice(media, tokens.indexOf("\n}", media));
    expect(inside).toMatch(/:root \{[\s\S]*--color-bg: #/);
    expect(inside).toMatch(/color-scheme: dark;/);
  });

  it("no queda ningún tema por atributo (data-theme) ni en el CSS ni en el código", () => {
    const offenders = [...filesIn("src", ".css"), ...filesIn("src", ".js")].filter((file) =>
      /data-theme|dataset\.theme/.test(read(file))
    );
    expect(offenders).toEqual([]);
  });

  it("ningún código decide el tema: no hay theme.js ni lecturas de prefers-color-scheme en JavaScript", () => {
    expect(fs.existsSync("src/theme.js")).toBe(false);
    const offenders = filesIn("src", ".js").filter((file) =>
      /matchMedia\([^)]*prefers-color-scheme|applyTheme|setThemeSurface/.test(read(file))
    );
    expect(offenders).toEqual([]);
  });

  it("ninguna pantalla puede salirse: solo tokens.css define colores o fija el esquema", () => {
    const offenders = filesIn("src/styles", ".css")
      .filter((file) => !file.endsWith("tokens.css"))
      .filter((file) => /^\s*--color-[\w-]+\s*:|color-scheme\s*:|prefers-color-scheme/m.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("el documento admite los dos esquemas (controles nativos y barras de desplazamiento también siguen al sistema)", () => {
    expect(read("index.html")).toMatch(/<meta name="color-scheme" content="light dark" \/>/);
  });
});
