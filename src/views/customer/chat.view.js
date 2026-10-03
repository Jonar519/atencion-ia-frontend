import { h, replaceChildren } from "../../lib/dom.js";
import { newClientMsgId } from "../../lib/ids.js";
import { widgetApi as defaultWidgetApi } from "../../api/widget.js";
import { createMessageStore } from "../../chat/messageStore.js";
import { renderMessageList } from "../../components/messageList.js";
import { createAttachPicker, localAttachment } from "../../components/attachPicker.js";
import { createAttachmentCache } from "../../components/attachmentView.js";
import { ATTACHMENT_PLACEHOLDER } from "../../lib/attachments.js";
import { createSendQueue } from "../../lib/sendQueue.js";
import { emptyState, errorState, loadingState } from "../../components/states.js";

/** Ejemplos del estado vacío: un clic los ESCRIBE en la caja (no los envía). */
export const EXAMPLE_QUESTIONS = [
  "¿Cuál es el horario de las oficinas?",
  "No reconozco un cargo en mi tarjeta",
  "Quiero hablar con un asesor",
];
import { connectionIndicator } from "../../components/connection.js";
import { connectivity as defaultConnectivity } from "../../components/connectivity.js";
import { createRealtimeClient } from "../../realtime/socket.js";
import { createUrgencyClient } from "../../urgency/urgencyClient.js";
import { createCustomerCallController } from "../../voice/customerCall.js";

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
 * Llamada de voz (Fase 6): botón "Llamar" → aviso de consentimiento →
 * micrófono → llamada (voice/customerCall.js). Lo que se dice aparece en el
 * mismo historial (los turnos de voz llegan por el WebSocket de eventos).
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
  const notice = deps.connectivity ?? defaultConnectivity();
  // Adjuntos (bloque C): selector en la caja de escritura y caché de los archivos ya mostrados.
  const attach = createAttachPicker({ prepare: deps.prepareAttachment, id: "chat-attach" });
  const attachments = createAttachmentCache((attachment) => widgetApi.attachment(attachment.id));
  // Archivos de envíos fallidos, para reintentar con el MISMO clientMsgId.
  const unsent = new Map();
  // Envíos en fila: el orden del chat es el orden en que se enviaron.
  const enqueue = createSendQueue();

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
    attach.preview,
    h("label", { class: "sr-only", for: "chat-input" }, "Tu mensaje"),
    textarea,
    h("div", { class: "chat__composer-actions" }, attach.input, attach.button, sendButton),
    attach.error,
    urgencyHint,
    errorLine
  );
  const newChatButton = h(
    "button",
    { class: "btn", type: "button", hidden: true, on: { click: startNewConversation } },
    "Nueva conversación"
  );
  const endButton = h("button", { class: "link-btn", type: "button", on: { click: endSession } }, "Salir");
  const callButton = h(
    "button",
    { class: "btn btn--call", type: "button", hidden: true, on: { click: () => call.begin() } },
    "Llamar"
  );
  const callArea = h("div", { class: "chat__call", hidden: true });
  const call = createCustomerCallController({
    mount: callArea,
    widgetApi,
    conversationId: () => conversationId,
    conversationStatus: () => status,
    onActiveChange: () => updateCallButton(),
    voice: deps.voice,
  });

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
      h("div", { class: "chat__header-actions" }, connection.el, callButton, endButton)
    ),
    statusLine,
    callArea,
    list,
    newChatButton,
    composer
  );

  // "loading" mientras se abre la conversación; "error" si falló; "ready" con la conversación.
  let viewState = "loading";
  store.subscribe((messages) => {
    if (viewState !== "ready") return;
    if (!messages.length) return renderEmpty();
    renderMessageList(list, messages, { perspective: "customer", onRetry: retry, attachments });
  });
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

  /** Conversación nueva sin mensajes: qué se puede preguntar (los ejemplos se escriben, no se envían). */
  function renderEmpty() {
    replaceChildren(
      list,
      h(
        "li",
        { class: "chat__empty" },
        emptyState(
          "¿En qué te podemos ayudar?",
          "Escribe tu pregunta. Te responde el asistente virtual y, si lo necesitas, un asesor. Por ejemplo:",
          h(
            "div",
            { class: "chat__examples" },
            EXAMPLE_QUESTIONS.map((question) =>
              h(
                "button",
                {
                  class: "btn btn--small",
                  type: "button",
                  on: {
                    click: () => {
                      textarea.value = question;
                      textarea.focus();
                      onDraft();
                    },
                  },
                },
                question
              )
            )
          )
        )
      )
    );
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
    viewState = "loading";
    replaceChildren(list, h("li", { class: "chat__state" }, loadingState("Abriendo tu conversación", { lines: 3 })));
    composer.hidden = true;
    try {
      const { items } = await widgetApi.conversations();
      const open = items.find((conversation) => conversation.status !== "closed");
      const conversation = open ?? (await widgetApi.newConversation());
      conversationId = conversation.id;
      setStatus(conversation.status);
      const { items: messages } = await widgetApi.messages(conversationId);
      if (disposed) return;
      viewState = "ready";
      store.upsert(messages);
      if (!messages.length) renderEmpty();
    } catch (err) {
      if (disposed) return;
      viewState = "error";
      // Reintentar vuelve a pedir SOLO la conversación: no recarga la página.
      replaceChildren(
        list,
        h(
          "li",
          { class: "chat__state" },
          errorState(`No pudimos abrir tu conversación. ${err.message}`, () => openLatestConversation())
        )
      );
      return;
    }
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
      onStatus: (next) => {
        connection.set(next);
        // Aviso de conectividad de la pestaña (uno solo, compartido por las vistas).
        notice.socketStatus("chat", next);
      },
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
      attachment: message.attachment ?? null,
    };
  }

  function setStatus(next) {
    const previous = status;
    status = next;
    call?.conversationStatusChanged?.(previous, next);
    statusLine.textContent = STATUS_TEXT[status] ?? "";
    statusLine.dataset.status = status;
    const closed = status === "closed";
    composer.hidden = closed;
    newChatButton.hidden = !closed;
    updateCallButton();
  }

  /** "Llamar" solo con una conversación abierta y sin otra llamada en curso en esta pestaña. */
  function updateCallButton() {
    callButton.hidden = !conversationId || status === "closed" || call?.active;
  }

  // --- Envío ---
  async function onSubmit(event) {
    event.preventDefault();
    const content = textarea.value.trim();
    const file = attach.pending;
    if ((!content && !file) || !conversationId) return;
    textarea.value = "";
    hideUrgency();
    const clientMsgId = newClientMsgId();
    if (file) {
      attach.take();
      unsent.set(clientMsgId, file);
      store.addPending({
        clientMsgId,
        content: content || ATTACHMENT_PLACEHOLDER,
        sender: "customer",
        attachment: localAttachment(file),
      });
    } else {
      store.addPending({ clientMsgId, content, sender: "customer" });
    }
    await enqueue(() => send(clientMsgId, content));
  }

  async function send(clientMsgId, content) {
    errorLine.hidden = true;
    const file = unsent.get(clientMsgId);
    try {
      // Con adjunto, el texto va como comentario (puede estar vacío).
      const result = file
        ? await widgetApi.sendAttachment(conversationId, file, { caption: content, clientMsgId })
        : await widgetApi.send(conversationId, content, clientMsgId);
      unsent.delete(clientMsgId);
      store.upsert([result.message, result.reply].filter(Boolean));
      setStatus(result.conversationStatus);
    } catch (err) {
      // Errores del archivo (tipo, tamaño, PDF con scripts): el mensaje del servidor dice qué pasó.
      const fileProblem = file && [413, 415, 422].includes(err.status);
      store.markFailed(clientMsgId, err.status === 429 || fileProblem ? err.message : "No se envió.");
      if (err.status === 409) showError(err.message);
    }
  }

  /** Reintento: MISMO clientMsgId (el backend reconoce el mensaje y no lo duplica). */
  function retry(message) {
    store.markPending(message.clientMsgId);
    enqueue(() => send(message.clientMsgId, message.content === ATTACHMENT_PLACEHOLDER ? "" : message.content));
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
    try {
      const conversation = await widgetApi.newConversation();
      conversationId = conversation.id;
      setStatus(conversation.status);
      renderEmpty();
      connectRealtime();
    } catch (err) {
      showError(`No se pudo empezar una conversación nueva. ${err.message}`);
    }
  }

  async function endSession() {
    call.dispose();
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

  /** No se pudo ni consultar la sesión: el chat se oculta y "Reintentar" vuelve a arrancar (sin recargar). */
  function showFatal(err) {
    shell.hidden = true;
    root.querySelector(".chat__fatal")?.remove();
    const fatal = h(
      "section",
      { class: "chat__fatal" },
      h("h1", {}, "No pudimos abrir el chat"),
      errorState(err.message, () => {
        fatal.remove();
        shell.hidden = false;
        boot();
      })
    );
    root.querySelector("main").append(fatal);
  }

  return () => {
    disposed = true;
    notice.socketStatus("chat", "closed");
    clearTimeout(urgencyTimer);
    call.dispose();
    socket?.stop();
    urgency.terminate();
    attachments.dispose();
  };
}
