export function monitorVoiceActivity(onSpeech: () => void) {
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  const samples = new Float32Array(analyser.fftSize);
  const silent = context.createGain();
  silent.gain.value = 0;
  analyser.connect(silent).connect(context.destination);
  const ready = context.resume();
  void ready.catch(() => undefined);

  let microphone: MediaStreamAudioSourceNode | undefined;
  let timer: number | undefined;
  let speaking = false;
  let loudSamples = 0;
  let quietSamples = 0;
  function sampleMicrophone() {
    analyser.getFloatTimeDomainData(samples);
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    if (energy / samples.length >= 0.0004) {
      quietSamples = 0;
      loudSamples += 1;
      if (!speaking && loudSamples >= 2) {
        speaking = true;
        onSpeech();
      }
    } else {
      loudSamples = 0;
      quietSamples += 1;
      if (quietSamples >= 8) speaking = false;
    }
  }
  return {
    ready,
    attach(stream: MediaStream) {
      microphone = context.createMediaStreamSource(stream);
      microphone.connect(analyser);
      timer = window.setInterval(sampleMicrophone, 20);
    },
    speaking: () => speaking,
    close() {
      window.clearInterval(timer);
      microphone?.disconnect();
      analyser.disconnect();
      silent.disconnect();
      void context.close().catch(() => undefined);
    },
  };
}
