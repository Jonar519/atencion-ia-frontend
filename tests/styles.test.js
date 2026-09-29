import { describe, expect, it } from "vitest";
import fs from "node:fs";

/**
 * Regresión de la prueba EN VIVO de la Fase 4: en el navegador, una regla como
 * `.chat { display: grid }` le ganaba al [hidden] del navegador y el chat
 * "oculto" se veía detrás del formulario de inicio.
 *
 * Limitación honesta: jsdom NO reproduce esa cascada (un intento de probarlo con
 * getComputedStyle pasaba igual con y sin el arreglo, así que se descartó).
 * Por eso este test verifica que la regla que lo corrige siga en la hoja de
 * estilos; el comportamiento real se verificó en el navegador (docs/fase4-verificacion.md).
 */
describe("estilos: el atributo hidden siempre gana", () => {
  it("base.css fuerza display:none para [hidden] con !important", () => {
    const css = fs.readFileSync("src/styles/base.css", "utf8");
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });
});
