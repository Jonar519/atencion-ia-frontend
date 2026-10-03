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
import { startRouter } from "./router.js";
import * as session from "./auth/session.js";
import { setupApp } from "./app.js";
import { connectivity } from "./components/connectivity.js";
import { registerServiceWorker } from "./sw/registerSW.js";

// Rutas (src/app.js). El tema lo decide el sistema operativo, en CSS (styles/tokens.css).
setupApp({ session });
// Aviso de conectividad desde el arranque: una pérdida de internet se avisa en cualquier pantalla.
connectivity();

startRouter(document.getElementById("app"));
registerServiceWorker();
