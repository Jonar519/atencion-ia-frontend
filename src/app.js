import { requireRole, route } from "./router.js";
import { landingView } from "./views/landing.view.js";
import { customerChatView } from "./views/customer/chat.view.js";
import { agentLoginView } from "./views/agent/login.view.js";
import { agentPanelView } from "./views/agent/panel.view.js";
import { agentProfileView } from "./views/agent/profile.view.js";
import { confirmEmailView, forgotPasswordView, resetPasswordView } from "./views/agent/recovery.view.js";
import { invitationView } from "./views/agent/invitation.view.js";
import { toast } from "./components/toast.js";
import { adminKbView } from "./views/admin/kb.view.js";
import { adminCannedView } from "./views/admin/canned.view.js";
import { adminTeamView } from "./views/admin/team.view.js";
import { adminAnalyticsView } from "./views/admin/analytics.view.js";

/**
 * Rutas de la aplicación. Separado de main.js para que los tests usen
 * EXACTAMENTE este registro, no una copia.
 *
 * El TEMA no depende de la ruta ni del usuario: lo decide siempre el sistema
 * operativo (prefers-color-scheme, en styles/tokens.css), en TODAS las pantallas.
 */
export function setupApp({ session }) {
  route("/", landingView);
  route("/chat", customerChatView);
  route("/agente/login", agentLoginView);
  route("/agente/recuperar", forgotPasswordView);
  route("/agente/restablecer", resetPasswordView);
  route("/agente/confirmar-correo", confirmEmailView);
  // Bloque F2: completar una cuenta por invitación (la ÚNICA forma de tener cuenta). Pública.
  route("/agente/invitacion", invitationView);

  // El panel y el perfil recuperan la sesión por su cuenta (y llevan al login si no hay).
  route("/agente", agentPanelView);
  route("/agente/perfil", agentProfileView);

  // Administración: solo admin (guard de la interfaz; el backend exige el rol en cada endpoint).
  const adminOnly = {
    guard: requireRole(session, ["admin"], {
      onDenied: () => toast("Esa sección es solo para administradores.", { tone: "error" }),
    }),
  };
  route("/admin/kb", adminKbView, adminOnly);
  route("/admin/respuestas", adminCannedView, adminOnly);
  route("/admin/equipo", adminTeamView, adminOnly);
  route("/admin/analytics", adminAnalyticsView, adminOnly);
}
