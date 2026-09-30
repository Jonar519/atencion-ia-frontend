import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Genera el audio que Chromium usa como MICRÓFONO FALSO en la prueba de voz
 * (--use-file-for-fake-audio-capture). Chromium lo repite en bucle.
 *
 * Imita el ritmo del habla: ~1,2 s de "sílabas" (tonos cortos de frecuencia
 * variable, con envolvente) y ~1,4 s de silencio. El reconocimiento simulado
 * del servidor detecta voz por energía y cierra la frase tras 0,7 s de
 * silencio: cada vuelta del archivo es una frase. (Un tono fijo y constante
 * lo podría atenuar la supresión de ruido del navegador.)
 */
export const FAKE_MIC_WAV = path.join(path.dirname(fileURLToPath(import.meta.url)), ".generated", "fake-mic.wav");

function wav(samples, sampleRate) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export default function globalSetup() {
  const rate = 48_000;
  const samples = [];
  const syllables = [180, 240, 210, 300, 160, 260, 220, 190];
  for (const frequency of syllables) {
    const length = Math.round(0.15 * rate);
    for (let i = 0; i < length; i += 1) {
      const envelope = Math.sin((Math.PI * i) / length); // sube y baja como una sílaba
      const vibrato = 1 + 0.05 * Math.sin((2 * Math.PI * 5 * i) / rate);
      samples.push(0.45 * envelope * Math.sin((2 * Math.PI * frequency * vibrato * i) / rate));
    }
  }
  samples.push(...new Array(Math.round(1.4 * rate)).fill(0));
  fs.mkdirSync(path.dirname(FAKE_MIC_WAV), { recursive: true });
  fs.writeFileSync(FAKE_MIC_WAV, wav(samples, rate));
}
