import { h, replaceChildren } from "../../lib/dom.js";
import { newClientMsgId } from "../../lib/ids.js";
import { widgetApi as defaultWidgetApi } from "../../api/widget.js";
import { createMessageStore } from "../../chat/messageStore.js";
import { renderMessageList } from "../../components/messageList.js";
import { connectionIndicator } from "../../components/connection.js";
import { createRealtimeClient } from "../../realtime/socket.js";
import { createUrgencyClient } from "../../urgency/urgencyClient.js";

/**
 * WIDGET DEL CLIENTE (#/chat).
 *
 * Flujo: ¿hay sesión (cookie httpOnly)? → si no, "Iniciar chat" → conversación
 * abierta más reciente (o una nueva) → historial → WebSocket.
 *
 * Enviar: el mensaje aparece al instante ("Enviando…") con un clientMsgId; la
 * respuesta del POST lo confirma y trae la respuesta de la IA; el WebSocket
 * también los trae (y los de un asesor): el almacén descarta duplicados.
 * Si falla, "Reintentar" reusa el MISMO clientMsgId (el backend no lo duplica).
 *
 * Todas las dependencias se inyectan para poder probar la vista completa con
 * red y WebSocket simulados (tests/customerChat.test.js).
 */

const STATUS_TEXT = {
  ai_active: "Te atiende el asistente virtual",
  waiting_agent: "Te estamos comunicando con un asesor…",
  agent_active: "Te atiende un asesor de Banco Cordillera",
  closed: "La conversación terminó",
};

const URGENCY_DEBOUNCE_MS = 250;

export function customerChatView(root, _params, deps = {}) {
  const widgetApi = deps.widgetApi ?? defaultWidgetApi;
  const makeSocket = deps.createRealtimeClient ?? createRealtimeClient;
  const urgency = deps.urgencyClient ?? createUrgencyClient();
  const store = createMessageStore();
  const connection = connectionIndicator();

  let conversationId = null;
  let status = "ai_active";
  let socket = null;
  let disposed = false;
  let urgencyTimer = null;

  // --- Estructura ---
  const statusLine = h("p", { class: "chat__status", role: "status" }, "");
  const list = h("ol", { class: "chat__messages", "aria-live": "polite", "aria-label": "Mensajes de la conversación" });
  const textarea = h("textarea", {
    id: "chat-input",
    class: "chat__input",
    rows: 2,
    maxlength: 2000,
    placeholder: "Escribe tu mensaje…",
    "aria-describedby": "chat-urgency",
  });
  const sendButton = h("button", { class: "btn btn--primary", type: "submit" }, "Enviar");
  const urgencyHint = h("p", { id: "chat-urgency", class: "urgency", "aria-live": "polite", hidden: true });
  const errorLine = h("p", { class: "form-error", role: "alert", hidden: true });
  const composer = h(
    "form",
    { class: "chat__composer", on: { submit: onSubmit } },
    h("label", { class: "sr-only", for: "chat-input" }, "Tu mensaje"),
    textarea,
    sendButton,
    urgencyHint,
    errorLine
  );
  const newChatButton = h(
    "button",
    { class: "btn", type: "button", hidden: true, on: { click: startNewConversation } },
    "Nueva conversación"
  );
  const endButton = h("button", { class: "link-btn", type: "button", on: { click: endSession } }, "Salir");

  const shell = h(
    "section",
    { class: "chat" },
    h(
      "header",
      { class: "chat__header" },
      h(
        "div",
        {},
        h("h1", { class: "chat__title" }, "Banco Cordillera"),
        h("p", { class: "chat__subtitle" }, "Atención al cliente")
      ),
      h("div", { class: "chat__header-actions" }, connection.el, endButton)
    ),
    statusLine,
    list,
    newChatButton,
    composer
  );

  store.subscribe((messages) => renderMessageList(list, messages, { perspective: "customer", onRetry: retry }));
  textarea.addEventListener("input", onDraft);
  textarea.addEventListener("keydown", (event) => {
    // Enter envía; Shift+Enter hace salto de línea.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });

  replaceChildren(root, h("main", { class: "page page--chat" }, shell));
  boot();

  // --- Arranque ---
  async function boot() {
    try {
      await widgetApi.currentSession();
    } catch (err) {
      if (err.status === 401) return showStart();
      return showFatal(err);
    }
    await openLatestConversation();
  }

  function showStart() {
    const name = h("input", { id: "start-name", class: "input", maxlength: 60, autocomplete: "given-name" });
    const form = h(
      "form",
      {
        class: "start",
        on: {
          submit: async (event) => {
            event.preventDefault();
            try {
              await widgetApi.startSession(name.value.trim() || undefined);
              form.remove();
              shell.hidden = false;
              await openLatestConversation();
            } catch (err) {
              showError(err.message);
            }
          },
        },
      },
      h("h1", {}, "¿En qué te podemos ayudar?"),
      h(
        "p",
        { class: "muted" },
        "Te responde nuestro asistente virtual y, si lo necesitas, un asesor de Banco Cordillera."
      ),
      h("label", { for: "start-name" }, "Tu nombre (opcional)"),
      name,
      h("button", { class: "btn btn--primary", type: "submit" }, "Iniciar chat"),
      h(
        "p",
        { class: "fineprint" },
        "Nunca te pediremos tu clave, el código de seguridad de tu tarjeta ni códigos que te lleguen por mensaje."
      )
    );
    shell.hidden = true;
    root.querySelector("main").append(form);
  }

  async function openLatestConversation() {
    const { items } = await widgetApi.conversations();
    const open = items.find((conversation) => conversation.status !== "closed");
    const conversation = open ?? (await widgetApi.newConversation());
    conversationId = conversation.id;
    setStatus(conversation.status);
    await loadMessages();
    connectRealtime();
    textarea.focus();
  }

  async function loadMessages() {
    const { items } = await widgetApi.messages(conversationId);
    store.upsert(items);
  }

  function connectRealtime() {
    socket?.stop();
    socket = makeSocket({
      // La cookie httpOnly del widget viaja sola en el upgrade: el mensaje de auth va sin token.
      authMessage: async () => ({ type: "auth" }),
      onEvent,
      onStatus: (next) => connection.set(next),
      // Tras una reconexión, se recupera lo que llegó mientras el socket estuvo caído.
      onResync: () => loadMessages().catch(() => {}),
    });
    socket.start();
  }

  function onEvent(event) {
    if (event.conversation?.id !== conversationId) return;
    if (event.type === "message.created") store.upsert(toView(event.message));
    if (event.type === "conversation.updated") setStatus(event.conversation.status);
  }

  /** El evento del socket y la API REST usan formas un poco distintas: se unifican. */
  function toView(message) {
    return {
      id: message.id,
      sender: message.senderType ?? message.sender,
      content: message.content,
      createdAt: message.createdAt,
      clientMsgId: message.clientMsgId ?? null,
      agentName: message.agent?.name ?? message.agentName ?? null,
    };
  }

  function setStatus(next) {
    status = next;
    statusLine.textContent = STATUS_TEXT[status] ?? "";
    statusLine.dataset.status = status;
    const closed = status === "closed";
    composer.hidden = closed;
    newChatButton.hidden = !closed;
  }

  // --- Envío ---
  async function onSubmit(event) {
    event.preventDefault();
    const content = textarea.value.trim();
    if (!content || !conversationId) return;
    textarea.value = "";
    hideUrgency();
    const clientMsgId = newClientMsgId();
    store.addPending({ clientMsgId, content, sender: "customer" });
    await send(clientMsgId, content);
  }

  async function send(clientMsgId, content) {
    errorLine.hidden = true;
    try {
      const result = await widgetApi.send(conversationId, content, clientMsgId);
      store.upsert([result.message, result.reply].filter(Boolean));
      setStatus(result.conversationStatus);
    } catch (err) {
      store.markFailed(clientMsgId, err.status === 429 ? err.message : "No se envió.");
      if (err.status === 409) showError(err.message);
    }
  }

  /** Reintento: MISMO clientMsgId (el backend reconoce el mensaje y no lo duplica). */
  function retry(message) {
    store.markPending(message.clientMsgId);
    send(message.clientMsgId, message.content);
  }

  // --- Urgencia local (Web Worker) ---
  function onDraft() {
    clearTimeout(urgencyTimer);
    const text = textarea.value;
    urgencyTimer = setTimeout(async () => {
      const result = await urgency.classify(text);
      if (!result || disposed) return; // null = llegó un borrador más nuevo
      if (result.level === "normal" || status !== "ai_active") hideUrgency();
      else {
        urgencyHint.textContent = result.message;
        urgencyHint.dataset.level = result.level;
        urgencyHint.hidden = false;
      }
    }, URGENCY_DEBOUNCE_MS);
  }

  function hideUrgency() {
    urgencyHint.hidden = true;
    urgencyHint.textContent = "";
  }

  // --- Otros ---
  async function startNewConversation() {
    store.clear();
    const conversation = await widgetApi.newConversation();
    conversationId = conversation.id;
    setStatus(conversation.status);
    connectRealtime();
  }

  async function endSession() {
    socket?.stop();
    await widgetApi.endSession().catch(() => {});
    store.clear();
    conversationId = null;
    showStart();
  }

  function showError(message) {
    errorLine.textContent = message;
    errorLine.hidden = false;
  }

  function showFatal(err) {
    replaceChildren(
      root,
      h(
        "main",
        { class: "page page--chat" },
        h("h1", {}, "No pudimos abrir el chat"),
        h("p", { role: "alert" }, err.message)
      )
    );
  }

  return () => {
    disposed = true;
    clearTimeout(urgencyTimer);
    socket?.stop();
    urgency.terminate();
  };
}
