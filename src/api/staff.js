import { api, request } from "./http.js";
import { attachmentHeaders } from "./widget.js";

const auth = { auth: "staff" };
const conv = (id) => `/api/conversations/${encodeURIComponent(id)}`;

/** API del PANEL de agentes (access token en memoria; renovación automática en http.js). */
export const staffApi = {
  me: () => api.get("/api/auth/me", auth),
  setAvailability: (availability) => api.patch("/api/staff/me/availability", { availability }, auth),
  queue: () => api.get("/api/conversations?scope=queue&limit=100", auth),
  mine: () => api.get("/api/conversations?scope=mine&status=agent_active&limit=100", auth),
  conversation: (id) => api.get(conv(id), auth),
  messages: (id, limit = 100) => api.get(`${conv(id)}/messages?limit=${limit}`, auth),
  take: (id) => api.post(`${conv(id)}/take`, undefined, auth),
  close: (id, note) => api.post(`${conv(id)}/close`, note ? { note } : {}, auth),
  reply: (id, content, clientMsgId) => api.post(`${conv(id)}/messages`, { content, clientMsgId }, auth),
  /** Respuestas predefinidas ACTIVAS (para insertarlas en la respuesta). */
  cannedResponses: () => api.get("/api/canned-responses", auth),
  /** Adjunto del asesor (solo en el caso que atiende). */
  sendAttachment: (id, prepared, { caption, clientMsgId } = {}) =>
    request(`${conv(id)}/attachments`, {
      method: "POST",
      auth: "staff",
      raw: { data: prepared.blob, contentType: prepared.type },
      headers: attachmentHeaders({ name: prepared.name, caption, clientMsgId }),
    }),
  /** El archivo como Blob (el panel usa un token: no puede ir directo en un <img>). */
  attachment: (conversationId, attachmentId) =>
    api.get(`${conv(conversationId)}/attachments/${encodeURIComponent(attachmentId)}`, {
      ...auth,
      responseType: "blob",
    }),
  // --- Voz ---
  /** Unirse: si el caso está en cola, lo toma; devuelve la transcripción acumulada. */
  joinCall: (callId) => api.post(`/api/calls/${encodeURIComponent(callId)}/join`, undefined, auth),
  leaveCall: (callId) => api.post(`/api/calls/${encodeURIComponent(callId)}/leave`, undefined, auth),
  endCall: (callId) => api.post(`/api/calls/${encodeURIComponent(callId)}/end`, undefined, auth),
};
