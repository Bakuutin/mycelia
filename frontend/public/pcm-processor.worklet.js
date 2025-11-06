class MicProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const pcm = input[0];
      const newBuffer = new Float32Array(pcm.length);
      newBuffer.set(pcm, 0);
      newBuffer.reverse();
      this.port.postMessage(newBuffer.buffer);
    }
    return true;
  }
}
registerProcessor('mic-processor', MicProcessor);


class DebugProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.targetSize = 10;
    this.size = 0;
    console.log('DebugProcessor constructor called');
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const pcm = input[0];
      this.buffer.push(pcm);
      this.size += pcm.length;
      if (this.size >= this.targetSize) {
        console.log(this.buffer);
        this.buffer = [];
        this.size = 0;
      }
    }
    return true;
  }
}

registerProcessor('debug-processor', DebugProcessor);