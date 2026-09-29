import { pcm16ToFloat32, TARGET_SAMPLE_RATE } from "./pcm.js";

/**
 * Reproduce la voz del asistente: el servidor manda la respuesta como tramas
 * PCM16 de 16 kHz (entre "tts.start" y "tts.end"). Cada trama se agenda justo
 * después de la anterior en el reloj del AudioContext: suena continuo aunque
 * las tramas lleguen en ráfaga o con pausas.
 *
 * onIdle() avisa cuando terminó de sonar TODO lo agendado: la llamada vuelve
 * a enviar el micrófono (mientras el asistente habla, el micrófono no se
 * envía, para que su propia voz no se transcriba como si fuera el cliente).
 */
export function createAudioPlayer({ audioContext, sampleRate = TARGET_SAMPLE_RATE, onIdle = () => {} }) {
  const sources = new Set();
  let nextTime = 0;
  let expectingMore = false;

  function checkIdle() {
    if (sources.size === 0 && !expectingMore) onIdle();
  }

  return {
    /** Empieza una respuesta (llegarán tramas hasta end()). */
    begin() {
      expectingMore = true;
    },
    /** Agenda una trama PCM16 (ArrayBuffer). */
    enqueue(arrayBuffer) {
      const samples = pcm16ToFloat32(new Int16Array(arrayBuffer));
      if (samples.length === 0) return;
      const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
      buffer.getChannelData(0).set(samples);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      nextTime = Math.max(nextTime, audioContext.currentTime);
      source.start(nextTime);
      nextTime += samples.length / sampleRate;
      sources.add(source);
      source.onended = () => {
        sources.delete(source);
        checkIdle();
      };
    },
    /** Ya llegó la última trama de esta respuesta. */
    end() {
      expectingMore = false;
      checkIdle();
    },
    /** Corta de inmediato (el cliente interrumpe, cuelga o llega un asesor). */
    stop() {
      expectingMore = false;
      for (const source of sources) {
        source.onended = null;
        try {
          source.stop();
        } catch {
          // ya había terminado
        }
      }
      sources.clear();
      nextTime = 0;
      onIdle();
    },
    get playing() {
      return sources.size > 0 || expectingMore;
    },
  };
}
