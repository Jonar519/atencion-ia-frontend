/**
 * Registra el Service Worker SOLO en el build de producción. En desarrollo lo
 * desregistra si quedó uno: con Vite sirviendo archivos que cambian a cada
 * rato, un SW cacheando el shell mostraría código viejo (lección del Proyecto 1).
 */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD) {
    navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((r) => r.unregister()));
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((err) => {
      console.error("No se pudo registrar el Service Worker:", err);
    });
  });
}
