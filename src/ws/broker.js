import { WebSocketServer } from 'ws';
import { connectLive } from '../live/liveClient.js';
import { sessionManager } from '../live/sessionManager.js';

function systemInstructionText() {
	return (
		"You are REV — Revolt Motors' official voice assistant. " +
		"CRITICAL VOICE REQUIREMENTS - FOLLOW EXACTLY: " +
		"1. ALWAYS respond in English only - never use any other language " +
		"2. Use a clear, warm, professional female voice " +
		"3. SPEAK VERY SLOWLY - at HALF the normal speed " +
		"4. PAUSE for 2 seconds between each sentence " +
		"5. Use LONGER pauses between words for clarity " +
		"6. Speak like you're talking to someone who needs extra time to understand " +
		"7. Use a CALMING, SLOW pace - imagine you're explaining to a child " +
		"8. Take your time with each word - enunciate clearly " +
		"9. Use a gentle, patient speaking rhythm " +
		"10. Remember: SLOW DOWN - your current speed is TOO FAST " +
		"CONTENT: Only answer questions about Revolt Motors' products, pricing, charging, service, and test rides. " +
		"If asked about anything else, reply: 'I can help with Revolt Motors topics only.' " +
		"Keep responses brief, factual, and engaging. " +
		"IMPORTANT: Before speaking, remind yourself to SPEAK SLOWLY. " +
		"Your voice should be like a gentle, patient teacher explaining something important."
	);
}

export function setupWsBroker(server) {
	const wss = new WebSocketServer({ server, path: '/ws' });
	console.log('WebSocket broker setup complete');

	wss.on('connection', async (clientWs) => {
		console.log('New WebSocket client connected');
		const clientKey = Symbol('client');
		let liveSession;

		try {
			console.log('Attempting to connect to Gemini Live API...');
			liveSession = await connectLive({
				systemInstruction: systemInstructionText(),
				callbacks: {
					onmessage: (message) => {
						console.log('Received message from Gemini:', JSON.stringify(message).substring(0, 200) + '...');
						// Normalize Gemini messages for the browser
						try {
							const normalized = [];
							if (message?.serverContent) {
								const sc = message.serverContent;
								if (sc.interrupted) normalized.push({ type: 'interrupted', value: true });
								if (sc.turnComplete) normalized.push({ type: 'turnComplete', value: true });
								const parts = sc.modelTurn?.parts || [];
								for (const part of parts) {
									if (part?.audio?.data) {
										normalized.push({ type: 'audio', data: part.audio.data });
									}
									if (part?.text) {
										normalized.push({ type: 'text', text: part.text });
									}
								}
							}
							// Handle setupComplete message
							if (message?.setupComplete) {
								normalized.push({ type: 'setupComplete', value: true });
							}
							// Fallback: if top-level data is present (audio chunk)
							if (message?.data) normalized.push({ type: 'audio', data: message.data });
							if (normalized.length === 0) normalized.push(message);
							for (const item of normalized) {
								if (item && item.type) {
									console.log('Sending normalized message to client:', item.type);
									clientWs.send(JSON.stringify(item));
								}
							}
						} catch (e) {
							console.error('Error normalizing message:', e);
						}
					},
					onerror: (e) => {
						console.error('Gemini Live API error:', e);
						try { clientWs.send(JSON.stringify({ error: e?.message || String(e) })); } catch {}
					},
					onclose: () => {
						console.log('Gemini Live session closed');
						// Don't close the client connection automatically
						// The client should be able to reconnect or continue
						// try { clientWs.close(); } catch {}
					}
				}
			});
			console.log('Gemini Live session established successfully');
			sessionManager.set(clientKey, liveSession);
		} catch (err) {
			console.error('Failed to connect to Gemini Live:', err);
			clientWs.send(JSON.stringify({ error: String(err?.message || err) }));
			clientWs.close();
			return;
		}

		// Browser -> Gemini
		clientWs.on('message', (data, isBinary) => {
			console.log('Received message from client:', isBinary ? 'binary' : 'text', isBinary ? data.length : data.toString());
			const session = sessionManager.get(clientKey);
			if (!session) return;

			if (isBinary) {
				// Binary frame is raw PCM16@16kHz mono
				const base64 = Buffer.isBuffer(data) ? data.toString('base64') : Buffer.from(data).toString('base64');
				console.log('Sending audio to Gemini, size:', base64.length);
				session.sendRealtimeInput({
					audio: {
						data: base64,
						mimeType: 'audio/pcm;rate=16000'
					}
				});
				return;
			}

			try {
				const msg = JSON.parse(data.toString());
				if (msg?.type === 'text' && typeof msg.text === 'string') {
					console.log('Sending text to Gemini:', msg.text);
					session.sendClientContent({
						turns: [
							{ role: 'user', parts: [{ text: msg.text }] }
						],
						turnComplete: true
					});
				}
				if (msg?.type === 'stop') {
					// Client-initiated interrupt: barge-in is automatic on new audio activity
				}
			} catch {}
		});

		clientWs.on('close', async () => {
			console.log('WebSocket client disconnected');
			// Only close the session if the client initiated the disconnect
			const session = sessionManager.get(clientKey);
			if (session) {
				await sessionManager.close(clientKey);
			}
		});
	});
}


