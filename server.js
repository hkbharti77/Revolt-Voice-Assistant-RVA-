import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { setupWsBroker } from './src/ws/broker.js';

const app = express();
app.use(express.static('public'));

const httpServer = createServer(app);
setupWsBroker(httpServer);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
	console.log(`Server listening at http://localhost:${PORT}`);
});


