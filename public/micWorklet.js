class MicCaptureProcessor extends AudioWorkletProcessor {
	process(inputs) {
		const input = inputs[0];
		if (input && input[0]) {
			// Copy to avoid transferring the underlying ring buffer
			const channelData = input[0];
			const copy = new Float32Array(channelData.length);
			copy.set(channelData);
			this.port.postMessage(copy, [copy.buffer]);
		}
		return true;
	}
}

registerProcessor('mic-capture', MicCaptureProcessor);


