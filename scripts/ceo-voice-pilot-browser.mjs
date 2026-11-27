// This function runs inside the browser. Only the microphone fixture is replaced.
export function installPilotAudio() {
  const peers = [];
  const transport = [];
  const Peer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Peer {
    constructor(...args) {
      super(...args);
      peers.push(this);
      const snapshot = () => {
        const remoteProtocols = this.remoteDescription?.sdp.split('\n')
          .filter((line) => line.startsWith('a=candidate:')).map((line) => line.split(' ')[2].toLowerCase());
        transport.push({
          connection: this.connectionState,
          ice: this.iceConnectionState,
          remoteProtocols: [...new Set(remoteProtocols)],
        });
      };
      this.addEventListener('connectionstatechange', snapshot);
      this.addEventListener('iceconnectionstatechange', snapshot);
    }
  };
  const context = new AudioContext();
  let microphone;
  navigator.mediaDevices.getUserMedia = async () => {
    await context.resume();
    microphone = context.createMediaStreamDestination();
    return microphone.stream;
  };

  window.voicePilot = {
    states: () => peers.map((peer) => peer.connectionState),
    transport: () => transport,
    async speak(base64, listenMs) {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const buffer = await context.decodeAudioData(bytes.buffer);
      const samples = buffer.getChannelData(0);
      let lastVoice = samples.length - 1;
      while (lastVoice > 0 && Math.abs(samples[lastVoice]) < 0.005) lastVoice -= 1;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(microphone);
      const startDelay = 0.04;
      const fixtureEnd = performance.now() + (startDelay + lastVoice / buffer.sampleRate) * 1000;
      source.start(context.currentTime + startDelay);

      let remote;
      let analyser;
      let recorder;
      const chunks = [];
      const wave = new Float32Array(1024);
      let heardAt;
      const element = document.querySelector('audio');
      const interval = setInterval(() => {
        if (!element || element.muted || element.paused || !element.srcObject) return;
        if (!analyser) {
          remote = context.createMediaStreamSource(element.srcObject);
          analyser = context.createAnalyser();
          analyser.fftSize = wave.length;
          remote.connect(analyser);
          recorder = new MediaRecorder(element.srcObject, { mimeType: 'audio/webm;codecs=opus' });
          recorder.ondataavailable = (event) => chunks.push(event.data);
          recorder.start();
        }
        analyser.getFloatTimeDomainData(wave);
        if (heardAt === undefined && wave.some((value) => Math.abs(value) > 0.015)) {
          heardAt = performance.now();
        }
      }, 10);
      await new Promise((resolve) => setTimeout(resolve, buffer.duration * 1000 + listenMs));
      clearInterval(interval);
      source.disconnect();
      remote?.disconnect();
      let recording;
      if (recorder?.state === 'recording') {
        await new Promise((resolve) => {
          recorder.onstop = resolve;
          recorder.stop();
        });
        const blob = new Blob(chunks, { type: recorder.mimeType });
        const output = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (const byte of output) binary += String.fromCharCode(byte);
        recording = btoa(binary);
      }

      return {
        firstAudibleMs: heardAt === undefined ? null : Math.round(heardAt - fixtureEnd),
        recording,
        connection: peers.at(-1)?.connectionState,
      };
    },
  };
}
