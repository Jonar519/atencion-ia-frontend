import "@fontsource-variable/inter";
import "@fontsource/source-serif-4/600.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/chat.css";
import "./styles/panel.css";
import "./styles/voice.css";
import "./styles/profile.css";
import "./styles/admin.css";
import "./styles/attachments.css";
import { requireRole, route, startRouter } from "./router.js";
import { landingView } from "./views/landing.view.js";
import { customerChatView } from "./views/customer/chat.view.js";
import { agentLoginView } from "./views/agent/login.view.js";
import { agentPanelView } from "./views/agent/panel.view.js";
import { agentProfileView } from "./views/agent/profile.view.js";
import { confirmEmailView, forgotPasswordView, resetPasswordView } from "./views/agent/recovery.view.js";
import * as session from "./auth/session.js";
import { bindThemeToSession } from "./theme.js";
import { toast } from "./components/toast.js";
import { connectivity } from "./components/connectivity.js";
import { adminKbView } from "./views/admin/kb.view.js";
import { adminCannedView } from "./views/admin/canned.view.js";
import { adminTeamView } from "./views/admin/team.view.js";
import { adminAnalyticsView } from "./views/admin/analytics.view.js";
import { registerServiceWorker } from "./sw/registerSW.js";

route("/", landingView);
route("/chat", customerChatView);
route("/agente/login", agentLoginView);
route("/agente", agentPanelView);
route("/agente/perfil", agentProfileView);
route("/agente/recuperar", forgotPasswordView);
route("/agente/restablecer", resetPasswordView);
route("/agente/confirmar-correo", confirmEmailView);

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

bindThemeToSession(session);
// Aviso de conectividad desde el arranque: una pérdida de internet se avisa en cualquier pantalla.
connectivity();

startRouter(document.getElementById("app"));
registerServiceWorker();
