import { h } from "../lib/dom.js";

/**
 * Aviso de CONECTIVIDAD (Fase 7, D2): UN solo aviso que se actualiza (nunca
 * una pila de toasts), para dos causas distintas:
 *  - el navegador perdió internet (eventos online/offline);
 *  - el WebSocket en tiempo real se está reconectando con el servidor.
 * Prioridad: sin internet > reconectando. Al volver, "Conexión restablecida"
 * unos segundos y desaparece. Sin animación (la única del sistema es la de la
 * llamada). role="status": los lectores de pantalla lo anuncian sin interrumpir.
 * Va ARRIBA: abajo tapaba el campo donde se está escribiendo (prueba en vivo).
 *
 * Por qué hace falta además del punto "En línea" del encabezado: ese punto
 * se ve solo si se está mirando arriba; un corte mientras se escribe debe
 * avisarse donde se mira, y decir qué pasa con lo que se escribe.
 */
export const RESTORED_VISIBLE_MS = 3_000;
// Un "reconectando" breve (p. ej. el servidor se reinicia) no merece aviso: solo si dura.
export const RECONNECT_NOTICE_DELAY_MS = 2_000;

const TEXT = {
  // Honesto: un envío sin conexión NO sale solo al volver; queda marcado con "Reintentar".
  offline: "Sin conexión a internet. Si un mensaje no sale, queda marcado y podrás reintentarlo al volver la conexión.",
  reconnecting: "Reconectando con el servidor… tus mensajes no se pierden.",
  restored: "Conexión restablecida.",
};

export function createConnectivityNotice({ doc = globalThis.document, win = globalThis.window } = {}) {
  const el = h("div", { class: "connectivity", role: "status", hidden: true });
  let offline = win?.navigator?.onLine === false;
  const reconnecting = new Set(); // varias vistas pueden reportar su socket
  let wasDown = false;
  let restoredTimer = null;
  let reconnectTimer = null;

  function render(state) {
    clearTimeout(restoredTimer);
    if (!state) {
      el.hidden = true;
      el.dataset.state = "";
      return;
    }
    el.dataset.state = state;
    el.className = `connectivity connectivity--${state}`;
    if (el.textContent !== TEXT[state]) el.textContent = TEXT[state];
    el.hidden = false;
    if (state === "restored") restoredTimer = setTimeout(() => render(null), RESTORED_VISIBLE_MS);
  }

  function update() {
    if (offline) {
      wasDown = true;
      return render("offline");
    }
    if (reconnecting.size && !reconnectTimer && el.dataset.state !== "reconnecting") {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!offline && reconnecting.size) {
          wasDown = true;
          render("reconnecting");
        }
      }, RECONNECT_NOTICE_DELAY_MS);
      return;
    }
    if (reconnecting.size) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (wasDown) {
      wasDown = false;
      render("restored");
    } else if (el.dataset.state !== "restored") {
      render(null);
    }
  }

  const onOffline = () => {
    offline = true;
    update();
  };
  const onOnline = () => {
    offline = false;
    update();
  };
  win?.addEventListener?.("offline", onOffline);
  win?.addEventListener?.("online", onOnline);

  return {
    el,
    mount() {
      if (!el.isConnected) doc?.body?.append(el);
      update();
      return this;
    },
    /** Estado del WebSocket de una vista (source = un nombre por vista: "chat", "panel"). */
    socketStatus(source, status) {
      if (status === "reconnecting") reconnecting.add(source);
      else reconnecting.delete(source); // open, connecting o closed (la vista se fue)
      update();
    },
    get state() {
      return el.dataset.state || null;
    },
    dispose() {
      win?.removeEventListener?.("offline", onOffline);
      win?.removeEventListener?.("online", onOnline);
      clearTimeout(restoredTimer);
      clearTimeout(reconnectTimer);
      el.remove();
    },
  };
}

/** El aviso de la aplicación (uno por pestaña). */
let shared = null;
export function connectivity() {
  shared ??= createConnectivityNotice().mount();
  return shared;
}

/** Solo tests. */
export function _resetConnectivity() {
  shared?.dispose();
  shared = null;
}
