import { api } from "./http.js";

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
  // --- Voz ---
  /** Unirse: si el caso está en cola, lo toma; devuelve la transcripción acumulada. */
  joinCall: (callId) => api.post(`/api/calls/${encodeURIComponent(callId)}/join`, undefined, auth),
  leaveCall: (callId) => api.post(`/api/calls/${encodeURIComponent(callId)}/leave`, undefined, auth),
  endCall: (callId) => api.post(`/api/calls/${encodeURIComponent(callId)}/end`, undefined, auth),
};
