class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.remainder = new Float32Array(0);
    this.pending = [];
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input?.length) return true;
    const combined = new Float32Array(this.remainder.length + input.length);
    combined.set(this.remainder);
    combined.set(input, this.remainder.length);
    const ratio = sampleRate / this.targetRate;
    const outputLength = Math.floor((combined.length - 1) / ratio);
    const consumed = Math.floor(outputLength * ratio);

    for (let index = 0; index < outputLength; index++) {
      const sourceIndex = index * ratio;
      const lower = Math.floor(sourceIndex);
      const fraction = sourceIndex - lower;
      const sample = combined[lower] * (1 - fraction) + combined[lower + 1] * fraction;
      this.pending.push(Math.max(-1, Math.min(1, sample)));
    }
    this.remainder = combined.slice(consumed);

    if (this.pending.length >= 1600) {
      const pcm = new Int16Array(this.pending.length);
      for (let index = 0; index < this.pending.length; index++) {
        const sample = this.pending[index];
        pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      this.pending = [];
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm-recorder", PcmRecorderProcessor);
