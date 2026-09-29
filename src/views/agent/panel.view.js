import { h, replaceChildren } from "../../lib/dom.js";
import { newClientMsgId } from "../../lib/ids.js";
import { waitingFor } from "../../lib/format.js";
import { staffApi as defaultStaffApi } from "../../api/staff.js";
import * as defaultSession from "../../auth/session.js";
import { createMessageStore } from "../../chat/messageStore.js";
import { renderMessageList } from "../../components/messageList.js";
import { connectionIndicator } from "../../components/connection.js";
import { toast } from "../../components/toast.js";
import { createRealtimeClient } from "../../realtime/socket.js";
import { navigate } from "../../router.js";

/**
 * PANEL DE AGENTES (#/agente).
 *
 *  - Izquierda: "Cola" (en espera de asesor, la más urgente primero: la API
 *    ordena por prioridad y antigüedad) y "Mis casos".
 *  - Derecha: la conversación elegida con TODO su historial (también antes de
 *    tomarla), el análisis de la IA de cada turno del cliente y el motivo del
 *    escalamiento. Tomar / Cerrar / Responder según el estado.
 *  - Tiempo real: mensajes nuevos, casos que entran o salen de la cola, avisos
 *    de escalamiento. Tras una reconexión se recarga todo (no se pierde nada).
 *
 * La autorización la hace el backend: si otro asesor toma un caso que estás
 * mirando, dejas de recibir sus mensajes y el panel te lo avisa.
 */

const REASON = {
  possible_fraud: "Posible fraude",
  angry_customer: "Cliente molesto",
  complaint: "Reclamo",
  low_confidence: "La IA no pudo resolver",
  human_requested: "Pidió un asesor",
  repeated_failure: "Problema repetido",
  voice_call: "Llamada de voz",
};

const STATUS = {
  ai_active: "Con la IA",
  waiting_agent: "En espera de asesor",
  agent_active: "En atención",
  closed: "Cerrada",
};

// Llamadas de voz (Fase 5). El botón "unirse" llega con la UI de voz (Fase 6).
const CALL_STATUS = {
  connecting: "Llamada: conectando",
  in_progress: "Llamada en curso",
  waiting_agent: "Llamada en espera de asesor",
};
const ACTIVE_CALL = Object.keys(CALL_STATUS);

function activeCall(conversation) {
  return conversation.calls?.find((call) => ACTIVE_CALL.includes(call.status)) ?? null;
}

const AVAILABILITY = [
  ["available", "Disponible"],
  ["busy", "Ocupado"],
  ["away", "Ausente"],
  ["offline", "Desconectado"],
];

const REFRESH_DEBOUNCE_MS = 250;

export function agentPanelView(root, _params, deps = {}) {
  const staffApi = deps.staffApi ?? defaultStaffApi;
  const session = deps.session ?? defaultSession;
  const makeSocket = deps.createRealtimeClient ?? createRealtimeClient;

  let me = null;
  let tab = "queue";
  let lists = { queue: [], mine: [] };
  let selectedId = null;
  let detail = null;
  let socket = null;
  let disposed = false;
  let refreshTimer = null;
  const store = createMessageStore();
  const connection = connectionIndicator();

  // --- Estructura ---
  const tabQueue = h("button", { class: "tab", type: "button", role: "tab", on: { click: () => setTab("queue") } });
  const tabMine = h("button", { class: "tab", type: "button", role: "tab", on: { click: () => setTab("mine") } });
  const listEl = h("ul", { class: "cases", role: "listbox", "aria-label": "Casos" });
  const pane = h("section", { class: "pane", "aria-label": "Conversación" });
  const availability = h(
    "select",
    { id: "availability", class: "input input--compact", on: { change: onAvailability } },
    AVAILABILITY.map(([value, label]) => h("option", { value }, label))
  );
  const who = h("span", { class: "topbar__who" });

  replaceChildren(
    root,
    h(
      "div",
      { class: "panel" },
      h(
        "header",
        { class: "topbar" },
        h("h1", { class: "topbar__title" }, "Panel de asesores"),
        h(
          "div",
          { class: "topbar__actions" },
          connection.el,
          h("label", { class: "sr-only", for: "availability" }, "Mi disponibilidad"),
          availability,
          who,
          h("button", { class: "link-btn", type: "button", on: { click: onLogout } }, "Salir")
        )
      ),
      h(
        "nav",
        { class: "sidebar", "aria-label": "Listas de casos" },
        h("div", { class: "tabs", role: "tablist" }, tabQueue, tabMine),
        listEl
      ),
      pane
    )
  );
  renderPlaceholder();
  store.subscribe((messages) => {
    const messagesEl = pane.querySelector(".chat__messages");
    if (messagesEl) renderMessageList(messagesEl, messages, { perspective: "agent", onRetry: retryReply });
  });

  const stopSessionWatch = session.onSessionChange(({ staff, reason }) => {
    if (!staff && reason !== "refreshed") {
      socket?.stop();
      navigate("/agente/login");
      return;
    }
    // La cookie de refresh es una por navegador: si en otra pestaña inició sesión
    // OTRA cuenta, la próxima renovación trae esa cuenta. El backend ya aplica sus
    // permisos, pero la pantalla seguiría mostrando al usuario anterior: se recarga.
    if (staff && me && staff.id !== me.id) {
      socket?.stop();
      (deps.reload ?? (() => window.location.reload()))();
    }
  });

  boot();

  async function boot() {
    me = session.getStaff() ?? (await session.restore());
    if (!me) return navigate("/agente/login");
    who.textContent = me.name;
    availability.value = me.availability ?? "offline";
    await reloadLists();
    connectRealtime();
  }

  // --- Listas ---
  async function reloadLists() {
    try {
      const [queue, mine] = await Promise.all([staffApi.queue(), staffApi.mine()]);
      if (disposed) return;
      lists = { queue: queue.items, mine: mine.items };
      renderLists();
    } catch (err) {
      toast(err.message, { tone: "error" });
    }
  }

  function scheduleReload() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      reloadLists();
      if (selectedId) reloadDetail({ keepMessages: true });
    }, REFRESH_DEBOUNCE_MS);
  }

  function setTab(next) {
    tab = next;
    renderLists();
  }

  function renderLists() {
    tabQueue.textContent = `Cola (${lists.queue.length})`;
    tabMine.textContent = `Mis casos (${lists.mine.length})`;
    tabQueue.setAttribute("aria-selected", String(tab === "queue"));
    tabMine.setAttribute("aria-selected", String(tab === "mine"));
    const items = lists[tab];
    if (!items.length) {
      replaceChildren(
        listEl,
        h("li", { class: "cases__empty" }, tab === "queue" ? "No hay clientes esperando." : "No tienes casos abiertos.")
      );
      return;
    }
    replaceChildren(listEl, items.map(renderCase));
  }

  function renderCase(item) {
    const urgency = item.priority >= 80 ? "high" : item.priority >= 50 ? "mid" : "low";
    return h(
      "li",
      {
        class: ["case", `case--${urgency}`, item.id === selectedId && "case--selected"],
        role: "option",
        tabindex: 0,
        "aria-selected": String(item.id === selectedId),
        dataset: { id: item.id },
        on: {
          click: () => select(item.id),
          keydown: (event) => (event.key === "Enter" || event.key === " ") && (event.preventDefault(), select(item.id)),
        },
      },
      h("span", { class: "case__who" }, item.customer?.displayName || "Cliente anónimo"),
      h("span", { class: "case__when" }, waitingFor(item.lastMessageAt)),
      item.openEscalation
        ? h("span", { class: "case__reason" }, REASON[item.openEscalation.reason] ?? item.openEscalation.reason)
        : null,
      h("span", { class: "case__preview" }, item.lastMessage?.preview ?? item.subject ?? "")
    );
  }

  // --- Detalle ---
  async function select(id) {
    selectedId = id;
    store.clear();
    renderLists();
    await reloadDetail({ keepMessages: false });
  }

  async function reloadDetail({ keepMessages }) {
    const id = selectedId;
    try {
      const [conversation, messages] = await Promise.all([staffApi.conversation(id), staffApi.messages(id)]);
      if (disposed || id !== selectedId) return;
      const firstRender = !detail || detail.id !== id || !keepMessages;
      detail = conversation;
      if (firstRender) renderDetail();
      else updateDetailHeader();
      store.upsert(messages.items.map(toView));
    } catch (err) {
      if (id !== selectedId) return;
      if (err.status === 404) {
        // Ya no está a tu alcance (p. ej. otro asesor la tomó mientras la mirabas).
        detail = null;
        renderPlaceholder("Este caso ya no está disponible: otro asesor lo tomó o se cerró.");
      } else toast(err.message, { tone: "error" });
    }
  }

  function renderPlaceholder(text = "Elige un caso de la cola para ver su historial.") {
    replaceChildren(pane, h("div", { class: "pane__empty" }, h("p", {}, text)));
  }

  function renderDetail() {
    const messagesEl = h("ol", { class: "chat__messages", "aria-live": "polite", "aria-label": "Historial" });
    // Transcripción EN VIVO de una llamada (lo que el STT va entendiendo antes de cerrar la frase).
    const live = h("p", { class: "live-transcript", hidden: true, "aria-live": "polite" });
    replaceChildren(
      pane,
      h("header", { class: "pane__header" }),
      messagesEl,
      live,
      h("div", { class: "pane__footer" })
    );
    updateDetailHeader();
  }

  function updateDetailHeader() {
    if (!detail) return;
    const escalation = detail.escalations?.find((e) => e.status === "open" || e.status === "assigned");
    const mine = detail.assignedAgent?.id === me.id;
    const header = pane.querySelector(".pane__header");
    const footer = pane.querySelector(".pane__footer");

    replaceChildren(
      header,
      h(
        "div",
        {},
        h("h2", { class: "pane__title" }, detail.customer?.displayName || "Cliente anónimo"),
        h(
          "p",
          { class: "pane__meta" },
          h("span", { class: ["pill", `pill--${detail.status}`] }, STATUS[detail.status] ?? detail.status),
          escalation
            ? h(
                "span",
                { class: "pill pill--reason" },
                `${REASON[escalation.reason] ?? escalation.reason} · prioridad ${escalation.priority}`
              )
            : null,
          activeCall(detail)
            ? h(
                "span",
                { class: ["pill", "pill--call", `pill--call-${activeCall(detail).status}`] },
                CALL_STATUS[activeCall(detail).status] ?? activeCall(detail).status
              )
            : null,
          detail.assignedAgent
            ? h("span", { class: "muted" }, mine ? "Lo atiendes tú" : `Lo atiende ${detail.assignedAgent.name}`)
            : null
        )
      ),
      h(
        "div",
        { class: "pane__actions" },
        detail.status === "waiting_agent" && !detail.assignedAgent
          ? h("button", { class: "btn btn--primary", type: "button", on: { click: onTake } }, "Tomar caso")
          : null,
        detail.status === "agent_active" && mine
          ? h("button", { class: "btn", type: "button", on: { click: onClose } }, "Cerrar caso")
          : null
      )
    );

    if (detail.status === "agent_active" && mine) {
      if (!footer.querySelector("form")) replaceChildren(footer, replyForm());
    } else {
      replaceChildren(
        footer,
        h("p", { class: "muted" }, detail.status === "waiting_agent" ? "Toma el caso para responder al cliente." : "")
      );
    }
  }

  function replyForm() {
    const input = h("textarea", {
      id: "reply-input",
      class: "chat__input",
      rows: 2,
      maxlength: 4000,
      placeholder: "Responde al cliente…",
    });
    const form = h(
      "form",
      {
        class: "chat__composer",
        on: {
          submit: (event) => {
            event.preventDefault();
            const content = input.value.trim();
            if (!content) return;
            input.value = "";
            const clientMsgId = newClientMsgId();
            store.addPending({ clientMsgId, content, sender: "agent" });
            sendReply(clientMsgId, content);
          },
        },
      },
      h("label", { class: "sr-only", for: "reply-input" }, "Respuesta"),
      input,
      h("button", { class: "btn btn--primary", type: "submit" }, "Enviar")
    );
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    return form;
  }

  async function sendReply(clientMsgId, content) {
    try {
      const message = await staffApi.reply(selectedId, content, clientMsgId);
      store.upsert(toView(message));
    } catch (err) {
      store.markFailed(clientMsgId, err.message);
    }
  }

  function retryReply(message) {
    store.markPending(message.clientMsgId);
    sendReply(message.clientMsgId, message.content);
  }

  async function onTake() {
    try {
      await staffApi.take(selectedId);
      tab = "mine";
      await reloadLists();
      await reloadDetail({ keepMessages: true });
    } catch (err) {
      toast(err.message, { tone: "error" });
      scheduleReload();
    }
  }

  async function onClose() {
    try {
      await staffApi.close(selectedId);
      await reloadLists();
      await reloadDetail({ keepMessages: true });
    } catch (err) {
      toast(err.message, { tone: "error" });
    }
  }

  async function onAvailability() {
    try {
      me = { ...me, ...(await staffApi.setAvailability(availability.value)) };
    } catch (err) {
      toast(err.message, { tone: "error" });
      availability.value = me.availability;
    }
  }

  async function onLogout() {
    socket?.stop();
    await session.logout();
  }

  function toView(message) {
    return {
      id: message.id,
      senderType: message.senderType,
      content: message.content,
      createdAt: message.createdAt,
      clientMsgId: message.clientMsgId ?? null,
      channel: message.channel ?? "text",
      agent: message.agent ?? message.senderAgent ?? null,
      intent: message.intent ?? null,
      sentiment: message.sentiment ?? null,
    };
  }

  // --- Tiempo real ---
  function connectRealtime() {
    socket = makeSocket({
      authMessage: async () => {
        const token = session.getAccessToken() ?? (await session.refresh());
        return token ? { type: "auth", accessToken: token } : null;
      },
      onEvent,
      onStatus: (next) => connection.set(next),
      onResync: () => scheduleReload(),
      // Token vencido (4409): se renueva antes de reconectar.
      onAuthExpired: () => session.refresh(),
    });
    socket.start();
  }

  function showLiveTranscript(speaker, text) {
    const live = pane.querySelector(".live-transcript");
    if (!live) return;
    if (!text) {
      live.hidden = true;
      replaceChildren(live);
      return;
    }
    live.hidden = false;
    replaceChildren(
      live,
      h("span", { class: "live-transcript__who" }, speaker === "agent" ? "Tú (en vivo)" : "Cliente (en vivo)"),
      " ",
      text
    );
  }

  function onEvent(event) {
    if (event.type === "message.created") {
      if (event.conversation.id === selectedId) {
        store.upsert(toView(event.message));
        // La frase terminó: pasa de "en vivo" al historial.
        if (event.message.channel === "voice") showLiveTranscript(null, "");
      }
      scheduleReload();
    } else if (event.type === "call.transcript.partial") {
      if (event.conversation.id === selectedId) showLiveTranscript(event.speaker, event.text);
    } else if (event.type === "call.updated") {
      if (event.conversation.id === selectedId && detail) {
        detail = {
          ...detail,
          calls: [event.call, ...(detail.calls ?? []).filter((call) => call.id !== event.call.id)],
        };
        updateDetailHeader();
        if (!ACTIVE_CALL.includes(event.call.status)) showLiveTranscript(null, "");
      }
      scheduleReload();
    } else if (event.type === "conversation.updated") {
      if (event.conversation.id === selectedId && event.visible === false) {
        detail = null;
        renderPlaceholder("Otro asesor tomó este caso.");
        selectedId = null;
      }
      scheduleReload();
    } else if (event.type === "escalation.created") {
      const suggested = event.suggestedAgentId === me?.id;
      toast(`Nuevo caso en la cola: ${REASON[event.reason] ?? event.reason}${suggested ? " (sugerido para ti)" : ""}`, {
        tone: event.priority >= 80 ? "danger" : "info",
      });
      scheduleReload();
    }
  }

  return () => {
    disposed = true;
    clearTimeout(refreshTimer);
    stopSessionWatch();
    socket?.stop();
  };
}
