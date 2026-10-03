import { h } from "../lib/dom.js";

/**
 * Recorte del avatar EN EL NAVEGADOR (canvas 2D): la persona elige una foto,
 * la acerca y la mueve dentro de un cuadrado; se sube solo el recorte de
 * OUTPUT_SIZE px (JPEG), nunca la foto original (menos datos personales y
 * menos bytes). El servidor igual valida tipo y tamaño.
 *
 * Se mueve con el mouse/dedo (arrastrar) o con las flechas del teclado.
 */
export const OUTPUT_SIZE = 256;
export const MAX_BYTES = 300 * 1024;
const MAX_ZOOM = 4;
const KEY_STEP = 8;

/** Escala para que el lado corto cubra el cuadrado (zoom 1) multiplicada por el zoom. */
export function coverScale(width, height, size, zoom) {
  return (size / Math.min(width, height)) * zoom;
}

/** La imagen siempre cubre el cuadrado: el desplazamiento se limita a [size - lado, 0]. */
export function clampOffset(offset, drawn, size) {
  return Math.min(0, Math.max(size - drawn, offset));
}

/** Nuevo desplazamiento al cambiar de zoom, manteniendo el punto central del cuadrado. */
export function zoomAround(offset, oldScale, newScale, size) {
  const center = size / 2;
  return center - ((center - offset) / oldScale) * newScale;
}

export function createAvatarCropper(image, { size = OUTPUT_SIZE } = {}) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  let zoom = 1;
  let scale = coverScale(width, height, size, zoom);
  let x = (size - width * scale) / 2;
  let y = (size - height * scale) / 2;

  const canvas = h("canvas", {
    class: "cropper__canvas",
    width: size,
    height: size,
    tabindex: 0,
    role: "img",
    "aria-label": "Vista previa del recorte. Arrastra o usa las flechas para mover la foto.",
  });
  const ctx = canvas.getContext("2d");
  const zoomInput = h("input", {
    id: "cropper-zoom",
    type: "range",
    min: 1,
    max: MAX_ZOOM,
    step: 0.01,
    value: 1,
    on: { input: (event) => setZoom(Number(event.target.value)) },
  });

  function clamp() {
    x = clampOffset(x, width * scale, size);
    y = clampOffset(y, height * scale, size);
  }

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(image, x, y, width * scale, height * scale);
  }

  function setZoom(next) {
    const newScale = coverScale(width, height, size, next);
    x = zoomAround(x, scale, newScale, size);
    y = zoomAround(y, scale, newScale, size);
    zoom = next;
    scale = newScale;
    clamp();
    draw();
  }

  function move(dx, dy) {
    x += dx;
    y += dy;
    clamp();
    draw();
  }

  let drag = null;
  canvas.addEventListener("pointerdown", (event) => {
    drag = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    move(event.clientX - drag.x, event.clientY - drag.y);
    drag = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener("pointerup", () => (drag = null));
  canvas.addEventListener("pointercancel", () => (drag = null));
  canvas.addEventListener("keydown", (event) => {
    const deltas = {
      ArrowLeft: [KEY_STEP, 0],
      ArrowRight: [-KEY_STEP, 0],
      ArrowUp: [0, KEY_STEP],
      ArrowDown: [0, -KEY_STEP],
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    move(...delta);
  });

  clamp();
  draw();

  return {
    el: h(
      "div",
      { class: "cropper" },
      canvas,
      h("label", { class: "cropper__zoom", for: "cropper-zoom" }, "Acercar", zoomInput)
    ),
    get state() {
      return { x, y, zoom, scale };
    },
    move,
    setZoom,
    /** El recorte como JPEG; baja la calidad si pasa del límite del servidor. */
    async toBlob() {
      draw();
      for (const quality of [0.9, 0.8, 0.65, 0.5]) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (blob && blob.size <= MAX_BYTES) return blob;
      }
      throw new Error("No se pudo reducir la imagen por debajo de 300 KB.");
    },
  };
}

/** Carga un File de imagen en un <img> (URL blob: local, se libera al terminar). */
export function loadImage(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      reject(new Error("Elige una imagen PNG, JPEG o WebP."));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen."));
    };
    img.src = url;
  });
}
