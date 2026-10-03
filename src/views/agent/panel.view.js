import { h, replaceChildren } from "../../lib/dom.js";
import { newClientMsgId } from "../../lib/ids.js";
import { waitingFor } from "../../lib/format.js";
import { staffApi as defaultStaffApi } from "../../api/staff.js";
import * as defaultSession from "../../auth/session.js";
import { createMessageStore } from "../../chat/messageStore.js";
import { renderMessageList } from "../../components/messageList.js";
import { connectionIndicator } from "../../components/connection.js";
import { connectivity as defaultConnectivity } from "../../components/connectivity.js";
import { toast } from "../../components/toast.js";
import { createRealtimeClient } from "../../realtime/socket.js";
import { navigate } from "../../router.js";
import { createAgentCallController } from "../../voice/agentCall.js";
import { profileApi as defaultProfileApi } from "../../api/profile.js";
import { avatar } from "../../components/avatar.js";
import { adminNav } from "../../components/adminNav.js";
import { createCannedPicker } from "../../components/cannedPicker.js";
import { priorityInfo } from "../../lib/priority.js";
import { createAttachPicker, localAttachment } from "../../components/attachPicker.js";
import { createAttachmentCache } from "../../components/attachmentView.js";
import { ATTACHMENT_PLACEHOLDER } from "../../lib/attachments.js";
import { createSendQueue } from "../../lib/sendQueue.js";
import { createSentimentBadge } from "../../components/sentimentBadge.js";
import { emptyState, errorState, loadingState } from "../../components/states.js";

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

// Llamadas de voz: estado (Fase 5) y "Unirse a la llamada" con WebRTC (Fase 6, voice/agentCall.js).
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
  const profileApi = deps.profileApi ?? defaultProfileApi;
  let myAvatar = null;

  let me = null;
  let tab = "queue";
  let lists = { queue: [], mine: [] };
  // "loading" hasta la primera respuesta; "error" si nunca se pudieron cargar; "ready" con datos.
  let listState = "loading";
  let listError = "";
  // Fallo al ACTUALIZAR listas que ya se veían: se siguen mostrando, con un aviso y "Reintentar".
  const listBanner = h("div", { class: "cases__banner", hidden: true });
  let selectedId = null;
  let detail = null;
  let socket = null;
  let disposed = false;
  let refreshTimer = null;
  const store = createMessageStore();
  const connection = connectionIndicator();
  const notice = deps.connectivity ?? defaultConnectivity();
  // Adjuntos (bloque C): el panel los pide con el token (no pueden ir directo en un <img>).
  const attachments = createAttachmentCache((attachment) => staffApi.attachment(selectedId, attachment.id));
  const unsent = new Map();
  // Envíos en fila: el orden del chat es el orden en que se enviaron.
  const enqueue = createSendQueue();
  // Ánimo del cliente EN VIVO (D1): se recalcula con cada mensaje que entra al almacén (REST o WebSocket).
  let sentiment = createSentimentBadge();

  // --- Estructura ---
  const tabQueue = h("button", { class: "tab", type: "button", role: "tab", on: { click: () => setTab("queue") } });
  const tabMine = h("button", { class: "tab", type: "button", role: "tab", on: { click: () => setTab("mine") } });
  const listEl = h("ul", { class: "cases", role: "listbox", "aria-label": "Casos" });
  // Cargando / error / vacío van FUERA de la lista: un listbox solo puede contener opciones (axe).
  const listStatus = h("div", { class: "cases__status", hidden: true });
  const pane = h("section", { class: "pane", "aria-label": "Conversación" });
  const availability = h(
    "select",
    { id: "availability", class: "input input--compact", on: { change: onAvailability } },
    AVAILABILITY.map(([value, label]) => h("option", { value }, label))
  );
  // Nombre + foto: enlace a "Mi perfil" (#/agente/perfil).
  const who = h("a", { class: "topbar__who", href: "#/agente/perfil", title: "Mi perfil" });
  // Enlaces de administración: solo se dibujan si la sesión es de un admin (ver boot()).
  const adminSlot = h("span", { class: "topbar__admin" });
  // La llamada en curso vive fuera del detalle: sigue visible aunque el agente mire otro caso.
  const callDock = h("div", { class: "call-dock", hidden: true });
  const agentCall = createAgentCallController({
    mount: callDock,
    staffApi,
    session,
    voice: deps.voice,
    onJoined: async () => {
      tab = "mine";
      await reloadLists();
      if (selectedId) await reloadDetail({ keepMessages: true });
    },
    onEnded: () => {
      updateDetailHeader();
      scheduleReload();
    },
    onError: (message) => toast(message, { tone: "error" }),
  });

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
          adminSlot,
          connection.el,
          h("label", { class: "sr-only", for: "availability" }, "Mi disponibilidad"),
          availability,
          who,
          h("button", { class: "link-btn", type: "button", on: { click: onLogout } }, "Salir")
        )
      ),
      callDock,
      h(
        "nav",
        { class: "sidebar", "aria-label": "Listas de casos" },
        h("div", { class: "tabs", role: "tablist" }, tabQueue, tabMine),
        listBanner,
        listStatus,
        listEl
      ),
      pane
    )
  );
  renderPlaceholder();
  store.subscribe((messages) => {
    const messagesEl = pane.querySelector(".chat__messages");
    if (messagesEl) renderMessageList(messagesEl, messages, { perspective: "agent", onRetry: retryReply, attachments });
    sentiment.update(messages);
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
    replaceChildren(adminSlot, adminNav(me));
    myAvatar = avatar(me, { loadAvatar: (id) => profileApi.avatarOf(id), size: "sm" });
    replaceChildren(who, myAvatar.el, h("span", {}, me.name), h("span", { class: "sr-only" }, " (mi perfil)"));
    availability.value = me.availability ?? "offline";
    await reloadLists();
    connectRealtime();
  }

  // --- Listas ---
  async function reloadLists() {
    // Primera carga (o reintento tras un error): esqueleto. Con listas en pantalla, se actualizan sin parpadeo.
    if (listState !== "ready") {
      listState = "loading";
      renderLists();
    }
    try {
      const [queue, mine] = await Promise.all([staffApi.queue(), staffApi.mine()]);
      if (disposed) return;
      lists = { queue: queue.items, mine: mine.items };
      listState = "ready";
      listBanner.hidden = true;
      renderLists();
    } catch (err) {
      if (disposed) return;
      if (listState === "ready") {
        // Hay listas en pantalla: se conservan (desactualizadas) y se ofrece reintentar.
        replaceChildren(listBanner, errorState(`No se pudo actualizar la lista. ${err.message}`, reloadLists));
        listBanner.hidden = false;
      } else {
        listState = "error";
        listError = err.message;
        renderLists();
      }
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
    if (listState === "loading") {
      return showListStatus(loadingState("Cargando los casos", { lines: 4 }));
    }
    if (listState === "error") {
      return showListStatus(errorState(`No se pudieron cargar los casos. ${listError}`, reloadLists));
    }
    const items = lists[tab];
    if (!items.length) {
      showListStatus(
        h(
          "div",
          { class: "cases__empty" },
          tab === "queue"
            ? emptyState(
                "No hay clientes esperando.",
                "Cuando la IA escale un caso o un cliente pida un asesor, aparecerá aquí al instante, el más urgente primero."
              )
            : emptyState(
                "No tienes casos abiertos.",
                "Toma uno de la cola para atenderlo.",
                h("button", { class: "btn", type: "button", on: { click: () => setTab("queue") } }, "Ver la cola")
              )
        )
      );
      return;
    }
    listStatus.hidden = true;
    replaceChildren(listStatus);
    listEl.hidden = false;
    replaceChildren(listEl, items.map(renderCase));
  }

  function showListStatus(content) {
    replaceChildren(listEl);
    listEl.hidden = true;
    replaceChildren(listStatus, content);
    listStatus.hidden = false;
  }

  function renderCase(item) {
    const priority = priorityInfo(item.priority);
    const urgency = priority.level;
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
      // Prioridad legible JUNTO al número ("Urgente · 90"): el color de la regla nunca va solo.
      h("span", { class: ["prio", `prio--${priority.level}`] }, priority.text),
      item.openEscalation
        ? h("span", { class: "case__reason" }, REASON[item.openEscalation.reason] ?? item.openEscalation.reason)
        : null,
      h("span", { class: "case__preview" }, item.lastMessage?.preview ?? item.subject ?? "")
    );
  }

  // --- Detalle ---
  async function select(id) {
    selectedId = id;
    detail = null;
    store.clear();
    renderLists();
    replaceChildren(pane, h("div", { class: "pane__loading" }, loadingState("Cargando el caso", { lines: 5 })));
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
      } else if (!detail || detail.id !== id) {
        // No hay nada del caso en pantalla: el error ocupa el panel, con "Reintentar".
        replaceChildren(
          pane,
          h(
            "div",
            { class: "pane__empty" },
            errorState(`No se pudo abrir el caso. ${err.message}`, () => select(id))
          )
        );
      } else toast(err.message, { tone: "error" }); // actualización en segundo plano: el caso sigue visible
    }
  }

  function renderPlaceholder(
    text = "Elige un caso de la cola para ver su historial completo (también antes de tomarlo)."
  ) {
    replaceChildren(pane, h("div", { class: "pane__empty" }, emptyState(text, "")));
  }

  function renderDetail() {
    sentiment = createSentimentBadge(); // un caso nuevo empieza sin ánimo conocido
    sentiment.update(store.list());
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
                `${REASON[escalation.reason] ?? escalation.reason} · prioridad ${priorityInfo(escalation.priority).text}`
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
            : null,
          // El mismo nodo en cada redibujo del encabezado: no se re-anuncia si no cambió.
          sentiment.el
        )
      ),
      h(
        "div",
        { class: "pane__actions" },
        canJoinCall(detail, mine)
          ? h(
              "button",
              {
                class: "btn btn--primary btn--call",
                type: "button",
                on: { click: () => agentCall.join(activeCall(detail).id, detail.id) },
              },
              "Unirse a la llamada"
            )
          : null,
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

  /** Hay llamada activa, no estoy ya en una, y el caso está en cola o es mío. */
  function canJoinCall(conversation, mine) {
    if (!activeCall(conversation) || agentCall.activeCallId) return false;
    return (
      (conversation.status === "waiting_agent" && !conversation.assignedAgent) ||
      (conversation.status === "agent_active" && mine)
    );
  }

  function replyForm() {
    const input = h("textarea", {
      id: "reply-input",
      class: "chat__input",
      rows: 2,
      maxlength: 4000,
      placeholder: "Responde al cliente…",
    });
    // Inserta (NO envía): el asesor revisa el texto y lo manda él.
    const canned = createCannedPicker({
      load: () => staffApi.cannedResponses(),
      input,
      context: () => ({ customerName: detail?.customer?.displayName, agentName: me?.name }),
    });
    const attach = createAttachPicker({ prepare: deps.prepareAttachment, id: "reply-attach" });
    const form = h(
      "form",
      {
        class: "chat__composer",
        on: {
          submit: (event) => {
            event.preventDefault();
            const content = input.value.trim();
            const file = attach.pending;
            if (!content && !file) return;
            input.value = "";
            const clientMsgId = newClientMsgId();
            if (file) {
              attach.take();
              unsent.set(clientMsgId, file);
            }
            store.addPending({
              clientMsgId,
              content: content || ATTACHMENT_PLACEHOLDER,
              sender: "agent",
              attachment: file ? localAttachment(file) : null,
            });
            enqueue(() => sendReply(clientMsgId, content));
          },
        },
      },
      attach.preview,
      h("label", { class: "sr-only", for: "reply-input" }, "Respuesta"),
      input,
      h(
        "div",
        { class: "chat__composer-actions" },
        canned.el,
        attach.input,
        attach.button,
        h("button", { class: "btn btn--primary", type: "submit" }, "Enviar")
      ),
      attach.error
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
    const file = unsent.get(clientMsgId);
    try {
      const message = file
        ? await staffApi.sendAttachment(selectedId, file, { caption: content, clientMsgId })
        : await staffApi.reply(selectedId, content, clientMsgId);
      unsent.delete(clientMsgId);
      store.upsert(toView(message));
    } catch (err) {
      store.markFailed(clientMsgId, err.message);
    }
  }

  function retryReply(message) {
    store.markPending(message.clientMsgId);
    enqueue(() => sendReply(message.clientMsgId, message.content === ATTACHMENT_PLACEHOLDER ? "" : message.content));
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
    agentCall.dispose();
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
      attachment: message.attachment ?? message.attachments?.[0] ?? null,
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
      onStatus: (next) => {
        connection.set(next);
        // Aviso de conectividad de la pestaña (uno solo, compartido por las vistas).
        notice.socketStatus("panel", next);
      },
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
    notice.socketStatus("panel", "closed");
    agentCall.dispose();
    clearTimeout(refreshTimer);
    stopSessionWatch();
    socket?.stop();
    myAvatar?.dispose();
    attachments.dispose();
  };
}
