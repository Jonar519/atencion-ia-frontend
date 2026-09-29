import { describe, expect, it, vi } from "vitest";
import { classifyUrgency } from "../src/urgency/classify.js";
import { createUrgencyClient } from "../src/urgency/urgencyClient.js";

describe("clasificación local de urgencia", () => {
  it.each([
    ["Me aparece un cobro que yo no hice", "urgente", "posible_fraude"],
    ["me robaron la tarjeta", "urgente", "posible_fraude"],
    ["Quiero hablar con un asesor", "urgente", "pide_asesor"],
    ["esto es inaceptable", "atencion", "cliente_molesto"],
    ["NECESITO AYUDA YA!!", "atencion", "cliente_molesto"],
    ["¿A qué hora abren el sábado?", "normal", null],
    ["ok", "normal", null],
  ])("%s → %s", (text, level, reason) => {
    expect(classifyUrgency(text)).toMatchObject({ level, reason });
  });

  it("ignora tildes y mayúsculas", () => {
    expect(classifyUrgency("NO RECONOZCO esta compra").level).toBe("urgente");
    expect(classifyUrgency("clonaron mi tarjeta, está clonada").reason).toBe("posible_fraude");
  });
});

/** Worker simulado: responde de forma asíncrona, como uno real. */
function fakeWorker() {
  const listeners = [];
  const worker = {
    posted: [],
    addEventListener: (_type, handler) => listeners.push(handler),
    postMessage(data) {
      worker.posted.push(data);
      setTimeout(() => listeners.forEach((l) => l({ data: { id: data.id, result: classifyUrgency(data.text) } })), 5);
    },
    terminate: vi.fn(),
  };
  return worker;
}

describe("cliente del Web Worker", () => {
  it("clasifica en el Worker (fuera del hilo principal)", async () => {
    const worker = fakeWorker();
    const client = createUrgencyClient({ createWorker: () => worker });
    expect(client.usesWorker).toBe(true);
    expect(await client.classify("me robaron")).toMatchObject({ level: "urgente" });
    expect(worker.posted).toHaveLength(1);
  });

  it("si el cliente sigue escribiendo, las respuestas viejas se descartan (solo vale la última)", async () => {
    const client = createUrgencyClient({ createWorker: fakeWorker });
    const old = client.classify("hola");
    const latest = client.classify("me robaron la tarjeta");
    expect(await old).toBeNull();
    expect(await latest).toMatchObject({ level: "urgente" });
  });

  it("sin soporte de Workers, clasifica en el hilo principal con la misma función", async () => {
    const client = createUrgencyClient({ createWorker: () => null });
    expect(client.usesWorker).toBe(false);
    expect(await client.classify("quiero un asesor")).toMatchObject({ reason: "pide_asesor" });
  });

  it("si crear el Worker falla, no rompe el chat", async () => {
    const client = createUrgencyClient({
      createWorker: () => {
        throw new Error("CSP");
      },
    });
    expect(await client.classify("fraude")).toMatchObject({ level: "urgente" });
  });

  it("el worker real usa la misma clasificación (protocolo { id, text } → { id, result })", async () => {
    const posted = [];
    const listeners = [];
    vi.stubGlobal("self", { addEventListener: (_t, h) => listeners.push(h), postMessage: (m) => posted.push(m) });
    await import("../src/workers/urgency.worker.js");
    listeners[0]({ data: { id: 7, text: "no reconozco este cargo" } });
    expect(posted[0]).toEqual({ id: 7, result: classifyUrgency("no reconozco este cargo") });
    vi.unstubAllGlobals();
  });
});
