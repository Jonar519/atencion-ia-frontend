/* global AudioWorkletProcessor, registerProcessor, sampleRate */
import { createDownsampler, createFramer } from "./pcm.js";

/**
 * AudioWorklet (hilo de audio del navegador): recibe el micrófono en bloques
 * de 128 muestras Float32, lo baja a 16 kHz y entrega al hilo principal tramas
 * PCM16 de 100 ms con su nivel. Correr aquí (y no en el hilo principal) evita
 * cortes de audio cuando la página está ocupada.
 */
class Pcm16Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.downsample = createDownsampler(sampleRate);
    this.frame = createFramer((frame, level) => this.port.postMessage({ frame, level }, [frame]));
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) this.frame(this.downsample(channel));
    return true;
  }
}

registerProcessor("pcm16-capture", Pcm16Capture);
