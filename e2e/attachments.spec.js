import { expect, test } from "@playwright/test";
import zlib from "node:zlib";
import {
  createAgent,
  expectAccessible,
  loginAsAgent,
  openCase,
  sendCustomerMessage,
  startCustomerChat,
  watchCsp,
} from "./support.js";

/**
 * ADJUNTOS (Fase 7, bloque C), en dos navegadores: el cliente adjunta un PDF
 * con comentario y una foto; el asesor los ve EN VIVO (el PDF como tarjeta
 * para descargar, la foto en el chat) y el cliente recibe un adjunto del asesor.
 * En el camino: 0 violaciones de CSP (las imágenes se muestran con URL blob:)
 * y accesibilidad con axe. La foto se elige con el selector real del sistema
 * (setInputFiles) y el navegador la re-codifica en un canvas antes de subirla.
 */

/** PNG real de 8×8 (Chromium lo decodifica en el canvas). */
function tinyPng() {
  const crc = (buf) => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.from([0, 0, 0, 8, 0, 0, 0, 8, 8, 2, 0, 0, 0]);
  const rows = Buffer.concat(
    Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(24, 0x80)]))
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n", "latin1");

test("adjuntos: el cliente envía un PDF y una foto; el asesor los ve en vivo y responde con un adjunto", async ({
  browser,
  request,
}) => {
  const agent = await createAgent(request, "adjuntos");
  const customerName = `Cliente adjuntos ${Date.now().toString(36)}`;
  const agentContext = await browser.newContext();
  const customerContext = await browser.newContext();
  const panel = await agentContext.newPage();
  const widget = await customerContext.newPage();
  const cspPanel = watchCsp(panel);
  const cspWidget = watchCsp(widget);

  await loginAsAgent(panel, agent);
  await startCustomerChat(widget, customerName);
  await sendCustomerMessage(widget, "Quiero hablar con un asesor, por favor");
  await expect(widget.locator(".chat__status")).toHaveText("Te estamos comunicando con un asesor…");
  await openCase(panel, customerName);
  await panel.getByRole("button", { name: "Tomar caso" }).click();
  await expect(panel.locator(".pane__meta")).toContainText("Lo atiendes tú");

  // 1. PDF con comentario: elegir NO envía; se ve la vista previa con "Quitar".
  await widget
    .locator("#chat-attach")
    .setInputFiles({ name: "extracto marzo.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(widget.locator(".attach__preview")).toContainText("extracto marzo.pdf");
  await widget.getByLabel("Tu mensaje").fill("¿Me explicas este cargo del extracto?");
  await widget.getByRole("button", { name: "Enviar" }).click();
  const sentPdf = widget.locator(".msg--customer .attachment--pdf").last();
  await expect(sentPdf).toContainText("extracto marzo.pdf");
  await expect(widget.locator(".attach__preview")).toBeHidden();

  // El asesor lo ve en vivo, con el comentario, y lo puede descargar.
  const pdfCard = panel.locator(".msg--customer .attachment--pdf").last();
  await expect(pdfCard).toContainText("extracto marzo.pdf");
  await expect(panel.locator(".pane .chat__messages")).toContainText("¿Me explicas este cargo del extracto?");
  const download = panel.waitForEvent("download");
  await pdfCard.getByRole("button", { name: /Descargar/ }).click();
  expect((await download).suggestedFilename()).toBe("extracto marzo.pdf");

  // 2. Foto sin comentario: se re-codifica a JPEG en el navegador y se muestra en el chat del asesor.
  await widget.locator("#chat-attach").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: tinyPng() });
  await expect(widget.locator(".attach__preview")).toContainText("foto.jpg");
  await widget.getByRole("button", { name: "Enviar" }).click();
  const photo = panel.locator(".msg--customer .attachment--image img").last();
  await expect(photo).toHaveAttribute("alt", "Imagen adjunta: foto.jpg");
  await expect(photo).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => photo.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);

  // 3. El asesor responde con un adjunto; el cliente lo ve.
  await panel
    .locator("#reply-attach")
    .setInputFiles({ name: "instructivo.pdf", mimeType: "application/pdf", buffer: PDF });
  await panel.getByLabel("Respuesta", { exact: true }).fill("Te envío el instructivo");
  await panel.getByRole("button", { name: "Enviar" }).click();
  await expect(widget.locator(".msg--agent .attachment--pdf").last()).toContainText("instructivo.pdf");
  await expect(widget.locator(".msg--agent .msg__text").last()).toHaveText("Te envío el instructivo");

  // 4. Un archivo que no es imagen ni PDF se rechaza en el navegador, con un mensaje claro.
  await widget
    .locator("#chat-attach")
    .setInputFiles({ name: "nota.txt", mimeType: "text/plain", buffer: Buffer.from("hola") });
  await expect(widget.locator(".attach__error")).toHaveText(/imágenes \(PNG, JPEG, WebP\) o documentos PDF/);

  await expectAccessible(panel, "el panel con adjuntos");
  await expectAccessible(widget, "el widget con adjuntos");
  expect([...cspPanel, ...cspWidget], "violaciones de CSP").toEqual([]);

  await agentContext.close();
  await customerContext.close();
});
