import { api } from "./http.js";

const auth = { auth: "staff" };
const q = encodeURIComponent;

/**
 * API de las pantallas de ADMINISTRACIÓN (Fase 7, bloque B). El backend exige
 * rol admin en cada una (requireRole): ocultarlas en la interfaz es comodidad,
 * no seguridad.
 */
export const adminApi = {
  // Base de conocimiento
  articles: ({ status } = {}) => api.get(`/api/kb/articles?limit=100${status ? `&status=${q(status)}` : ""}`, auth),
  article: (id) => api.get(`/api/kb/articles/${q(id)}`, auth),
  createArticle: (data) => api.post("/api/kb/articles", data, auth),
  updateArticle: (id, data) => api.patch(`/api/kb/articles/${q(id)}`, data, auth),
  deleteArticle: (id) => api.delete(`/api/kb/articles/${q(id)}`, auth),
  // Respuestas predefinidas
  cannedAll: () => api.get("/api/canned-responses?includeInactive=true", auth),
  createCanned: (data) => api.post("/api/canned-responses", data, auth),
  updateCanned: (id, data) => api.patch(`/api/canned-responses/${q(id)}`, data, auth),
  deleteCanned: (id) => api.delete(`/api/canned-responses/${q(id)}`, auth),
  // Equipo
  staff: () => api.get("/api/staff", auth),
  casesOf: (agentId) =>
    api.get(`/api/conversations?scope=all&status=agent_active&agentId=${q(agentId)}&limit=100`, auth),
  reassign: (conversationId, agentId) =>
    api.post(`/api/conversations/${q(conversationId)}/reassign`, { agentId }, auth),
  exportStaff: (id) => api.get(`/api/staff/${q(id)}/export`, auth),
  anonymize: (id) => api.post(`/api/staff/${q(id)}/anonymize`, undefined, auth),
  // Analítica
  analytics: (days) => api.get(`/api/admin/analytics?days=${q(days)}`, auth),
};
