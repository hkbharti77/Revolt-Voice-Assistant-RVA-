## Revolt Voice Assistant (RVA)

### Prerequisites
- Node.js 18+ (20+ recommended)
- Google AI Studio API key with Live API access

### Setup
1. Create a `.env` in project root:
```
GOOGLE_API_KEY=YOUR_KEY_HERE
PORT=3000
```
2. Install dependencies:
```
npm install
```

### Run
```
npm run dev
```
Open `http://localhost:3000`.

### What it does
- WebSocket `/ws` bridges browser audio (16 kHz PCM16 mono) to Gemini Live.
- Gemini streams back 24 kHz PCM16 audio; client plays it immediately.
- Barge-in: speaking again stops playback and interrupts the model.

### Models
- Primary: `gemini-2.5-flash-preview-native-audio-dialog`
- Fallbacks: `gemini-live-2.5-flash-preview`, `gemini-2.0-flash-live-001`

### Notes
- API key is server-side only. Do not expose it to the browser.
- For best latency, stream small frames (20–40 ms).


