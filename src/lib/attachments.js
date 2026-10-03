/**
 * Adjuntos del chat en el NAVEGADOR (Fase 7, bloque C).
 *
 *  - Se aceptan imágenes PNG, JPEG o WebP y documentos PDF, hasta 5 MB.
 *  - El tipo se comprueba por los primeros bytes (no por la extensión). El
 *    servidor lo vuelve a comprobar igual: esto es solo para avisar antes.
 *  - Las IMÁGENES se vuelven a dibujar en un canvas y se suben como JPEG de a
 *    lo sumo 1600 px: así se pierden sus metadatos (una foto de teléfono puede
 *    traer la ubicación GPS) y pesan menos. El servidor además quita los
 *    metadatos de cualquier JPEG que le llegue.
 *  - Los PDF se suben tal cual.
 */
export const ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 1600;
/** Texto que el servidor guarda si el adjunto vino sin comentario (no se muestra como texto). */
export const ATTACHMENT_PLACEHOLDER = "📎 Archivo adjunto";

const SIGNATURES = [
  { type: "image/png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { type: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: "image/webp",
    test: (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  },
  { type: "application/pdf", test: (b) => String.fromCharCode(...b.slice(0, 5)) === "%PDF-" },
];

export class AttachmentError extends Error {}

/** Tipo REAL según los primeros bytes, o null. */
export async function sniffType(file) {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return SIGNATURES.find((s) => s.test(head))?.type ?? null;
}

export function formatBytes(bytes) {
  const fmt = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 });
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${fmt.format(bytes / 1024)} KB`;
  return `${fmt.format(bytes / (1024 * 1024))} MB`;
}

/** Medidas para que el lado mayor no pase de `max`, sin agrandar nunca. */
export function fitWithin(width, height, max = MAX_IMAGE_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function reencodeImage(file, deps) {
  const bitmap = await (deps.createImageBitmap ?? globalThis.createImageBitmap)(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = (deps.createCanvas ?? (() => document.createElement("canvas")))();
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  // Fondo blanco: un PNG con transparencia no queda negro al pasarlo a JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new AttachmentError("No se pudo procesar la imagen.");
  return blob;
}

/**
 * Prepara un archivo elegido por la persona. Resuelve con { blob, type, name, size, kind }
 * o lanza AttachmentError con un mensaje para mostrar.
 */
export async function prepareAttachment(file, deps = {}) {
  if (!file) throw new AttachmentError("No se eligió ningún archivo.");
  const type = await sniffType(file);
  if (!type) throw new AttachmentError("Solo puedes adjuntar imágenes (PNG, JPEG, WebP) o documentos PDF.");
  if (type === "application/pdf") {
    if (file.size > MAX_BYTES) throw new AttachmentError(`El PDF pesa ${formatBytes(file.size)}: el máximo es 5 MB.`);
    return { blob: file, type, name: file.name || "documento.pdf", size: file.size, kind: "pdf" };
  }
  const blob = await reencodeImage(file, deps);
  if (blob.size > MAX_BYTES) throw new AttachmentError("La imagen sigue pesando más de 5 MB incluso reducida.");
  const base = (file.name || "imagen").replace(/\.[A-Za-z0-9]{1,5}$/, "");
  return { blob, type: "image/jpeg", name: `${base}.jpg`, size: blob.size, kind: "image" };
}
