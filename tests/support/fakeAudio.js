import { vi } from "vitest";
import { MicrophoneError } from "../../src/voice/microphone.js";

/**
 * Dobles del audio del navegador para jsdom (que no tiene micrófono, Web
 * Audio ni WebRTC): registran lo que hace el código y dejan al test simular
 * al usuario (hablar, negar el permiso) y al otro navegador (WebRTC).
 */

export class FakeTrack {
  kind = "audio";
  enabled = true;
  stopped = false;
  listeners = {};
  addEventListener(type, handler) {
    (this.listeners[type] ??= []).push(handler);
  }
  /** Como el navegador: stop() hecho por la app NO dispara "ended". */
  stop() {
    this.stopped = true;
  }
  /** Simula que el dispositivo se desconectó (esto sí dispara "ended"). */
  unplug() {
    for (const handler of this.listeners.ended ?? []) handler();
  }
}

export function fakeMicrophone() {
  const track = new FakeTrack();
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const mic = {
    stream,
    track,
    onFrame: null,
    onLevel: null,
    start: vi.fn(async (onFrame, onLevel) => {
      mic.onFrame = onFrame;
      mic.onLevel = onLevel;
    }),
    stop: vi.fn(() => track.stop()),
    /** Simula 100 ms de voz: una trama PCM16 de 3200 bytes. */
    speak(level = 0.1) {
      mic.onLevel?.(level);
      mic.onFrame?.(new ArrayBuffer(3200));
    },
  };
  return mic;
}

/** openMicrophone simulado: devuelve el micrófono, o falla como si el usuario negara el permiso. */
export function fakeOpenMicrophone({ deny = false } = {}) {
  const mic = fakeMicrophone();
  const open = vi.fn(async () => {
    if (deny) throw new MicrophoneError("No diste permiso para usar el micrófono.");
    return mic;
  });
  return { open, mic };
}

export class FakeAudioContext {
  static instances = [];
  currentTime = 0;
  destination = {};
  sources = [];
  closed = false;
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createBuffer(_channels, length, sampleRate) {
    const data = new Float32Array(length);
    return { duration: length / sampleRate, length, getChannelData: () => data };
  }
  createBufferSource() {
    const source = {
      buffer: null,
      onended: null,
      startedAt: null,
      stopped: false,
      connect() {},
      start(at) {
        source.startedAt = at;
      },
      stop() {
        source.stopped = true;
      },
    };
    this.sources.push(source);
    return source;
  }
  /** Simula que terminaron de sonar todas las tramas agendadas. */
  finishPlayback() {
    for (const source of [...this.sources]) source.onended?.();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
  static reset() {
    FakeAudioContext.instances = [];
  }
}

export class FakeRTCPeerConnection {
  static instances = [];
  localDescription = null;
  remoteDescription = null;
  tracks = [];
  candidates = [];
  closed = false;
  constructor(config) {
    this.config = config;
    FakeRTCPeerConnection.instances.push(this);
  }
  addTrack(track) {
    this.tracks.push(track);
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0 oferta" };
  }
  async createAnswer() {
    return { type: "answer", sdp: "v=0 respuesta" };
  }
  async setLocalDescription(description) {
    this.localDescription = description;
  }
  async setRemoteDescription(description) {
    this.remoteDescription = description;
  }
  async addIceCandidate(candidate) {
    // Como el navegador: sin descripción remota, agregar un candidato falla.
    if (!this.remoteDescription) throw new Error("InvalidStateError: sin descripción remota");
    this.candidates.push(candidate);
  }
  close() {
    this.closed = true;
  }
  /** Simula que el navegador encontró un candidato ICE local. */
  emitCandidate(candidate) {
    this.onicecandidate?.({ candidate: { toJSON: () => candidate } });
  }
  static last() {
    return FakeRTCPeerConnection.instances.at(-1);
  }
  static reset() {
    FakeRTCPeerConnection.instances = [];
  }
}
