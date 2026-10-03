import { AI_TIMEOUT_MS, api, request } from "./http.js";

/** Encabezados de un adjunto: el cuerpo es el archivo crudo (ver backend attachments.http.ts). */
export function attachmentHeaders({ name, caption, clientMsgId }) {
  return {
    "X-File-Name": encodeURIComponent(name ?? ""),
    ...(caption ? { "X-Caption": encodeURIComponent(caption) } : {}),
    ...(clientMsgId ? { "X-Client-Msg-Id": clientMsgId } : {}),
  };
}

/**
 * API del widget del CLIENTE. La sesión es una cookie httpOnly que pone el
 * backend: este código nunca ve el token (ver backend widgetAuth.middleware.ts).
 */
export const widgetApi = {
  currentSession: () => api.get("/api/widget/session"),
  startSession: (displayName) => api.post("/api/widget/sessions", displayName ? { displayName } : {}),
  endSession: () => api.post("/api/widget/session/end"),
  conversations: () => api.get("/api/widget/conversations"),
  newConversation: () => api.post("/api/widget/conversations", {}),
  messages: (conversationId, limit = 50) =>
    api.get(`/api/widget/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`),
  send: (conversationId, content, clientMsgId) =>
    api.post(
      `/api/widget/conversations/${encodeURIComponent(conversationId)}/messages`,
      { content, clientMsgId },
      { timeoutMs: AI_TIMEOUT_MS }
    ),
  /** Adjunto (imagen o PDF) con comentario opcional: es un turno como un mensaje. */
  sendAttachment: (conversationId, prepared, { caption, clientMsgId } = {}) =>
    request(`/api/widget/conversations/${encodeURIComponent(conversationId)}/attachments`, {
      method: "POST",
      raw: { data: prepared.blob, contentType: prepared.type },
      headers: attachmentHeaders({ name: prepared.name, caption, clientMsgId }),
      timeoutMs: AI_TIMEOUT_MS,
    }),
  /** El adjunto como Blob (la cookie del widget viaja sola). */
  attachment: (attachmentId) =>
    api.get(`/api/widget/attachments/${encodeURIComponent(attachmentId)}`, { responseType: "blob" }),
  // --- Voz ---
  voiceConsent: () => api.get("/api/widget/voice/consent"),
  /** Solo con consentimiento: el backend exige la versión vigente del aviso y accepted: true. */
  startCall: (conversationId, consentVersion) =>
    api.post(`/api/widget/conversations/${encodeURIComponent(conversationId)}/calls`, {
      consentVersion,
      accepted: true,
    }),
  endCall: (callId) => api.post(`/api/widget/calls/${encodeURIComponent(callId)}/end`),
};
