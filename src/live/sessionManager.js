/**
 * Simple in-memory session manager mapping a client key to a Live API session.
 */
class SessionManager {
	constructor() {
		this.clientToSession = new Map();
	}

	set(clientKey, session) {
		this.clientToSession.set(clientKey, session);
	}

	get(clientKey) {
		return this.clientToSession.get(clientKey);
	}

	async close(clientKey) {
		const session = this.clientToSession.get(clientKey);
		if (session) {
			try {
				await session.close();
			} catch {}
			this.clientToSession.delete(clientKey);
		}
	}
}

export const sessionManager = new SessionManager();


