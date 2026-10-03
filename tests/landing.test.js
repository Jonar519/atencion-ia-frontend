import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { landingView } from "../src/views/landing.view.js";

/**
 * PORTADA (bloque F4): un solo momento destacado (fragmento de conversación con
 * la regla de color real del sistema), cliente como acción principal y staff
 * discreto, y UNA micro-interacción instantánea (sin animación).
 */
function mount() {
  const root = document.body.appendChild(document.createElement("div"));
  landingView(root);
  return root;
}

/**
 * Las REGLAS de la portada en base.css (entre su comentario y el siguiente
 * bloque), sin comentarios: un comentario que diga "sin transition" no debe
 * contar como una transición.
 */
function landingCss() {
  const base = fs.readFileSync("src/styles/base.css", "utf8");
  const start = base.indexOf("/* === PORTADA (bloque F4) ===");
  return base.slice(start, base.indexOf("\n.login,", start)).replace(/\/\*[\s\S]*?\*\//g, "");
}

beforeEach(() => document.body.replaceChildren());

describe("estructura semántica", () => {
  it("un <main>, un solo <h1>, y las opciones en un <nav> con nombre accesible", () => {
    const root = mount();
    expect(root.querySelectorAll("main")).toHaveLength(1);
    expect(root.querySelectorAll("h1")).toHaveLength(1);
    expect(root.querySelector("h1").textContent).toBe("Atención al cliente, a cualquier hora");
    const nav = root.querySelector("nav");
    expect(nav.getAttribute("aria-label")).toBe("Elige cómo entrar");
    expect([...nav.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["#/chat", "#/agente"]);
  });

  it("sin la etiqueta en mayúsculas de antes (no aportaba información)", () => {
    const root = mount();
    expect(root.querySelector(".eyebrow")).toBeNull();
    expect(root.querySelector(".landing__brand").textContent).toBe("Banco Cordillera");
  });
});

describe("jerarquía: el cliente es la acción principal; el staff, discreto", () => {
  it("las dos opciones NO son iguales: bloque principal para el cliente, enlace en una línea para el staff", () => {
    const root = mount();
    const customer = root.querySelector('a[href="#/chat"]');
    const staff = root.querySelector('a[href="#/agente"]');
    expect(customer.className).toBe("landing__customer");
    expect(staff.className).toBe("landing__staff-link");
    expect(customer.textContent).toMatch(/^Soy cliente.*Escribir al banco/);
    // El del staff vive dentro de una línea de texto, no como un bloque propio.
    expect(staff.parentElement.tagName).toBe("P");
    expect(staff.parentElement.textContent).toMatch(/^¿Trabajas en el banco\? Entrar al panel de asesores/);
  });

  it("el cliente va PRIMERO en el documento (en el teléfono, antes que el fragmento)", () => {
    const root = mount();
    const order = [...root.querySelectorAll(".landing__customer, .landing__staff-link, figure")].map(
      (el) => el.className || el.tagName
    );
    expect(order).toEqual(["landing__customer", "landing__staff-link", "landing__demo"]);
  });
});

describe("el momento destacado: un fragmento de conversación con la regla de color real", () => {
  it("tres turnos en orden: cliente (navy), asistente (gris), persona del banco (ámbar)", () => {
    const root = mount();
    const turns = [...root.querySelectorAll(".landing__msg")].map((m) => [
      [...m.classList].find((c) => c.startsWith("landing__msg--")),
      m.querySelector(".landing__who").textContent,
    ]);
    expect(turns).toEqual([
      ["landing__msg--customer", "Cliente"],
      ["landing__msg--ai", "Asistente virtual"],
      ["landing__msg--agent", "Laura · asesora"],
    ]);
    const css = landingCss();
    expect(css).toMatch(/\.landing__msg--customer \{[^}]*border-left-color: var\(--color-navy-700\)/);
    expect(css).toMatch(/\.landing__msg--ai \{[^}]*border-left-color: var\(--color-ink-500\)/);
    expect(css).toMatch(/\.landing__msg--agent \{[^}]*border-left-color: var\(--color-amber-600\)/);
  });

  it("es ilustrativo: oculto para lectores de pantalla (no es un chat real) y con un pie VISIBLE que lo explica", () => {
    const root = mount();
    const figure = root.querySelector("figure");
    expect(figure.querySelector(".landing__thread").getAttribute("aria-hidden")).toBe("true");
    const caption = figure.querySelector("figcaption");
    expect(caption.getAttribute("aria-hidden")).toBeNull();
    expect(caption.textContent).toMatch(/el asistente responde al instante y, si hace falta, una persona del banco/);
  });
});

describe("una sola micro-interacción, instantánea", () => {
  it("el mismo cambio al pasar el cursor Y al enfocar con teclado (la regla se ensancha, la acción cambia de color)", () => {
    const css = landingCss();
    expect(css).toMatch(/\.landing__customer:hover,\s*\.landing__customer:focus-visible \{[^}]*border-left-width: 6px/);
    expect(css).toMatch(
      /\.landing__customer:hover \.landing__cta,\s*\.landing__customer:focus-visible \.landing__cta \{[^}]*color: var\(--color-on-primary-accent\);[^}]*text-decoration: underline/
    );
    expect(css).toMatch(
      /\.landing__staff-link:hover,\s*\.landing__staff-link:focus-visible \{[^}]*border-left-color: var\(--color-amber-600\)/
    );
  });

  it("sin movimiento nuevo: ni transition ni animation en la portada (la única animación es la de la llamada)", () => {
    const css = landingCss();
    expect(css).not.toMatch(/transition|animation|@keyframes/);
  });

  it("y sin el acento 'en vivo' (cian/menta): está reservado a la llamada", () => {
    expect(landingCss()).not.toMatch(/--color-(live|on-live)/);
  });
});
