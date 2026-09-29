/**
 * Audio en vivo entre CLIENTE y AGENTE, de navegador a navegador (WebRTC).
 * El servidor solo relea la señalización por el WebSocket de voz (backend:
 * src/realtime/voiceServer.ts); este audio nunca pasa por él.
 *
 * Reglas:
 *  - SOLO el agente crea la oferta, cuando sabe que el cliente está en la
 *    llamada ("peer" presente). Si ambos ofrecieran a la vez ("glare"), la
 *    negociación se trabaría.
 *  - Los candidatos ICE que llegan antes que la descripción remota se guardan
 *    y se agregan después (agregarlos antes lanza un error en el navegador).
 *  - Si el otro se va, la conexión se cierra; si vuelve, se negocia de nuevo.
 */

/**
 * @param {object} options
 * @param {"customer"|"agent"} options.role
 * @param {MediaStream} options.localStream     el micrófono (se envía al otro)
 * @param {RTCIceServer[]} options.iceServers
 * @param {(signal: object) => void} options.sendSignal
 * @param {(stream: MediaStream) => void} options.onRemoteStream
 * @param {(state: string) => void} [options.onState]
 */
export function createPeerLink({
  role,
  localStream,
  iceServers = [],
  sendSignal,
  onRemoteStream,
  onState = () => {},
  RTCPeerConnectionImpl = globalThis.RTCPeerConnection,
}) {
  let pc = null;
  let pendingCandidates = [];
  let muted = false;

  function open() {
    close();
    const connection = new RTCPeerConnectionImpl({ iceServers });
    pc = connection;
    for (const track of localStream.getAudioTracks()) {
      track.enabled = !muted;
      connection.addTrack(track, localStream);
    }
    connection.onicecandidate = (event) => {
      if (event.candidate) sendSignal({ type: "candidate", candidate: candidateJson(event.candidate) });
    };
    connection.ontrack = (event) => {
      if (pc === connection) onRemoteStream(event.streams[0]);
    };
    connection.onconnectionstatechange = () => {
      if (pc === connection) onState(connection.connectionState);
    };
    onState("connecting");
    return connection;
  }

  function close() {
    if (!pc) return;
    const old = pc;
    pc = null;
    pendingCandidates = [];
    old.onicecandidate = null;
    old.ontrack = null;
    old.onconnectionstatechange = null;
    old.close();
  }

  async function flushCandidates(connection) {
    const queued = pendingCandidates;
    pendingCandidates = [];
    for (const candidate of queued) await connection.addIceCandidate(candidate).catch(() => {});
  }

  return {
    /** El otro participante entró (o salió) de la llamada. */
    async onPeer(present) {
      if (!present) {
        close();
        onState("waiting");
        return;
      }
      if (role !== "agent") return; // el cliente espera la oferta del agente
      const connection = open();
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      sendSignal({ type: "offer", sdp: connection.localDescription.sdp });
    },

    /** Señal que relevó el servidor desde el otro participante. */
    async onSignal(signal) {
      if (signal.type === "offer" && role === "customer") {
        const connection = open();
        await connection.setRemoteDescription({ type: "offer", sdp: signal.sdp });
        await flushCandidates(connection);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        sendSignal({ type: "answer", sdp: connection.localDescription.sdp });
        return;
      }
      if (signal.type === "answer" && role === "agent" && pc) {
        const connection = pc;
        await connection.setRemoteDescription({ type: "answer", sdp: signal.sdp });
        await flushCandidates(connection);
        return;
      }
      if (signal.type === "candidate" && signal.candidate) {
        if (pc?.remoteDescription) await pc.addIceCandidate(signal.candidate).catch(() => {});
        else pendingCandidates.push(signal.candidate);
      }
    },

    /** Silenciar también corta el audio hacia el otro participante. */
    setMuted(value) {
      muted = value;
      for (const track of localStream.getAudioTracks()) track.enabled = !value;
    },

    close() {
      close();
      onState("closed");
    },
  };
}

/** Solo los campos que el servidor acepta (valida con un esquema estricto). */
function candidateJson(candidate) {
  const json = typeof candidate.toJSON === "function" ? candidate.toJSON() : candidate;
  const out = { candidate: json.candidate ?? "" };
  if (json.sdpMid !== undefined) out.sdpMid = json.sdpMid;
  if (json.sdpMLineIndex !== undefined) out.sdpMLineIndex = json.sdpMLineIndex;
  if (json.usernameFragment !== undefined) out.usernameFragment = json.usernameFragment;
  return out;
}
