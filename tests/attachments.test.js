import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_PLACEHOLDER,
  AttachmentError,
  fitWithin,
  formatBytes,
  MAX_BYTES,
  prepareAttachment,
  sniffType,
} from "../src/lib/attachments.js";
import { createAttachPicker } from "../src/components/attachPicker.js";
import { createAttachmentCache, renderAttachment } from "../src/components/attachmentView.js";
import { renderMessage } from "../src/components/messageList.js";
import { attachmentHeaders } from "../src/api/widget.js";
import { customerChatView } from "../src/views/customer/chat.view.js";
import { createRealtimeClient } from "../src/realtime/socket.js";
import { HttpError } from "../src/api/http.js";
import { FakeWebSocket, flush } from "./support/fakeWebSocket.js";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF");
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const file = (bytes, name, type = "") => new File([bytes], name, { type });

// jsdom no implementa URL.createObjectURL.
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => `blob:prueba-${Math.random().toString(36).slice(2, 6)}`);
  URL.revokeObjectURL = vi.fn();
  FakeWebSocket.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** Doble del canvas/createImageBitmap para la re-codificación de imágenes. */
function imageDeps(width = 4000, height = 3000) {
  const drawn = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ fillRect: () => {}, drawImage: (...args) => drawn.push(args), fillStyle: "" }),
    toBlob: (cb, type, quality) => cb(new Blob(["jpeg-sin-exif"], { type: `${type};q=${quality}` })),
  };
  return {
    drawn,
    canvas,
    deps: { createImageBitmap: async () => ({ width, height, close: () => {} }), createCanvas: () => canvas },
  };
}

describe("preparar el archivo en el navegador", () => {
  it("reconoce el tipo por los BYTES (un .png que en realidad es PDF es PDF; un .pdf con HTML no pasa)", async () => {
    expect(await sniffType(file(PDF_BYTES, "foto.png", "image/png"))).toBe("application/pdf");
    expect(await sniffType(file(PNG_BYTES, "x.bin"))).toBe("image/png");
    expect(
      await sniffType(file(new TextEncoder().encode("<html><script>"), "factura.pdf", "application/pdf"))
    ).toBeNull();
  });

  it("PDF: se sube tal cual; más de 5 MB se rechaza con un mensaje claro", async () => {
    const ok = await prepareAttachment(file(PDF_BYTES, "extracto.pdf"));
    expect(ok).toMatchObject({ type: "application/pdf", name: "extracto.pdf", kind: "pdf" });
    const big = new Uint8Array(MAX_BYTES + 1);
    big.set(PDF_BYTES);
    await expect(prepareAttachment(file(big, "grande.pdf"))).rejects.toThrow(/máximo es 5 MB/);
  });

  it("imagen: se vuelve a dibujar a ≤ 1600 px y se sube como JPEG (así pierde el EXIF con GPS)", async () => {
    const { deps, canvas, drawn } = imageDeps(4000, 3000);
    const result = await prepareAttachment(file(PNG_BYTES, "captura de pantalla.png"), deps);
    expect(result).toMatchObject({ type: "image/jpeg", name: "captura de pantalla.jpg", kind: "image" });
    expect([canvas.width, canvas.height]).toEqual([1600, 1200]);
    expect(drawn).toHaveLength(1);
    expect(result.blob.type).toMatch(/^image\/jpeg/);
  });

  it("tipos no admitidos: mensaje claro (AttachmentError)", async () => {
    const err = await prepareAttachment(file(new TextEncoder().encode("GIF89a"), "a.gif")).catch((e) => e);
    expect(err).toBeInstanceOf(AttachmentError);
    expect(err.message).toMatch(/imágenes \(PNG, JPEG, WebP\) o documentos PDF/);
  });

  it("utilidades: medidas sin agrandar y tamaños legibles", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1000, 4000)).toEqual({ width: 400, height: 1600 });
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2,5 MB");
  });

  it("los encabezados del adjunto van codificados (nombres y comentarios con tildes o saltos de línea)", () => {
    expect(
      attachmentHeaders({ name: "Extracto marzo.pdf", caption: "¿Esto es\nnormal?", clientMsgId: "id-1" })
    ).toEqual({
      "X-File-Name": "Extracto%20marzo.pdf",
      "X-Caption": "%C2%BFEsto%20es%0Anormal%3F",
      "X-Client-Msg-Id": "id-1",
    });
  });
});

describe("selector 'Adjuntar'", () => {
  it("es un botón enfocable que abre el selector; elegir NO envía: muestra la vista previa con 'Quitar'", async () => {
    const picker = createAttachPicker({
      prepare: async (f) => ({ blob: f, type: "application/pdf", name: f.name, size: 2048, kind: "pdf" }),
    });
    document.body.append(picker.input, picker.button, picker.preview, picker.error);
    expect(picker.button.tagName).toBe("BUTTON");
    const click = vi.spyOn(picker.input, "click").mockImplementation(() => {});
    picker.button.click();
    expect(click).toHaveBeenCalled();

    Object.defineProperty(picker.input, "files", { value: [file(PDF_BYTES, "factura.pdf")], configurable: true });
    picker.input.dispatchEvent(new Event("change"));
    await flush();
    expect(picker.preview.hidden).toBe(false);
    expect(picker.preview.textContent).toMatch(/factura\.pdf.*2 KB.*Quitar/);
    [...picker.preview.querySelectorAll("button")].find((b) => b.textContent === "Quitar").click();
    expect(picker.pending).toBeNull();
    expect(picker.preview.hidden).toBe(true);
  });

  it("un archivo no admitido muestra el error y no deja nada pendiente", async () => {
    const picker = createAttachPicker({
      prepare: async () => {
        throw new AttachmentError("Solo puedes adjuntar imágenes (PNG, JPEG, WebP) o documentos PDF.");
      },
    });
    Object.defineProperty(picker.input, "files", {
      value: [file(new Uint8Array([1]), "virus.exe")],
      configurable: true,
    });
    picker.input.dispatchEvent(new Event("change"));
    await flush();
    expect(picker.pending).toBeNull();
    expect(picker.error.hidden).toBe(false);
    expect(picker.error.getAttribute("role")).toBe("alert");
  });
});

describe("el adjunto dentro del mensaje", () => {
  const XSS_NAME = '<img src=x onerror="window.__pwned=1">.pdf';

  it("PDF: tarjeta con el nombre como TEXTO (sin ejecutar nada) y 'Descargar'", async () => {
    const cache = { url: vi.fn(), download: vi.fn(async () => {}) };
    const el = renderAttachment(
      { id: "a1", contentType: "application/pdf", sizeBytes: 3000, originalName: XSS_NAME },
      { cache }
    );
    document.body.append(el);
    expect(el.querySelector(".attachment__name").textContent).toBe(XSS_NAME);
    expect(el.querySelectorAll("img")).toHaveLength(0);
    expect(window.__pwned).toBeUndefined();
    el.querySelector("button").click();
    await flush();
    expect(cache.download).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }));
    expect(cache.url).not.toHaveBeenCalled(); // un PDF nunca se muestra dentro de la app
  });

  it("imagen: se muestra con texto alternativo; si falla, 'Reintentar' vuelve a pedirla", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("red"))
      .mockResolvedValueOnce(new Blob(["png"]));
    const cache = createAttachmentCache(load);
    const el = renderAttachment(
      { id: "i1", contentType: "image/jpeg", sizeBytes: 900, originalName: "foto.jpg" },
      { cache }
    );
    document.body.append(el);
    await flush();
    expect(el.querySelector('[role="alert"]').textContent).toMatch(/No se pudo cargar la imagen/);
    el.querySelector("button").click();
    await flush();
    const img = el.querySelector("img");
    expect(img.getAttribute("alt")).toBe("Imagen adjunta: foto.jpg");
    expect(img.getAttribute("src")).toMatch(/^blob:/);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("el caché pide cada archivo UNA vez aunque la lista se redibuje", async () => {
    const load = vi.fn(async () => new Blob(["x"]));
    const cache = createAttachmentCache(load);
    const attachment = { id: "i2", contentType: "image/png", sizeBytes: 10, originalName: "a.png" };
    await Promise.all([cache.url(attachment), cache.url(attachment), cache.url(attachment)]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("sin comentario, el texto fijo del servidor no se repite debajo del adjunto", () => {
    const el = renderMessage(
      {
        id: "m1",
        sender: "customer",
        content: ATTACHMENT_PLACEHOLDER,
        createdAt: "2026-10-02T10:00:00Z",
        attachment: { id: "a1", contentType: "application/pdf", sizeBytes: 10, originalName: "x.pdf" },
      },
      { attachments: createAttachmentCache(async () => new Blob(["x"])) }
    );
    expect(el.querySelector(".msg__text")).toBeNull();
    expect(el.querySelector(".attachment--pdf")).not.toBeNull();
  });
});

describe("widget del cliente: enviar un adjunto", () => {
  const CONV = "c0000000-0000-4000-8000-0000000000bb";

  async function mountChat(api) {
    const root = document.body.appendChild(document.createElement("div"));
    customerChatView(
      root,
      {},
      {
        widgetApi: api,
        urgencyClient: { classify: async () => ({ level: "normal" }), terminate: () => {} },
        prepareAttachment: async (f) => ({ blob: f, type: "application/pdf", name: f.name, size: 1200, kind: "pdf" }),
        createRealtimeClient: (options) =>
          createRealtimeClient({ ...options, url: "ws://test/ws", WebSocketImpl: FakeWebSocket, backoff: () => 1000 }),
      }
    );
    await flush(30);
    return root;
  }

  function baseApi(overrides = {}) {
    return {
      currentSession: vi.fn(async () => ({})),
      conversations: vi.fn(async () => ({ items: [{ id: CONV, status: "ai_active" }] })),
      newConversation: vi.fn(),
      messages: vi.fn(async () => ({ items: [] })),
      send: vi.fn(),
      attachment: vi.fn(async () => new Blob(["pdf"])),
      ...overrides,
    };
  }

  async function chooseAndSend(root, caption = "") {
    const input = root.querySelector("#chat-attach");
    Object.defineProperty(input, "files", { value: [file(PDF_BYTES, "extracto.pdf")], configurable: true });
    input.dispatchEvent(new Event("change"));
    await flush();
    root.querySelector("textarea").value = caption;
    root.querySelector("form.chat__composer").requestSubmit();
    await flush(30);
  }

  it("el texto escrito va como COMENTARIO del adjunto; se ve 'subiendo…' y luego el adjunto confirmado", async () => {
    let resolveUpload;
    const api = baseApi({
      sendAttachment: vi.fn(
        (_id, _file, { caption, clientMsgId }) =>
          new Promise((resolve) => {
            resolveUpload = () =>
              resolve({
                message: {
                  id: "srv-1",
                  sender: "customer",
                  content: caption || ATTACHMENT_PLACEHOLDER,
                  clientMsgId,
                  createdAt: "2026-10-02T10:00:01Z",
                  attachment: {
                    id: "att-1",
                    contentType: "application/pdf",
                    sizeBytes: 1200,
                    originalName: "extracto.pdf",
                  },
                },
                reply: null,
                conversationStatus: "ai_active",
              });
          })
      ),
    });
    const root = await mountChat(api);
    await chooseAndSend(root, "¿Me explicas este cargo?");
    expect(api.send).not.toHaveBeenCalled();
    expect(api.sendAttachment).toHaveBeenCalledWith(CONV, expect.objectContaining({ name: "extracto.pdf" }), {
      caption: "¿Me explicas este cargo?",
      clientMsgId: expect.any(String),
    });
    expect(root.querySelector(".attachment--pending").textContent).toMatch(/subiendo/);
    resolveUpload();
    await flush(30);
    expect(root.querySelector(".attachment--pdf .attachment__name").textContent).toBe("extracto.pdf");
    expect(root.querySelector(".attach__preview").hidden).toBe(true);
  });

  it("si el servidor lo rechaza (p. ej. PDF con scripts), se dice por qué y 'Reintentar' usa el MISMO clientMsgId", async () => {
    const api = baseApi({
      sendAttachment: vi
        .fn()
        .mockRejectedValueOnce(
          new HttpError("Este PDF trae contenido activo (scripts o archivos incrustados) y no se puede adjuntar.", {
            status: 422,
          })
        )
        .mockRejectedValueOnce(new HttpError("No se pudo conectar", { kind: "network" })),
    });
    const root = await mountChat(api);
    await chooseAndSend(root);
    expect(root.querySelector(".msg__state--error").textContent).toMatch(/contenido activo/);
    [...root.querySelectorAll("button")].find((b) => b.textContent === "Reintentar").click();
    await flush(30);
    const [first, second] = api.sendAttachment.mock.calls;
    expect(second[2].clientMsgId).toBe(first[2].clientMsgId);
    expect(second[2].caption).toBe("");
  });
});

describe("envíos en fila (regresión de la prueba en vivo del bloque C)", () => {
  it("el segundo envío empieza cuando termina el primero, aunque el primero tarde más", async () => {
    const { createSendQueue } = await import("../src/lib/sendQueue.js");
    const enqueue = createSendQueue();
    const log = [];
    let finishFirst;
    const first = enqueue(
      () =>
        new Promise((resolve) => {
          log.push("primero:empieza");
          finishFirst = () => {
            log.push("primero:termina");
            resolve();
          };
        })
    );
    const second = enqueue(async () => log.push("segundo:empieza"));
    await flush();
    expect(log).toEqual(["primero:empieza"]);
    finishFirst();
    await Promise.all([first, second]);
    expect(log).toEqual(["primero:empieza", "primero:termina", "segundo:empieza"]);
  });

  it("si el primero falla, el siguiente igual se envía (la fila no se traba)", async () => {
    const { createSendQueue } = await import("../src/lib/sendQueue.js");
    const enqueue = createSendQueue();
    const failed = enqueue(async () => {
      throw new Error("red");
    });
    await expect(failed).rejects.toThrow("red");
    await expect(enqueue(async () => "ok")).resolves.toBe("ok");
  });
});
