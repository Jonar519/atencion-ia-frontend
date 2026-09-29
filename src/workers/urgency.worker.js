import { classifyUrgency } from "../urgency/classify.js";

/**
 * Web Worker de urgencia: clasifica el borrador del cliente FUERA del hilo
 * principal, así escribir nunca se traba aunque el texto sea largo.
 * Protocolo: { id, text } → { id, result }.
 */
self.addEventListener("message", (event) => {
  const { id, text } = event.data ?? {};
  self.postMessage({ id, result: classifyUrgency(String(text ?? "")) });
});
