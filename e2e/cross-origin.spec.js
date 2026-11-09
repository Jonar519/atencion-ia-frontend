import { expect, test } from "@playwright/test";
import { E2E_API_URL } from "./adminSession.js";
import { createAgent, loginAsAgent, startCustomerChat, watchCsp } from "./support.js";

/**
 * La app y la API en ORÍGENES DISTINTOS, como en producción
 * (atencion.<dominio> → api-atencion.<dominio>):
 *  - toda petición REST y los WebSockets van al origen de VITE_API_URL;
 *  - las cookies (refresh del asesor, sesión del widget) viajan entre orígenes
 *    con credentials "include" y CORS con credenciales: al RECARGAR, la sesión
 *    se recupera sin pedir la contraseña y el widget sigue en su conversación;
 *  - ninguna violación de CSP (connect-src incluye el origen de la API).
 */
test("app y API en orígenes distintos: REST, WebSocket y cookies", async ({ browser, request, baseURL }) => {
  const appOrigin = new URL(baseURL).origin;
  const apiOrigin = new URL(E2E_API_URL).origin;
  expect(apiOrigin, "el E2E debe correr con la API en otro origen").not.toBe(appOrigin);
  const wsOrigin = apiOrigin.replace(/^http/, "ws");

  const agent = await createAgent(request, "origen");
  const context = await browser.newContext();
  const panel = await context.newPage();
  const csp = watchCsp(panel);
  const apiRequests = [];
  const sameOriginApi = [];
  const sockets = [];
  panel.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith("/api/")) (url.origin === apiOrigin ? apiRequests : sameOriginApi).push(url.pathname);
  });
  panel.on("websocket", (ws) => sockets.push(ws.url()));

  await loginAsAgent(panel, agent);
  await expect(panel.locator(".topbar .conn")).toHaveAttribute("data-status", "open");

  // Recargar: el access token (en memoria) se pierde; la cookie de refresh, de OTRO origen, lo recupera.
  await panel.reload();
  await expect(panel.locator(".topbar")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Entrar" })).toHaveCount(0);

  expect(apiRequests).toContain("/api/auth/login");
  expect(apiRequests).toContain("/api/auth/refresh");
  expect(sameOriginApi, "ninguna petición /api/ al origen de la app").toEqual([]);
  expect(sockets.length).toBeGreaterThan(0);
  for (const url of sockets) expect(url.startsWith(`${wsOrigin}/ws`), url).toBe(true);

  // Widget: su cookie de sesión también es de la API; al recargar sigue en la conversación.
  const widgetContext = await browser.newContext();
  const widget = await widgetContext.newPage();
  const cspWidget = watchCsp(widget);
  await startCustomerChat(widget, `Origen ${Date.now().toString(36)}`);
  await widget.reload();
  await expect(widget.getByText("Te atiende el asistente virtual")).toBeVisible();
  await expect(widget.locator(".chat__header .conn")).toHaveAttribute("data-status", "open");

  expect([...csp, ...cspWidget], "violaciones de CSP").toEqual([]);
  await context.close();
  await widgetContext.close();
});
