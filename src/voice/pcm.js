/**
 * Audio de la llamada, lado navegador. El backend espera PCM16 lineal,
 * little-endian, mono, a 16 kHz, en tramas de ~100 ms (backend:
 * src/services/voice/pcm.ts). El micrófono entrega Float32 a la frecuencia
 * del dispositivo (48 kHz o 44,1 kHz normalmente), así que aquí se convierte.
 *
 * Funciones PURAS: las usa el AudioWorklet (capture.worklet.js) y se prueban
 * en tests/voicePcm.test.js. Si la conversión estuviera mal (p. ej. se enviara
 * a 48 kHz), el servidor recibiría 3 veces más bytes por segundo y cortaría la
 * llamada por "audio más rápido que el tiempo real" (cierre 4429).
 */

export const TARGET_SAMPLE_RATE = 16_000;
export const FRAME_MS = 100;
export const FRAME_SAMPLES = (TARGET_SAMPLE_RATE * FRAME_MS) / 1000; // 1600 muestras = 3200 bytes

/**
 * Baja la frecuencia promediando las muestras de cada intervalo (filtro
 * anti-alias sencillo). Guarda estado entre llamadas: el micrófono entrega
 * bloques de 128 muestras y los intervalos no coinciden con los bloques.
 * @returns {(input: Float32Array) => Float32Array}
 */
export function createDownsampler(inputRate, outputRate = TARGET_SAMPLE_RATE) {
  if (inputRate < outputRate) throw new Error(`Frecuencia de entrada ${inputRate} menor que ${outputRate}`);
  const ratio = inputRate / outputRate;
  let accumulated = 0;
  let count = 0;
  let position = 0; // muestras de entrada consumidas desde el último límite
  return (input) => {
    const out = new Float32Array(Math.ceil(input.length / ratio) + 1);
    let written = 0;
    for (let i = 0; i < input.length; i += 1) {
      accumulated += input[i];
      count += 1;
      position += 1;
      if (position >= ratio) {
        out[written++] = accumulated / count;
        accumulated = 0;
        count = 0;
        position -= ratio;
      }
    }
    return out.subarray(0, written);
  };
}

/** Float32 [-1, 1] → Int16 (con recorte: un pico no da la vuelta). */
export function floatToPcm16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Int16 → Float32, para reproducir el audio del asistente. */
export function pcm16ToFloat32(samples) {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = samples[i] / 0x8000;
  return out;
}

/** Nivel RMS (0 a 1) de un bloque de muestras Float32: para el medidor del micrófono. */
export function rmsLevel(samples) {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/**
 * Junta muestras en tramas EXACTAS de FRAME_SAMPLES y entrega cada trama como
 * PCM16 (ArrayBuffer de 3200 bytes) junto con su nivel.
 * @param {(frame: ArrayBuffer, level: number) => void} onFrame
 */
export function createFramer(onFrame, frameSamples = FRAME_SAMPLES) {
  let buffer = new Float32Array(frameSamples);
  let filled = 0;
  return (samples) => {
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(frameSamples - filled, samples.length - offset);
      buffer.set(samples.subarray(offset, offset + take), filled);
      filled += take;
      offset += take;
      if (filled === frameSamples) {
        onFrame(floatToPcm16(buffer).buffer, rmsLevel(buffer));
        buffer = new Float32Array(frameSamples);
        filled = 0;
      }
    }
  };
}
