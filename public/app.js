import { floatTo16BitPCM, Pcm24kPlayer, resampleTo16k } from './audio.js';

// DOM Elements
const statusEl = document.getElementById('status');
const latencyEl = document.getElementById('latency');
const talkBtn = document.getElementById('talk');
const themeToggle = document.getElementById('themeToggle');
const speedSlider = document.getElementById('speedSlider');
const speedValue = document.getElementById('speedValue');

// Speed control functionality
let currentSpeed = 0.5; // Default to half speed

speedSlider.addEventListener('input', (e) => {
	currentSpeed = parseFloat(e.target.value);
	speedValue.textContent = currentSpeed.toFixed(1) + 'x';
	
	// Update the audio player speed immediately
	if (player && player.setPlaybackRate) {
		player.setPlaybackRate(currentSpeed);
	}
});

// Initialize speed display
speedValue.textContent = currentSpeed.toFixed(1) + 'x';

// WebSocket connection
const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${protocol}://${location.host}/ws`);

// Optimize WebSocket for low-latency audio streaming
ws.binaryType = 'arraybuffer'; // Use ArrayBuffer for binary data

// Add connection debugging
console.log('Attempting WebSocket connection to:', `${protocol}://${location.host}/ws`);

// Audio context and state
let audioCtx = null;
let mediaStream = null;
let processorNode = null;
let workletNode = null;
let sourceNode = null;
let player = new Pcm24kPlayer();
let speaking = false;
let lastUserActivityAt = 0;

// Initialize audio context and ensure it's running
async function initAudioContext() {
	if (!audioCtx) {
		// Use device's native sample rate to avoid AudioNode connection issues
		audioCtx = new (window.AudioContext || window.webkitAudioContext)({
			latencyHint: 'interactive',
			desiredSinkLatency: 0.05
		});
	}
	
	// Ensure audio context is running
	if (audioCtx.state === 'suspended') {
		await audioCtx.resume();
	}
	
	return audioCtx;
}

// Theme management
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  themeToggle.checked = savedTheme === 'dark';
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  
  // Add smooth transition effect
  document.body.style.transition = 'background-color 0.3s ease, color 0.3s ease';
  setTimeout(() => {
    document.body.style.transition = '';
  }, 300);
}

// Initialize theme
initTheme();

// Initialize audio context
initAudioContext();

// Theme toggle event listener
themeToggle.addEventListener('change', toggleTheme);

// WebSocket event handlers
ws.onopen = () => {
	console.log('WebSocket connection opened successfully');
	statusEl.textContent = 'Connected. Hold to talk';
	statusEl.className = 'status success';
};

ws.onclose = (event) => {
	console.log('WebSocket connection closed:', event.code, event.reason);
	statusEl.textContent = 'Disconnected';
	statusEl.className = 'status error';
};

ws.onerror = (e) => {
	console.error('WebSocket error:', e);
	statusEl.textContent = 'Connection error';
	statusEl.className = 'status error';
};

ws.onmessage = (evt) => {
	console.log('Received WebSocket message:', evt.data);
	try {
		const msg = JSON.parse(evt.data);
		console.log('Parsed message:', msg);
		
		if (msg?.error) {
			console.error('Server error received:', msg.error);
			statusEl.textContent = `Server error: ${msg.error}`;
			statusEl.className = 'status error';
			return;
		}
		if (msg?.type === 'setupComplete') {
			console.log('Setup complete received');
			statusEl.textContent = 'Ready to talk';
			statusEl.className = 'status success';
			return;
		}
		if (msg?.type === 'interrupted' || msg?.type === 'turnComplete') {
			console.log('Audio interrupted/turn complete');
			player.stopImmediately();
			return;
		}
		if (msg?.type === 'audio' && msg?.data) {
			console.log('Audio data received, length:', msg.data.length);
			player.appendPcm16Base64(msg.data);
			if (lastUserActivityAt) {
				const rtt = Math.max(0, performance.now() - lastUserActivityAt);
				latencyEl.textContent = `Latency: ${rtt.toFixed(0)} ms`;
				lastUserActivityAt = 0;
			}
			return;
		}
		if (msg?.type === 'text' && msg?.text) {
			console.log('Text message received:', msg.text);
			statusEl.textContent = msg.text;
			statusEl.className = 'status success';
			return;
		}
		
		console.log('Unhandled message type:', msg?.type);
	} catch (e) {
		console.warn('Non-JSON message or parse error', e);
	}
};

// Audio capture functions
async function startCapture() {
	// Ensure audio context is ready
	audioCtx = await initAudioContext();
	
	try {
		// Optimize audio input settings for clarity
		mediaStream = await navigator.mediaDevices.getUserMedia({ 
			audio: { 
				channelCount: 1, 
				noiseSuppression: true, 
				echoCancellation: true, 
				autoGainControl: true,
				// Reduce buffer size for lower latency
				bufferSize: 256 // Smaller buffer for faster processing
			} 
		});
		
		sourceNode = audioCtx.createMediaStreamSource(mediaStream);
		
		try {
			await audioCtx.audioWorklet.addModule('micWorklet.js');
			workletNode = new AudioWorkletNode(audioCtx, 'mic-capture', {
				// Optimize worklet for low latency
				processorOptions: {
					bufferSize: 256,
					channelCount: 1
				}
			});
			workletNode.port.onmessage = (evt) => {
				const input = evt.data;
				const resampled = resampleTo16k(input, audioCtx.sampleRate);
				const buf = floatTo16BitPCM(resampled);
				ws.send(buf);
			};
			sourceNode.connect(workletNode);
		} catch (e) {
			// Fallback to ScriptProcessor with smaller buffer
			processorNode = audioCtx.createScriptProcessor(256, 1, 1); // Reduced from 1024 to 256
			processorNode.onaudioprocess = (e) => {
				const input = e.inputBuffer.getChannelData(0);
				const resampled = resampleTo16k(input, audioCtx.sampleRate);
				const buf = floatTo16BitPCM(resampled);
				ws.send(buf);
			};
			sourceNode.connect(processorNode);
		}
		
		speaking = true;
		talkBtn.classList.add('speaking');
		statusEl.textContent = 'Listening… (streaming)';
		statusEl.className = 'status connecting';
		lastUserActivityAt = performance.now();
		
	} catch (error) {
		console.error('Error starting audio capture:', error);
		statusEl.textContent = 'Microphone access denied';
		statusEl.className = 'status error';
	}
}

async function stopCapture() {
  speaking = false;
  talkBtn.classList.remove('speaking');
  statusEl.textContent = 'Processing…';
  statusEl.className = 'status connecting';
  
  try { 
    if (processorNode) {
      processorNode.disconnect();
      processorNode = null;
    }
  } catch {}
  
  try { 
    if (workletNode) {
      workletNode.disconnect();
      workletNode = null;
    }
  } catch {}
  
  try { 
    if (sourceNode) {
      sourceNode.disconnect();
      sourceNode = null;
    }
  } catch {}
  
  try { 
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
  } catch {}
}

// Toggle capture helpers
let isToggling = false;
async function toggleCapture() {
  if (isToggling) return;
  isToggling = true;
  try {
    if (speaking) {
      await stopCapture();
    } else {
      player.stopImmediately();
      await startCapture();
    }
  } finally {
    isToggling = false;
  }
}

// Click toggles start/stop
talkBtn.addEventListener('click', async (e) => {
  const ripple = talkBtn.querySelector('.ripple');
  if (ripple) {
    ripple.style.width = '0';
    ripple.style.height = '0';
    setTimeout(() => {
      ripple.style.width = '200px';
      ripple.style.height = '200px';
    }, 10);
  }
  await toggleCapture();
});

// Touch: single tap toggles
talkBtn.ontouchend = async (e) => {
  e.preventDefault();
  await toggleCapture();
};

// Keyboard: Space/Enter toggles
talkBtn.onkeydown = async (e) => {
  if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
    e.preventDefault();
    await toggleCapture();
  }
};

// Initialize status
statusEl.textContent = 'Ready to connect';
statusEl.className = 'status';


