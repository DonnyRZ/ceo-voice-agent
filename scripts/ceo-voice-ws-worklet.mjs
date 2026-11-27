// Serialized into the local test browser. The audio render clock timestamps both directions.
export function installVoiceAuditWorklet() {
  class VoiceAuditProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.input = null;
      this.inputChunk = new Int16Array(480);
      this.inputCount = 0;
      this.outputChunks = [];
      this.outputOffset = 0;
      this.outputAvailable = 0;
      this.prebuffer = 720;
      this.queuedSince = null;
      this.started = false;
      this.done = false;
      this.drained = false;
      this.first = false;
      this.recorded = new Int16Array(480);
      this.recordedCount = 0;
      this.underrunFrames = 0;
      this.port.onmessage = ({ data }) => {
        if (data.type === 'schedule') this.input = data;
        if (data.type === 'pcm') {
          const samples = new Int16Array(data.pcm);
          if (samples.length > 0) {
            this.outputChunks.push(samples);
            this.outputAvailable += samples.length;
          }
        }
        if (data.type === 'playback.clear') this.clearPlayback();
        if (data.type === 'finish') {
          this.done = true;
          if (data.cut) this.clearPlayback();
        }
      };
    }

    clearPlayback() {
      this.outputChunks.length = 0;
      this.outputOffset = 0;
      this.outputAvailable = 0;
      this.queuedSince = null;
    }

    sendInput() {
      if (this.inputCount === 0) return;
      const pcm = this.inputChunk.slice(0, this.inputCount).buffer;
      this.port.postMessage({ type: 'capture', pcm }, [pcm]);
      this.inputCount = 0;
    }

    capture(input, blockLength) {
      if (!this.input) return;
      const { start, stop } = this.input;
      const from = Math.max(0, start - currentFrame);
      const to = Math.min(blockLength, stop - currentFrame);
      for (let index = from; index < to; index++) {
        const sample = Math.max(-1, Math.min(1, input?.[index] ?? 0));
        this.inputChunk[this.inputCount++] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
        if (this.inputCount === this.inputChunk.length) this.sendInput();
      }
      if (currentFrame + blockLength >= stop) {
        this.sendInput();
        this.input = null;
        this.port.postMessage({ type: 'input.end' });
      }
    }

    recordOutput() {
      if (this.recordedCount === 0) return;
      const pcm = this.recorded.slice(0, this.recordedCount).buffer;
      this.port.postMessage({ type: 'recorded', pcm }, [pcm]);
      this.recordedCount = 0;
    }

    render(output) {
      if (this.drained) return;
      if (!this.started && this.outputAvailable > 0) {
        this.queuedSince ??= currentFrame;
        this.started = this.outputAvailable >= this.prebuffer || this.done || currentFrame - this.queuedSince >= this.prebuffer;
      }
      if (this.started) {
        for (let index = 0; index < output.length; index++) {
          if (this.outputAvailable === 0 && this.done) break;
          let sample = 0;
          if (this.outputAvailable > 0) {
            const head = this.outputChunks[0];
            sample = head[this.outputOffset++];
            this.outputAvailable -= 1;
            if (this.outputOffset === head.length) {
              this.outputChunks.shift();
              this.outputOffset = 0;
            }
          } else {
            this.underrunFrames += 1;
          }
          output[index] = sample / 32768;
          if (!this.first && Math.abs(output[index]) >= 0.015) {
            this.first = true;
            this.port.postMessage({ type: 'first-audible', frame: currentFrame + index });
          }
          this.recorded[this.recordedCount++] = sample;
          if (this.recordedCount === this.recorded.length) this.recordOutput();
        }
      }
      if (this.done && this.outputAvailable === 0) {
        this.recordOutput();
        this.drained = true;
        this.port.postMessage({ type: 'drained', underrunFrames: this.underrunFrames });
      }
    }

    process(inputs, outputs) {
      const output = outputs[0][0];
      this.capture(inputs[0]?.[0], output.length);
      this.render(output);
      return true;
    }
  }

  registerProcessor('voice-audit', VoiceAuditProcessor);
}
