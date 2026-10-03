import { expect, test } from "@playwright/test";
import {
  createAgent,
  expectAccessible,
  expectNoTokensInStorage,
  loginAsAgent,
  openCase,
  sendCustomerMessage,
  startCustomerChat,
  watchCsp,
} from "./support.js";

/**
 * FLUJO CRÍTICO, en dos navegadores a la vez (cliente y asesor), sin atajos
 * por la API salvo crear el asesor:
 *   cliente escribe → la IA responde con RAG → se escala → aparece en la cola
 *   del asesor SIN recargar → lo toma → responde → el cliente lo ve en vivo →
 *   el asesor cierra → el cliente lo ve.
 * En el camino: axe (accesibilidad), 0 violaciones de CSP y ningún token en el
 * almacenamiento del navegador.
 */
test("cliente → IA con RAG → escalamiento → asesor lo atiende en tiempo real", async ({ browser, request }) => {
  const agent = await createAgent(request, "flujo");
  const customerName = `Cliente E2E ${Date.now().toString(36)}`;

  const agentContext = await browser.newContext();
  const customerContext = await browser.newContext();
  const panel = await agentContext.newPage();
  const widget = await customerContext.newPage();
  const cspPanel = watchCsp(panel);
  const cspWidget = watchCsp(widget);

  // El asesor ya está en su panel ANTES de que llegue el caso.
  await loginAsAgent(panel, agent);
  await expectAccessible(panel, "el panel");

  // 1. Pregunta con respuesta en la base de conocimiento.
  await startCustomerChat(widget, customerName);
  await expectAccessible(widget, "el widget");
  await sendCustomerMessage(widget, "¿Cuál es el horario de atención de las oficinas?");
  const aiReply = widget.locator(".msg--ai .msg__text").last();
  await expect(aiReply).toContainText("lunes a viernes");
  await expect(widget.locator(".msg--ai .msg__author").last()).toHaveText("Asistente virtual");

  // 2. Posible fraude: el motor escala y avisa al cliente.
  await sendCustomerMessage(widget, "No reconozco un cargo de 450.000 pesos en mi tarjeta de crédito");
  await expect(widget.getByText(/Te estoy comunicando con un asesor/)).toBeVisible();
  await expect(widget.locator(".chat__status")).toHaveText("Te estamos comunicando con un asesor…");

  // 3. El caso aparece en la cola del asesor en TIEMPO REAL, con su historial completo.
  await openCase(panel, customerName);
  const history = panel.locator(".pane .chat__messages");
  await expect(history).toContainText("¿Cuál es el horario de atención de las oficinas?");
  await expect(history).toContainText("Posible fraude");
  await expect(panel.locator(".pane__meta")).toContainText("prioridad Urgente · 90");

  // 4. Lo toma y responde; el cliente lo ve sin recargar.
  await panel.getByRole("button", { name: "Tomar caso" }).click();
  await expect(panel.locator(".pane__meta")).toContainText("Lo atiendes tú");
  const reply = panel.getByLabel("Respuesta", { exact: true });
  await reply.fill("Hola, soy tu asesora. Ya bloqueé la tarjeta y abrí el reclamo.");
  await reply.press("Enter");
  await expect(widget.locator(".msg--agent .msg__text").last()).toHaveText(
    "Hola, soy tu asesora. Ya bloqueé la tarjeta y abrí el reclamo."
  );
  await expect(widget.locator(".chat__status")).toHaveText("Te atiende un asesor de Banco Cordillera");

  // 5. El asesor cierra; el cliente ve que terminó y puede empezar otra.
  await panel.getByRole("button", { name: "Cerrar caso" }).click();
  await expect(widget.locator(".chat__status")).toHaveText("La conversación terminó");
  await expect(widget.getByRole("button", { name: "Nueva conversación" })).toBeVisible();

  // Seguridad del lado del navegador.
  await expectNoTokensInStorage(panel);
  await expectNoTokensInStorage(widget);
  expect([...cspPanel, ...cspWidget], "violaciones de CSP").toEqual([]);

  await agentContext.close();
  await customerContext.close();
});
