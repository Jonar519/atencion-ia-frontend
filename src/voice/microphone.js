/**
 * Micrófono de la llamada.
 *
 * openMicrophone() pide permiso y abre el micrófono; recién entonces se crea
 * la llamada en el servidor (si el cliente niega el permiso, no queda una
 * llamada colgada). stop() APAGA el micrófono (las pistas se detienen y el
 * navegador quita el indicador de grabación): se llama siempre al terminar.
 *
 * El AudioContext se crea en el clic del usuario (la política de autoplay lo
 * exige) y se comparte con el reproductor.
 */

const CONSTRAINTS = {
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

export class MicrophoneError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "MicrophoneError";
    this.cause = cause;
  }
}

function friendlyError(err) {
  switch (err?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "No diste permiso para usar el micrófono. Actívalo en el candado de la barra de direcciones y vuelve a intentar.";
    case "NotFoundError":
      return "No encontramos un micrófono conectado.";
    case "NotReadableError":
      return "Otro programa está usando el micrófono.";
    default:
      return "No pudimos abrir el micrófono.";
  }
}

/** URL del worklet empaquetado por Vite (se carga solo cuando hace falta). */
async function defaultWorkletUrl() {
  const module = await import("./capture.worklet.js?worker&url");
  return module.default;
}

/**
 * @param {object} options
 * @param {AudioContext} options.audioContext
 * @param {MediaDevices} [options.mediaDevices]
 * @param {() => Promise<string>} [options.workletUrl]
 */
export async function openMicrophone({
  audioContext,
  mediaDevices = navigator.mediaDevices,
  workletUrl = defaultWorkletUrl,
}) {
  if (!mediaDevices?.getUserMedia) {
    throw new MicrophoneError("Tu navegador no permite usar el micrófono en esta página.");
  }
  let stream;
  try {
    stream = await mediaDevices.getUserMedia(CONSTRAINTS);
  } catch (err) {
    throw new MicrophoneError(friendlyError(err), err);
  }

  let node = null;
  let source = null;
  let stopped = false;

  return {
    stream,
    /** Empieza a entregar tramas PCM16 de 100 ms. */
    async start(onFrame, onLevel = () => {}) {
      await audioContext.audioWorklet.addModule(await workletUrl());
      if (stopped) return;
      source = audioContext.createMediaStreamSource(stream);
      node = new AudioWorkletNode(audioContext, "pcm16-capture");
      node.port.onmessage = (event) => {
        if (stopped) return;
        onLevel(event.data.level);
        onFrame(event.data.frame);
      };
      source.connect(node);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      source?.disconnect();
      node?.disconnect();
      if (node) node.port.onmessage = null;
      for (const track of stream.getTracks()) track.stop();
    },
    get stopped() {
      return stopped;
    },
  };
}
