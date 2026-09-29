import "@fontsource-variable/inter";
import "@fontsource/source-serif-4/600.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/chat.css";
import "./styles/panel.css";
import { route, startRouter } from "./router.js";
import { landingView } from "./views/landing.view.js";
import { customerChatView } from "./views/customer/chat.view.js";
import { agentLoginView } from "./views/agent/login.view.js";
import { agentPanelView } from "./views/agent/panel.view.js";
import { registerServiceWorker } from "./sw/registerSW.js";

route("/", landingView);
route("/chat", customerChatView);
route("/agente/login", agentLoginView);
route("/agente", agentPanelView);

startRouter(document.getElementById("app"));
registerServiceWorker();
