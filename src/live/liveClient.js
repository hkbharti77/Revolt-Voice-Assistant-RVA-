import { GoogleGenAI, Modality } from '@google/genai';

/**
 * Opens a Gemini Live session configured for audio output.
 * Keeps VAD/barge-in defaults as provided by the Live API.
 */
export async function connectLive({ systemInstruction, model, callbacks }) {
	const apiKey = process.env.GOOGLE_API_KEY;
	if (!apiKey) {
		throw new Error('Missing GOOGLE_API_KEY in environment');
	}

	console.log('Initializing GoogleGenAI with API key length:', apiKey.length);
	const ai = new GoogleGenAI({ apiKey });

	// Test basic API connectivity first
	try {
		console.log('Testing API key with basic Gemini instance...');
		const basicModel = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });
		await basicModel.generateContent('Hello');
		console.log('API key test successful');
	} catch (err) {
		console.error('API key test failed:', err.message);
		// Continue anyway - the basic model might not be available
		console.log('Continuing with Live API test...');
	}

	// Try fallback models if the primary one fails
	const models = [
		'gemini-live-2.5-flash-preview',  // More stable fallback
		'gemini-2.0-flash-live-001',      // Alternative fallback
		'gemini-2.5-flash-preview-native-audio-dialog'  // Original (may fail)
	];

	let lastError;
	for (const tryModel of models) {
		try {
			console.log('Attempting to connect to Gemini Live with model:', tryModel);
			const session = await ai.live.connect({
				model: tryModel,
				config: {
					responseModalities: [Modality.AUDIO],
					systemInstruction,
					realtimeInputConfig: {
						// VAD enabled by default; barge-in default: START_OF_ACTIVITY_INTERRUPTS
					},
					// Voice configuration for English female voice - VERY SLOW and clear
					language: 'en-US',
					voice: {
						gender: 'female',
						style: 'patient',
						clarity: 'maximum',
						pace: 'very_slow', // Maximum slow speech rate
						tone: 'calming',
						articulation: 'exaggerated', // Very clear pronunciation
						speed: 0.5, // Half speed
						pause_duration: 'extended' // Longer pauses
					}
				},
				callbacks: callbacks || {
					onmessage: () => {},
					onerror: () => {},
					onclose: () => {}
				}
			});

			console.log('Gemini Live session created successfully with model:', tryModel);
			return session;
		} catch (err) {
			lastError = err;
			console.error(`Failed to connect with model ${tryModel}:`, err.message);
			continue;
		}
	}

	throw new Error(`All models failed. Last error: ${lastError?.message || 'Unknown error'}`);
}


