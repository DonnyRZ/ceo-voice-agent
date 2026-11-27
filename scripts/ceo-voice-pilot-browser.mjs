// Serialized into a dedicated loopback page. The app renders its native WebRTC audio element.
export function installPilotAudio({ captureOutput = true, ...ice } = {}) {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname) || !navigator.mediaDevices) return;
  const Peer = window.RTCPeerConnection;
  const peers = [];
  const transport = [];
  const candidateInfo = ({ type, protocol, relayProtocol }) => ({ type, protocol, relayProtocol });
  window.RTCPeerConnection = class extends Peer {
    constructor(config) {
      super({ ...config, ...ice });
      peers.push(this);
      const snapshot = () => {
        const remote = this.remoteDescription?.sdp.split('\n')
          .filter((line) => line.startsWith('a=candidate:')).map((line) => line.split(' ')[2].toLowerCase()) ?? [];
        transport.push({
          connection: this.connectionState, ice: this.iceConnectionState, remoteProtocols: [...new Set(remote)],
        });
      };
      this.addEventListener('connectionstatechange', snapshot);
      this.addEventListener('iceconnectionstatechange', snapshot);
      this.addEventListener('icecandidate', ({ candidate }) => {
        if (candidate) transport.push({ localCandidate: candidateInfo(candidate) });
      });
    }
  };

  const context = new AudioContext({ sampleRate: 24_000, latencyHint: 'interactive' });
  let microphone;
  let capture;
  let captureError;
  let workletReady;
  const hasAudio = () => capture?.getAudioTracks().some((track) => track.readyState === 'live') ?? false;

  navigator.mediaDevices.getUserMedia = async () => {
    try {
      captureError = undefined;
      const resumed = context.resume();
      if (captureOutput && !hasAudio()) {
        capture?.getTracks().forEach((track) => track.stop());
        capture = await navigator.mediaDevices.getDisplayMedia({
          video: true, audio: { suppressLocalAudioPlayback: false }, preferCurrentTab: true,
          selfBrowserSurface: 'include', monitorTypeSurfaces: 'exclude', systemAudio: 'exclude', windowAudio: 'exclude',
        });
        if (capture.getVideoTracks()[0]?.getSettings().displaySurface !== 'browser' || !capture.getAudioTracks().length) {
          capture.getTracks().forEach((track) => track.stop());
          throw new Error('Capture did not provide tab audio.');
        }
      }
      await resumed;
      workletReady ??= loadWorklet();
      await workletReady;
      microphone = context.createMediaStreamDestination();
      return microphone.stream;
    } catch (error) {
      captureError = error.name + ': ' + error.message;
      throw error;
    }
  };

  async function loadWorklet() {
    const url = URL.createObjectURL(new Blob([`(${installRecorder.toString()})();`], { type: 'text/javascript' }));
    try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
  }

  async function probeIce(timeoutMs = 6_000) {
    const peer = new Peer(ice);
    const candidates = [];
    const errors = [];
    let timeout;
    try {
      peer.createDataChannel('pilot-probe');
      peer.addEventListener('icecandidate', ({ candidate }) => {
        if (candidate) candidates.push(candidateInfo(candidate));
      });
      peer.addEventListener('icecandidateerror', ({ errorCode }) => errors.push(errorCode));
      await peer.setLocalDescription(await peer.createOffer());
      if (peer.iceGatheringState !== 'complete') {
        await new Promise((resolve) => {
          peer.addEventListener('icegatheringstatechange', () => {
            if (peer.iceGatheringState === 'complete') resolve();
          });
          timeout = setTimeout(resolve, timeoutMs);
        });
      }
      return { candidateCount: candidates.length, candidates, errors, state: peer.iceGatheringState };
    } finally {
      clearTimeout(timeout);
      peer.close();
    }
  }

  async function readClip(base64) {
    const data = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const buffer = await context.decodeAudioData(data.buffer);
    if (buffer.duration > 30 || buffer.numberOfChannels > 2) throw new Error('Unsupported pilot WAV.');
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
    function voiced(frame) {
      return channels.some((samples) => Math.abs(samples[frame]) >= 0.005);
    }
    let first = 0;
    let last = buffer.length - 1;
    while (first <= last && !voiced(first)) first += 1;
    if (first > last) throw new Error('Pilot WAV is silent.');
    while (!voiced(last)) last -= 1;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(microphone);
    return { source, first, last, length: buffer.length };
  }

  function playPulseMarker(frame) {
    const rate = context.sampleRate;
    const toneFrames = Math.round(rate * 0.08);
    const gapFrames = Math.round(rate * 0.02);
    const marker = context.createBuffer(1, toneFrames * 2 + gapFrames, rate);
    const channel = marker.getChannelData(0);
    for (const [part, frequency] of [1817, 2939].entries()) {
      const offset = part * (toneFrames + gapFrames);
      for (let index = 0; index < toneFrames; index++) {
        const fade = Math.min(1, index / (rate * 0.004), (toneFrames - 1 - index) / (rate * 0.004));
        channel[offset + index] = 0.7 * fade * Math.sin(2 * Math.PI * frequency * index / rate);
      }
    }
    const source = context.createBufferSource();
    source.buffer = marker;
    // The marker enters the isolated browser output only. The synthetic microphone has its own destination.
    source.connect(context.destination);
    source.onended = () => source.disconnect();
    source.start(frame / rate);
  }

  async function speak(base64, listenMs = 15_000, { interrupt, revokeDelayMs, pulseSync } = {}) {
    if (!microphone || (captureOutput && !hasAudio())) throw new Error('Pilot tab capture or microphone is unavailable.');
    if (!Number.isFinite(listenMs) || listenMs <= 0 || listenMs > 30_000
      || interrupt && (!Number.isFinite(interrupt.delayMs) || interrupt.delayMs < 0 || interrupt.delayMs > 10_000)
      || revokeDelayMs !== undefined && (!Number.isFinite(revokeDelayMs) || revokeDelayMs < 0
        || revokeDelayMs > listenMs || typeof window.voicePilotRevoke !== 'function')) {
      throw new Error('Invalid pilot timing.');
    }
    const clip = await readClip(base64);
    const next = interrupt ? await readClip(interrupt.base64) : undefined;
    const sampleRate = context.sampleRate;
    const output = captureOutput ? context.createMediaStreamSource(capture) : context.createConstantSource();
    if (!captureOutput) {
      output.offset.value = 0;
      output.start();
    }
    pulseSync = captureOutput && pulseSync;
    const recordingStartFrame = Math.ceil(context.currentTime * sampleRate) + Math.round(sampleRate * (pulseSync ? 0.8 : 0.25));
    const pulseSyncFrame = pulseSync ? recordingStartFrame - Math.round(sampleRate * 0.55) : null;
    const speechStartFrame = recordingStartFrame + clip.first;
    const speechEndFrame = recordingStartFrame + clip.last;
    const interruptionStartFrame = next ? speechEndFrame + Math.round(interrupt.delayMs * sampleRate / 1000) : null;
    const nextStart = next ? Math.max(recordingStartFrame, interruptionStartFrame - next.first) : null;
    const interruptionEndFrame = next ? nextStart + next.last : null;
    const lastInputFrame = Math.max(recordingStartFrame + clip.length, next ? nextStart + next.length : 0);
    const stopFrame = lastInputFrame + Math.round(listenMs * sampleRate / 1000);
    const node = new AudioWorkletNode(context, 'pilot-tab-recorder', {
      processorOptions: { startFrame: recordingStartFrame, stopFrame },
      outputChannelCount: [1],
    });
    // The recorder emits silence into the audio graph. Browser tab output continues to render normally.
    output.connect(node).connect(context.destination);
    let timeout;
    let revokeTimer;
    let revokedAtFrame = null;
    try {
      const completed = new Promise((resolve, reject) => {
        node.port.onmessage = ({ data }) => resolve(data);
        node.onprocessorerror = () => reject(new Error('Tab audio worklet failed.'));
        timeout = setTimeout(() => reject(new Error('Tab audio clock did not complete.')),
          (stopFrame - recordingStartFrame) * 1000 / sampleRate + 15_000);
      });
      const revocation = revokeDelayMs === undefined ? undefined : new Promise((resolve, reject) => {
        const delay = (speechEndFrame / sampleRate - context.currentTime) * 1000 + revokeDelayMs;
        revokeTimer = setTimeout(async () => {
          try {
            await window.voicePilotRevoke();
            revokedAtFrame = Math.round(context.currentTime * sampleRate);
            resolve();
          } catch (error) { reject(error); }
        }, Math.max(0, delay));
      });
      if (pulseSyncFrame !== null) playPulseMarker(pulseSyncFrame);
      clip.source.start(recordingStartFrame / sampleRate);
      if (next) next.source.start(nextStart / sampleRate);
      const [{ pcm, firstAudibleFrame, lastAudibleFrame }] = await Promise.all([completed, revocation]);
      const elapsed = (frame, start) => frame === null ? null : Math.round((frame - start) * 1000 / sampleRate);
      return {
        firstAudibleMs: elapsed(firstAudibleFrame, speechEndFrame),
        firstAudibleFromSpeechStartMs: elapsed(firstAudibleFrame, speechStartFrame),
        recording: firstAudibleFrame === null ? undefined : wavBase64(pcm, sampleRate),
        connection: peers.at(-1)?.connectionState,
        sampleRate, recordingStartFrame, pulseSyncFrame, recordingEndFrame: stopFrame, speechStartFrame, speechEndFrame,
        interruptionStartFrame: next ? nextStart + next.first : null, interruptionEndFrame,
        revokedAtFrame, firstAudibleFrame, lastAudibleFrame,
        captureMode: captureOutput ? 'browser-tab-audio' : 'input-clock-only',
      };
    } finally {
      clearTimeout(timeout);
      clearTimeout(revokeTimer);
      clip.source.disconnect();
      next?.source.disconnect();
      if (!captureOutput) output.stop();
      output.disconnect();
      node.disconnect();
      node.port.close();
    }
  }

  function wavBase64(pcm, rate) {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    for (const [offset, tag] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) {
      for (let index = 0; index < tag.length; index++) view.setUint8(offset + index, tag.charCodeAt(index));
    }
    for (const [offset, value] of [[4, pcm.byteLength + 36], [16, 16], [24, rate], [28, rate * 2], [40, pcm.byteLength]]) {
      view.setUint32(offset, value, true);
    }
    for (const [offset, value] of [[20, 1], [22, 1], [32, 2], [34, 16]]) view.setUint16(offset, value, true);
    const bytes = new Uint8Array(header.byteLength + pcm.byteLength);
    bytes.set(new Uint8Array(header));
    bytes.set(new Uint8Array(pcm), header.byteLength);
    return bytes.toBase64();
  }

  async function mediaStats() {
    const element = document.querySelector('audio');
    const peer = peers.at(-1);
    const playback = element && {
      muted: element.muted, paused: element.paused, ended: element.ended, volume: element.volume,
      currentTime: element.currentTime, readyState: element.readyState, networkState: element.networkState,
      errorCode: element.error?.code ?? null,
      hasStream: element.srcObject instanceof MediaStream,
    };
    const trackState = ({ readyState, enabled, muted }) => ({ readyState, enabled, muted });
    const tracks = (element?.srcObject instanceof MediaStream ? element.srcObject.getAudioTracks() : []).map(trackState);
    const receiverTracks = peer?.getReceivers().map(({ track }) => track)
      .filter(({ kind }) => kind === 'audio').map(trackState) ?? [];
    const inboundAudio = [];
    const outboundAudio = [];
    const remoteInboundAudio = [];
    const inputSources = [];
    let statsAvailable = false;
    try {
      const stats = await peer?.getStats();
      for (const record of stats?.values() ?? []) {
        if ((record.kind ?? record.mediaType) !== 'audio') continue;
        if (record.type === 'outbound-rtp') {
          const { id, ssrc, packetsSent, bytesSent, totalSamplesSent, totalPacketSendDelay, active, mediaSourceId, codecId } = record;
          const codec = stats.get(codecId);
          outboundAudio.push({ id, ssrc, packetsSent, bytesSent, totalSamplesSent, totalPacketSendDelay, active, mediaSourceId,
            codec: codec && { mimeType: codec.mimeType, clockRate: codec.clockRate, channels: codec.channels } });
        }
        if (record.type === 'remote-inbound-rtp') {
          const { localId, packetsLost, fractionLost, jitter, roundTripTime, roundTripTimeMeasurements } = record;
          remoteInboundAudio.push({ localId, packetsLost, fractionLost, jitter, roundTripTime, roundTripTimeMeasurements });
        }
        if (record.type === 'media-source') {
          const { id, audioLevel, totalAudioEnergy, totalSamplesDuration } = record;
          inputSources.push({ id, audioLevel, totalAudioEnergy, totalSamplesDuration });
        }
        if (record.type !== 'inbound-rtp') continue;
        const {
          packetsReceived, packetsLost, bytesReceived, audioLevel, totalAudioEnergy, totalSamplesReceived,
          jitter, jitterBufferDelay, jitterBufferEmittedCount, concealedSamples,
        } = record;
        inboundAudio.push({
          packetsReceived, packetsLost, bytesReceived, audioLevel, totalAudioEnergy, totalSamplesReceived,
          jitter, jitterBufferDelay, jitterBufferEmittedCount, concealedSamples,
        });
      }
      statsAvailable = !!stats;
    } catch {
      // A peer can close between looking it up and reading its report.
    }
    return {
      playback, tracks, receiverTracks, inboundAudio, outboundAudio, remoteInboundAudio, inputSources,
      inputSampleRate: context.sampleRate, statsAvailable, peerConnection: peer?.connectionState,
      iceConnection: peer?.iceConnectionState, capture: { active: hasAudio(), error: captureError },
    };
  }

  window.voicePilot = {
    states: () => peers.map((peer) => peer.connectionState), transport: () => transport,
    captureStatus: () => ({ active: hasAudio(), error: captureError }), probeIce, mediaStats, speak,
  };

  function installRecorder() {
    class TabRecorder extends AudioWorkletProcessor {
      constructor({ processorOptions: { startFrame, stopFrame } }) {
        super();
        this.start = startFrame;
        this.stop = stopFrame;
        this.pcm = new Int16Array(stopFrame - startFrame);
        this.first = null;
        this.last = null;
      }

      process(inputs, outputs) {
        const input = inputs[0] ?? [];
        const frames = outputs[0][0].length;
        const from = Math.max(currentFrame, this.start);
        const to = Math.min(currentFrame + frames, this.stop);
        for (let frame = from; frame < to; frame++) {
          const offset = frame - currentFrame;
          let signal = 0;
          for (const samples of input) signal += samples[offset] / input.length;
          const clipped = Math.max(-1, Math.min(1, signal));
          this.pcm[frame - this.start] = Math.round(clipped * 32767);
          if (Math.abs(signal) >= 0.015) {
            this.first ??= frame;
            this.last = frame;
          }
        }
        if (currentFrame + frames < this.stop) return true;
        const pcm = this.pcm.buffer;
        this.port.postMessage({ pcm, firstAudibleFrame: this.first, lastAudibleFrame: this.last }, [pcm]);
        return false;
      }
    }
    registerProcessor('pilot-tab-recorder', TabRecorder);
  }
}
