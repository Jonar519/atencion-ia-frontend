import { expect, test } from "@playwright/test";
import { createAgent, loginAsAgent, openCase, startCustomerChat, watchCsp } from "./support.js";

/**
 * LLAMADA DE VOZ de punta a punta con el micrófono FALSO de Chromium (un audio
 * con ritmo de habla, e2e/global-setup.js) y el reconocimiento SIMULADO del
 * servidor (reacciona al sonido y "transcribe" un guion fijo de 3 frases; la
 * tercera escala por posible fraude).
 *
 * Real en esta prueba: permiso y captura del micrófono, AudioWorklet (16 kHz),
 * WebSocket de voz, reproducción de la respuesta, WebRTC entre el cliente y el
 * asesor (dos contextos del navegador), y que el micrófono se apaga al colgar.
 *
 * Fase 7 (D1), con la llamada REAL: la forma de onda dibuja el audio del
 * micrófono, la insignia en vivo, la ÚNICA animación (barrido al pasar de la IA
 * a un asesor; el cliente aquí NO tiene "movimiento reducido", para verla correr)
 * y el ánimo del cliente en vivo en el panel.
 */
test("llamar con consentimiento → la IA responde → escala → el asesor se une con WebRTC", async ({
  browser,
  request,
}) => {
  const agent = await createAgent(request, "voz");
  const customerName = `Llamada E2E ${Date.now().toString(36)}`;
  const agentContext = await browser.newContext();
  // Sin "movimiento reducido" en el cliente: se comprueba que la animación del traspaso CORRE.
  const customerContext = await browser.newContext({ reducedMotion: "no-preference" });
  const panel = await agentContext.newPage();
  const widget = await customerContext.newPage();
  const csp = [...[watchCsp(panel)], ...[watchCsp(widget)]];

  await loginAsAgent(panel, agent);
  await startCustomerChat(widget, customerName);

  // 1. Consentimiento: sin marcar la casilla no se puede llamar.
  await widget.getByRole("button", { name: "Llamar" }).click();
  const consent = widget.getByRole("dialog", { name: "Antes de llamar" });
  await expect(consent).toContainText("El audio NO se graba");
  const accept = widget.getByRole("button", { name: "Aceptar y llamar" });
  await expect(accept).toBeDisabled();
  await widget.getByLabel(/Leí el aviso y acepto/).check();
  await accept.click();

  // 2. En llamada: el micrófono llega (medidor + "Te escuchamos").
  const bar = widget.locator(".callbar");
  await expect(bar.locator(".callbar__status")).toHaveText("En llamada con el asistente virtual");
  await expect(bar.getByText("Te escuchamos")).toBeVisible();

  // D1: insignia en vivo y forma de onda dibujando el audio real del micrófono (píxeles no vacíos).
  await expect(bar.locator(".callbar__live")).toHaveText("Llamada en curso");
  await expect
    .poll(() =>
      widget.evaluate(() => {
        const canvas = document.querySelector(".callbar canvas.waveform");
        const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        let painted = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted += 1;
        return painted;
      })
    )
    .toBeGreaterThan(50);
  // Se registra qué animaciones corren en la página (debe ser SOLO la del traspaso, y una vez).
  await widget.evaluate(() => {
    window.__animations = [];
    document.addEventListener("animationstart", (event) => window.__animations.push(event.animationName), true);
  });

  // 3. Tres frases del guion simulado. Tras cada respuesta hablada se usa
  //    "Interrumpir" para no esperar el audio completo.
  const turns = widget.locator(".msg--customer .msg__text");
  for (let phrase = 1; phrase <= 3; phrase += 1) {
    await expect(turns).toHaveCount(phrase, { timeout: 30_000 });
    const interrupt = bar.getByRole("button", { name: "Interrumpir" });
    if (phrase < 3) {
      await expect(interrupt).toBeVisible();
      await interrupt.click();
    }
  }
  await expect(turns.first()).toHaveText("Hola, quisiera saber el horario de atención de las oficinas");
  await expect(widget.locator(".msg--ai .msg__text").first()).toContainText("lunes a viernes");
  await expect(bar.locator(".callbar__status")).toHaveText(/pasando con un asesor/);

  // D1: la ÚNICA transición animada corrió UNA vez y el borde quedó en menta (asesor).
  await expect(bar).toHaveAttribute("data-handoff", "done");
  await expect.poll(() => widget.evaluate(() => window.__animations)).toEqual(["callbar-handoff"]);
  await expect.poll(() => bar.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe("rgb(0, 179, 126)");

  // 4. El asesor ve el caso con la llamada en espera y se une (WebRTC real).
  await openCase(panel, customerName);
  await expect(panel.locator(".pane__meta")).toContainText("Llamada en espera de asesor");
  await panel.getByRole("button", { name: "Unirse a la llamada" }).click();
  const dock = panel.locator(".call-dock");
  await expect(dock.locator(".callbar__status")).toHaveText("En llamada con el cliente");
  await expect(dock.locator(".callbar__peer")).toHaveText("Audio con el cliente: conectado", { timeout: 30_000 });
  await expect(bar.locator(".callbar__status")).toHaveText("En llamada con un asesor");
  await expect(bar.locator(".callbar__peer")).toHaveText("Audio con el asesor: conectado");

  // D1: "Asesor conectado" en las dos barras; ánimo del cliente en vivo en el panel.
  await expect(bar.locator(".callbar__live")).toHaveText("Asesor conectado");
  await expect(dock.locator(".callbar__live")).toHaveText("Asesor conectado");
  await expect(panel.locator(".pane__meta .sentiment")).toHaveText(/^Ánimo del cliente: /);
  expect(await widget.evaluate(() => window.__animations)).toEqual(["callbar-handoff"]); // sigue siendo UNA

  // El audio del cliente llega de verdad al asesor por WebRTC (bytes recibidos crecen).
  const inbound = async () =>
    panel.evaluate(async () => {
      const audio = document.querySelector(".call-dock audio");
      return audio?.srcObject?.getAudioTracks()[0]?.readyState ?? "sin pista";
    });
  expect(await inbound()).toBe("live");

  // 5. El cliente cuelga: las dos barras lo muestran y los micrófonos se apagan.
  await bar.getByRole("button", { name: "Colgar" }).click();
  await expect(bar.locator(".callbar__status")).toHaveText("La llamada terminó.");
  await expect(dock.locator(".callbar__status")).toHaveText("La llamada terminó.");
  await expect(widget.locator(".msg--system", { hasText: "La llamada de voz terminó." })).toBeVisible();

  expect(csp.flat(), "violaciones de CSP").toEqual([]);
  await agentContext.close();
  await customerContext.close();
});
