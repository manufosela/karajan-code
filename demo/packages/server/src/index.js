import { createServer } from 'node:http';
import { createApp } from './app.js';
import { getDb } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { createWsServer } from './ws/server.js';
import { logger } from './logger.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || 'localhost';

const db = getDb();
runMigrations(db);

const app = createApp(db);
const server = createServer(app);
createWsServer(server, db);

server.listen(PORT, HOST, () => {
  logger.info({ port: PORT, host: HOST }, 'Server started');
});
