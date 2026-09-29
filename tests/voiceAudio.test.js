import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDownsampler,
  createFramer,
  floatToPcm16,
  pcm16ToFloat32,
  rmsLevel,
  FRAME_SAMPLES,
} from "../src/voice/pcm.js";
import { createAudioPlayer } from "../src/voice/audioPlayer.js";
import { createPeerLink } from "../src/voice/peerLink.js";
import { VOICE_LEVEL_THRESHOLD } from "../src/components/callBar.js";
import { FakeAudioContext, FakeRTCPeerConnection, fakeMicrophone } from "./support/fakeAudio.js";

/** Micrófono "real" simulado: bloques de 128 muestras (lo que entrega un AudioWorklet). */
function feedInBlocks(process, totalSamples, value = (i) => Math.sin(i / 10) * 0.3) {
  let produced = 0;
  let index = 0;
  while (produced < totalSamples) {
    const block = new Float32Array(Math.min(128, totalSamples - produced));
    for (let i = 0; i < block.length; i += 1) block[i] = value(index++);
    process(block);
    produced += block.length;
  }
}

describe("conversión del micrófono a PCM16 de 16 kHz", () => {
  it.each([48_000, 44_100, 16_000])(
    "1 s a %i Hz produce exactamente 1 s a 16 kHz: 10 tramas de 3200 bytes (lo que el servidor admite en tiempo real)",
    (rate) => {
      const frames = [];
      const framer = createFramer((frame, level) => frames.push({ bytes: frame.byteLength, level }));
      const downsample = createDownsampler(rate);
      // 1 s + 5 ms: con frecuencias no enteras (44,1 kHz) la última muestra queda pendiente
      // por redondeo; lo que importa es el CAUDAL (10 tramas/s), no la muestra del borde.
      feedInBlocks((block) => framer(downsample(block)), Math.round(rate * 1.005));
      expect(frames).toHaveLength(10);
      expect(frames.every((f) => f.bytes === FRAME_SAMPLES * 2)).toBe(true);
    }
  );

  it("a 44,1 kHz, 10 s de micrófono dan 10 s de audio (±1 muestra): no se acumula desfase", () => {
    const downsample = createDownsampler(44_100);
    let samples = 0;
    feedInBlocks((block) => (samples += downsample(block).length), 441_000);
    expect(Math.abs(samples - 160_000)).toBeLessThanOrEqual(1);
  });

  it("promedia (no descarta) muestras: una señal constante conserva su valor", () => {
    const downsample = createDownsampler(48_000);
    const out = downsample(new Float32Array(300).fill(0.5));
    expect(out).toHaveLength(100);
    expect(out.every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true);
  });

  it("recorta los picos y convierte ida y vuelta", () => {
    expect([...floatToPcm16(new Float32Array([2, -2, 0, 0.5]))]).toEqual([32767, -32768, 0, 16384]);
    const back = pcm16ToFloat32(new Int16Array([16384, -16384]));
    expect(back[0]).toBeCloseTo(0.5, 3);
    expect(back[1]).toBeCloseTo(-0.5, 3);
  });

  it("el medidor usa el MISMO umbral que el reconocimiento simulado: voz sí, silencio no", () => {
    const voice = new Float32Array(1600).map((_, i) => Math.sin(i / 5) * 0.2);
    expect(rmsLevel(voice)).toBeGreaterThan(VOICE_LEVEL_THRESHOLD);
    expect(rmsLevel(new Float32Array(1600).fill(0.001))).toBeLessThan(VOICE_LEVEL_THRESHOLD);
    expect(VOICE_LEVEL_THRESHOLD).toBe(0.02); // backend: services/voice/mock.provider.ts
  });
});

describe("reproductor de la voz del asistente", () => {
  it("agenda las tramas una tras otra y avisa 'terminó' solo cuando sonó TODO", () => {
    const context = new FakeAudioContext();
    const onIdle = vi.fn();
    const player = createAudioPlayer({ audioContext: context, onIdle });
    player.begin();
    for (let i = 0; i < 3; i += 1) player.enqueue(new Int16Array(1600).buffer);
    expect(context.sources.map((s) => s.startedAt)).toEqual([0, 0.1, 0.2]);
    context.finishPlayback();
    expect(onIdle).not.toHaveBeenCalled(); // faltaba "tts.end": pueden llegar más tramas
    player.end();
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(player.playing).toBe(false);
  });

  it("stop() corta todo lo que suena (interrumpir, colgar)", () => {
    const context = new FakeAudioContext();
    const player = createAudioPlayer({ audioContext: context });
    player.begin();
    player.enqueue(new Int16Array(1600).buffer);
    player.enqueue(new Int16Array(1600).buffer);
    player.stop();
    expect(context.sources.every((s) => s.stopped)).toBe(true);
    expect(player.playing).toBe(false);
  });
});

describe("WebRTC entre cliente y agente", () => {
  beforeEach(() => FakeRTCPeerConnection.reset());

  function link(role) {
    const signals = [];
    const remote = vi.fn();
    const mic = fakeMicrophone();
    const peer = createPeerLink({
      role,
      localStream: mic.stream,
      iceServers: [{ urls: "stun:stun.example.org" }],
      sendSignal: (signal) => signals.push(signal),
      onRemoteStream: remote,
      RTCPeerConnectionImpl: FakeRTCPeerConnection,
    });
    return { peer, signals, remote, mic };
  }

  it("SOLO el agente ofrece, cuando el cliente está presente; el cliente responde", async () => {
    const customer = link("customer");
    await customer.peer.onPeer(true);
    expect(customer.signals).toEqual([]); // el cliente espera la oferta
    expect(FakeRTCPeerConnection.instances).toHaveLength(0);

    const agent = link("agent");
    await agent.peer.onPeer(true);
    expect(agent.signals).toEqual([{ type: "offer", sdp: "v=0 oferta" }]);
    const agentPc = FakeRTCPeerConnection.last();
    expect(agentPc.tracks).toEqual([agent.mic.track]); // envía su micrófono
    expect(agentPc.config.iceServers).toEqual([{ urls: "stun:stun.example.org" }]);

    await customer.peer.onSignal(agent.signals[0]);
    expect(customer.signals).toEqual([{ type: "answer", sdp: "v=0 respuesta" }]);
    await agent.peer.onSignal(customer.signals[0]);
    expect(agentPc.remoteDescription).toEqual({ type: "answer", sdp: "v=0 respuesta" });
  });

  it("los candidatos que llegan ANTES de la descripción remota se guardan y se agregan después", async () => {
    const customer = link("customer");
    const candidate = { candidate: "candidate:1 1 udp 1 10.0.0.2 5000 typ host", sdpMid: "0", sdpMLineIndex: 0 };
    await customer.peer.onSignal({ type: "candidate", candidate });
    await customer.peer.onSignal({ type: "offer", sdp: "v=0 oferta" });
    expect(FakeRTCPeerConnection.last().candidates).toEqual([candidate]);
  });

  it("agente: un candidato del cliente que llega ANTES de su respuesta no se pierde", async () => {
    const agent = link("agent");
    await agent.peer.onPeer(true); // ya hay conexión, pero todavía sin descripción remota
    const candidate = { candidate: "candidate:3 1 udp 1 10.0.0.3 5000 typ host", sdpMid: "0", sdpMLineIndex: 0 };
    await agent.peer.onSignal({ type: "candidate", candidate });
    await agent.peer.onSignal({ type: "answer", sdp: "v=0 respuesta" });
    expect(FakeRTCPeerConnection.last().candidates).toEqual([candidate]);
  });

  it("envía candidatos solo con los campos que el servidor acepta", async () => {
    const agent = link("agent");
    await agent.peer.onPeer(true);
    FakeRTCPeerConnection.last().emitCandidate({
      candidate: "candidate:2",
      sdpMid: "0",
      sdpMLineIndex: 0,
      usernameFragment: "abc",
      extra: "no",
    });
    expect(agent.signals.at(-1)).toEqual({
      type: "candidate",
      candidate: { candidate: "candidate:2", sdpMid: "0", sdpMLineIndex: 0, usernameFragment: "abc" },
    });
  });

  it("silenciar apaga la pista hacia el otro; si el otro se va, la conexión se cierra", async () => {
    const agent = link("agent");
    await agent.peer.onPeer(true);
    agent.peer.setMuted(true);
    expect(agent.mic.track.enabled).toBe(false);
    const pc = FakeRTCPeerConnection.last();
    await agent.peer.onPeer(false);
    expect(pc.closed).toBe(true);
  });

  it("el audio remoto se entrega a la vista", async () => {
    const customer = link("customer");
    await customer.peer.onSignal({ type: "offer", sdp: "v=0" });
    const stream = { id: "remoto" };
    FakeRTCPeerConnection.last().ontrack({ streams: [stream] });
    expect(customer.remote).toHaveBeenCalledWith(stream);
  });
});
