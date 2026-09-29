import { classifyUrgency } from "./classify.js";

/**
 * Cliente del Web Worker de urgencia.
 *  - Envía cada borrador con un id creciente y SOLO entrega la respuesta del
 *    último: si el cliente sigue escribiendo, las respuestas viejas se ignoran.
 *  - Si el navegador no soporta Workers (o falla al crearlo), clasifica en el
 *    hilo principal: la función es la misma y es barata.
 *
 * @param {{ createWorker?: () => Worker | null }} [options]
 */
export function createUrgencyClient({ createWorker = defaultWorker } = {}) {
  let worker = null;
  try {
    worker = createWorker();
  } catch {
    worker = null;
  }
  let lastId = 0;
  const pending = new Map();

  worker?.addEventListener("message", (event) => {
    const { id, result } = event.data ?? {};
    const resolve = pending.get(id);
    pending.delete(id);
    if (resolve && id === lastId) resolve(result);
    else resolve?.(null); // respuesta vieja: se descarta
  });

  return {
    usesWorker: Boolean(worker),
    /** Resuelve con el resultado, o con null si mientras tanto llegó un texto más nuevo. */
    classify(text) {
      const id = ++lastId;
      if (!worker) return Promise.resolve(classifyUrgency(text));
      return new Promise((resolve) => {
        pending.set(id, resolve);
        worker.postMessage({ id, text });
      });
    },
    terminate() {
      worker?.terminate();
      pending.clear();
    },
  };
}

function defaultWorker() {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("../workers/urgency.worker.js", import.meta.url), { type: "module" });
}
