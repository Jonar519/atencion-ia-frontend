import { api } from "./http.js";

const auth = { auth: "staff" };

/** API del PERFIL propio (Fase 7). Todo es sobre la cuenta de la sesión; el id sale del token. */
export const profileApi = {
  get: () => api.get("/api/profile", auth),
  update: (patch) => api.patch("/api/profile", patch, auth),
  changeEmail: (newEmail, currentPassword) => api.post("/api/profile/email", { newEmail, currentPassword }, auth),
  changePassword: (currentPassword, newPassword) =>
    api.post("/api/profile/password", { currentPassword, newPassword }, auth),
  /** blob: la imagen YA recortada en el navegador (canvas). */
  setAvatar: (blob) => api.put("/api/profile/avatar", { data: blob, contentType: blob.type }, auth),
  deleteAvatar: () => api.delete("/api/profile/avatar", auth),
  /** Avatar de cualquier miembro del staff, como Blob (se muestra con un URL blob:). */
  avatarOf: (staffId) => api.get(`/api/staff/${encodeURIComponent(staffId)}/avatar`, { ...auth, responseType: "blob" }),
  sessions: () => api.get("/api/profile/sessions", auth),
  revokeSession: (id) => api.delete(`/api/profile/sessions/${encodeURIComponent(id)}`, auth),
  revokeOtherSessions: () => api.post("/api/profile/sessions/revoke-others", undefined, auth),
  exportData: () => api.get("/api/profile/export", auth),
  mfaSetup: () => api.post("/api/profile/mfa/setup", undefined, auth),
  mfaConfirm: (code) => api.post("/api/profile/mfa/confirm", { code }, auth),
  mfaDisable: (password, code) => api.post("/api/profile/mfa/disable", { password, code }, auth),
  mfaBackupCodes: (code) => api.post("/api/profile/mfa/backup-codes", { code }, auth),
};
