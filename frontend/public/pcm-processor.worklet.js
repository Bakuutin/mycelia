class MicProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const pcm = input[0];
      const newBuffer = new Float32Array(pcm.length);
      newBuffer.set(pcm, 0);
      this.port.postMessage(newBuffer.buffer);
    }
    return true;
  }
}
registerProcessor('mic-processor', MicProcessor);
