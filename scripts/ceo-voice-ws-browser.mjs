import { installVoiceAuditWorklet } from './ceo-voice-ws-worklet.mjs';

export async function runVoiceWebSocketBrowser(page, {
  wsPath, wavBase64, timeoutMs = 22_000, trailingSilenceMs = 850,
}) {
  const origin = new URL(page.url());
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || !['http:', 'https:'].includes(origin.protocol)) {
    throw new Error('Voice audit requires a loopback browser page.');
  }
  if (!wsPath.startsWith('/') || wsPath.startsWith('//') || new URL(wsPath, origin).origin !== origin.origin) {
    throw new Error('Voice audit requires a same-origin WebSocket path.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000 ||
      !Number.isFinite(trailingSilenceMs) || trailingSilenceMs < 0 || trailingSilenceMs > 5_000) {
    throw new Error('Invalid voice audit timing settings.');
  }

  return page.evaluate(runBrowser, {
    origin: origin.origin, wsPath, wavBase64, timeoutMs, trailingSilenceMs,
    worklet: `(${installVoiceAuditWorklet.toString()})();`,
  });
}

async function runBrowser({ origin, wsPath, wavBase64, timeoutMs, trailingSilenceMs, worklet }) {
  const rate = 24_000;
  const target = new URL(wsPath, location.href);
  if (location.origin !== origin || target.origin !== origin) throw new Error('Browser audit origin changed.');
  const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  if (!littleEndian) throw new Error('PCM loopback requires little-endian browser audio.');
  const context = new AudioContext({ sampleRate: rate, latencyHint: 'interactive' });
  const moduleUrl = URL.createObjectURL(new Blob([worklet], { type: 'text/javascript' }));
  let node;
  let source;
  let socket;
  let timeout;
  let fallback;
  let startup;
  try {
    await Promise.race([
      context.audioWorklet.addModule(moduleUrl).then(() => context.resume()),
      new Promise((_, reject) => { startup = setTimeout(() => reject(new Error('Browser audio could not start.')), 5_000); }),
    ]);
    clearTimeout(startup);
    if (context.sampleRate !== rate) throw new Error('Browser did not use 24 kHz audio.');
    const bytes = Uint8Array.from(atob(wavBase64), (character) => character.charCodeAt(0));
    const fixture = await context.decodeAudioData(bytes.buffer);
    if (fixture.numberOfChannels > 2 || fixture.length / rate > 30) throw new Error('Unsupported audit fixture.');
    const channels = Array.from({ length: fixture.numberOfChannels }, (_, channel) => fixture.getChannelData(channel));
    let lastVoice = fixture.length - 1;
    const amplitude = (index) => Math.abs(channels.reduce((sum, samples) => sum + samples[index], 0) / channels.length);
    while (lastVoice >= 0 && amplitude(lastVoice) < 0.005) lastVoice -= 1;
    if (lastVoice < 0) throw new Error('The audit fixture has no voiced samples.');

    node = new AudioWorkletNode(context, 'voice-audit', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit',
    });
    node.connect(context.destination);
    source = context.createBufferSource();
    source.buffer = fixture;
    source.connect(node);

    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(target);
    socket.binaryType = 'arraybuffer';
    const results = [];
    const recorded = [];
    let speechEndFrame;
    let fixtureEndFrame;
    let firstPacketFrame;
    let firstAudibleFrame;
    let receivedBytes = 0;
    let endedBy;
    let underrunFrames;
    let inputEnded = false;
    let outputDrained = false;
    let cutInput = false;

    await new Promise((resolve, reject) => {
      function settle() {
        if (outputDrained && (inputEnded || cutInput || fixtureEndFrame === undefined)) resolve();
      }

      function finish(reason, cut = false) {
        if (reason === 'closed' || cut) cutInput = true;
        settle();
        if (endedBy && !cut) return;
        endedBy = endedBy ?? reason;
        node.port.postMessage({ type: 'finish', cut });
        if (cut) fallback = setTimeout(resolve, 1_000);
      }

      node.port.onmessage = ({ data }) => {
        if (data.type === 'drained') {
          underrunFrames = data.underrunFrames;
          outputDrained = true;
        }
        if (data.type === 'recorded') recorded.push(new Uint8Array(data.pcm));
        if (data.type === 'first-audible') firstAudibleFrame = data.frame;
        if (!cutInput && socket.readyState === WebSocket.OPEN) {
          if (data.type === 'capture') socket.send(data.pcm);
          if (data.type === 'input.end') socket.send(JSON.stringify({ type: 'input.end' }));
        }
        if (data.type === 'input.end') inputEnded = true;
        settle();
      };
      socket.onmessage = ({ data }) => {
        if (endedBy) return;
        if (data instanceof ArrayBuffer) {
          if (fixtureEndFrame === undefined || data.byteLength % 2 !== 0) {
            reject(new Error('Unexpected binary PCM frame.'));
            return;
          }
          firstPacketFrame ??= Math.round(context.currentTime * rate);
          receivedBytes += data.byteLength;
          if (receivedBytes > rate * 2 * 40) {
            reject(new Error('Voice audit output is too long.'));
            return;
          }
          node.port.postMessage({ type: 'pcm', pcm: data }, [data]);
          return;
        }
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          reject(new Error('Invalid loopback control message.'));
          return;
        }
        if (event.type === 'ready' && fixtureEndFrame === undefined) {
          const start = Math.ceil((context.currentTime + 0.10) * rate);
          fixtureEndFrame = start + fixture.length;
          speechEndFrame = start + lastVoice + 1;
          node.port.postMessage({
            type: 'schedule', start, stop: fixtureEndFrame + Math.round(trailingSilenceMs * rate / 1000),
          });
          source.start(start / rate);
        } else if (event.type === 'result') {
          results.push(event);
        } else if (event.type === 'playback.clear') {
          node.port.postMessage({ type: 'playback.clear' });
        } else if (event.type === 'done') {
          finish('done');
        } else if (event.type === 'error') {
          reject(new Error('Voice audit relay reported an error.'));
        }
      };
      socket.onerror = () => reject(new Error('Loopback WebSocket failed.'));
      socket.onclose = () => finish('closed');
      timeout = setTimeout(() => finish('timeout', true), timeoutMs);
    });

    const elapsed = (frame, start) => frame === undefined || start === undefined ? null : Math.round((frame - start) * 1000 / rate);
    const recordedBytes = recorded.reduce((sum, chunk) => sum + chunk.length, 0);
    const recordingBase64 = recordedBytes > 0 ? writeVoiceWav(recorded, recordedBytes, rate) : undefined;
    return {
      ready: speechEndFrame !== undefined, endedBy, results, recordingBase64,
      firstAudibleMs: elapsed(firstAudibleFrame, speechEndFrame),
      firstAudibleFromFixtureEndMs: elapsed(firstAudibleFrame, fixtureEndFrame),
      firstPcmArrivalMs: elapsed(firstPacketFrame, speechEndFrame),
      fixtureDurationMs: Math.round(fixture.length * 1000 / rate),
      receivedBytes, recordedBytes, underrunFrames,
    };
  } finally {
    clearTimeout(startup);
    clearTimeout(timeout);
    clearTimeout(fallback);
    socket?.close();
    source?.disconnect();
    node?.disconnect();
    node?.port.close();
    URL.revokeObjectURL(moduleUrl);
    await context.close();
  }

  function writeVoiceWav(chunks, bytes, sampleRate) {
    const samples = new Uint8Array(44 + bytes);
    const view = new DataView(samples.buffer);
    for (const [offset, value] of [[0, 'RIFF'], [8, 'WAVEfmt '], [36, 'data']]) {
      for (let index = 0; index < value.length; index++) samples[offset + index] = value.charCodeAt(index);
    }
    view.setUint32(4, 36 + bytes, true);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(40, bytes, true);
    let offset = 44;
    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    let binary = '';
    for (let start = 0; start < samples.length; start += 16_384) {
      binary += String.fromCharCode(...samples.subarray(start, start + 16_384));
    }
    return btoa(binary);
  }
}
