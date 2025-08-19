// Float32 [-1,1] -> Int16 PCM
export function floatTo16BitPCM(float32Array) {
	const out = new Int16Array(float32Array.length);
	for (let i = 0; i < float32Array.length; i++) {
		let s = Math.max(-1, Math.min(1, float32Array[i]));
		out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
	}
	return out.buffer;
}

export function base64ToArrayBuffer(base64) {
	const binaryString = atob(base64);
	const len = binaryString.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
	return bytes.buffer;
}

// Linear resampler from arbitrary input sampleRate -> 16000 Hz
export function resampleTo16k(float32Array, inputSampleRate) {
	const targetRate = 16000;
	if (inputSampleRate === targetRate) return float32Array;
	const ratio = inputSampleRate / targetRate;
	const outLength = Math.floor(float32Array.length / ratio);
	const output = new Float32Array(outLength);
	let pos = 0;
	for (let i = 0; i < outLength; i++) {
		const idx = i * ratio;
		const idxFloor = Math.floor(idx);
		const idxCeil = Math.min(float32Array.length - 1, idxFloor + 1);
		const frac = idx - idxFloor;
		const sample = float32Array[idxFloor] * (1 - frac) + float32Array[idxCeil] * frac;
		output[pos++] = sample;
	}
	return output;
}

// Minimal streaming player for PCM16@24kHz mono
export class Pcm24kPlayer {
	constructor() {
		// Use device's native sample rate for better compatibility
		this.context = new (window.AudioContext || window.webkitAudioContext)({ 
			latencyHint: 'interactive',
			// Reduce buffer size for lower latency
			desiredSinkLatency: 0.05, // 50ms target latency
			maxChannelCount: 1
		});
		
		this.nextStartTime = 0;
		// Reduce lookahead for faster response
		this.lookaheadSec = 0.01; // 10 ms scheduling lookahead (was 20ms)
		this.activeSources = new Set();
		
		// Audio buffer queue for smoother streaming
		this.audioQueue = [];
		this.isPlaying = false;
		
		// Speed control
		this.playbackRate = 0.5; // Default to half speed
		
		// Ensure audio context is running
		if (this.context.state === 'suspended') {
			this.context.resume();
		}
	}

	// Method to set playback rate
	setPlaybackRate(rate) {
		this.playbackRate = rate;
		console.log('Audio playback rate set to:', rate);
	}

	stopImmediately() {
		for (const src of this.activeSources) {
			try { src.stop(0); } catch {}
		}
		this.activeSources.clear();
		this.audioQueue = [];
		this.isPlaying = false;
		this.nextStartTime = this.context.currentTime;
		
		try { 
			this.context.suspend(); 
		} catch {}
		try { 
			this.context.resume(); 
		} catch {}
	}

	appendPcm16Base64(base64) {
		const ab = base64ToArrayBuffer(base64);
		const pcm16 = new Int16Array(ab);
		
		// Create audio buffer with the context's actual sample rate
		const audioBuffer = this.context.createBuffer(1, pcm16.length, this.context.sampleRate);
		const channel = audioBuffer.getChannelData(0);
		
		// Convert PCM16 to float32 with improved precision
		for (let i = 0; i < pcm16.length; i++) {
			// Normalize to [-1, 1] range with better precision
			channel[i] = pcm16[i] / 32768.0;
		}
		
		// Add to queue for smoother playback
		this.audioQueue.push(audioBuffer);
		
		// Start playing if not already playing
		if (!this.isPlaying) {
			this.playNextBuffer();
		}
	}
	
	playNextBuffer() {
		if (this.audioQueue.length === 0) {
			this.isPlaying = false;
			return;
		}
		
		this.isPlaying = true;
		const audioBuffer = this.audioQueue.shift();
		
		const src = this.context.createBufferSource();
		src.buffer = audioBuffer;
		
		// Set playback rate to use the current speed setting
		// This ensures the AI voice plays at the user's preferred speed
		src.playbackRate.setValueAtTime(this.playbackRate, this.context.currentTime);
		
		src.connect(this.context.destination);
		
		const now = this.context.currentTime;
		
		// Optimize timing for minimal latency
		if (this.nextStartTime < now + this.lookaheadSec) {
			this.nextStartTime = now + this.lookaheadSec;
		}
		
		src.start(this.nextStartTime);
		this.activeSources.add(src);
		
		src.onended = () => {
			this.activeSources.delete(src);
			// Play next buffer immediately
			this.playNextBuffer();
		};
		
		this.nextStartTime += audioBuffer.duration;
	}
}


