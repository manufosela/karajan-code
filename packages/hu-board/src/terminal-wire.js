// KJC-TSK-0816 — pegamento fino de la terminal embebida: rutas REST para
// arrancar/parar la sesión y el upgrade WebSocket que puentea el pty.
// La LÓGICA (tokens, catálogo, ciclo de vida) vive en terminal.js y está
// testeada con dobles; esto es cableado deliberadamente delgado.
//
// El token NO viaja en la URL: el cliente lo manda como subprotocolo
// WebSocket (['kj-terminal', token]) — las URLs acaban en logs; los
// subprotocolos, no.
import { Router } from 'express';
import { WebSocket, WebSocketServer } from 'ws';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const WS_PATH = '/api/terminal/ws';

/**
 * Monta las rutas REST de la terminal sobre un Router de express.
 * @param {ReturnType<import('./terminal.js').createTerminalManager>} manager
 */
export function terminalRouter(manager) {
  const router = Router();
  router.post('/start', (req, res) => {
    try {
      res.json(manager.start({ agent: req.body?.agent ?? 'claude' }));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  router.get('/alive', (_req, res) => res.json({ alive: manager.alive() }));
  router.post('/stop', (req, res) => {
    try {
      manager.stop({ termId: req.body?.termId, token: req.body?.token });
      res.json({ stopped: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  return router;
}

/**
 * Registra el upgrade WS en el servidor http. Entrada del cliente: bytes
 * crudos = teclado; un mensaje que empiece por \x00 es control JSON
 * ({type:'resize', cols, rows}) — el prefijo evita confundir un '{'
 * tecleado con un mensaje de control.
 *
 * @param {import('node:http').Server} server
 * @param {ReturnType<import('./terminal.js').createTerminalManager>} manager
 */
export function attachTerminalWs(server, manager) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== WS_PATH) return;
    if (!LOOPBACK.has(req.socket.remoteAddress)) {
      socket.destroy();
      return;
    }
    const termId = url.searchParams.get('termId');
    const protocols = String(req.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((p) => p.trim());
    const token = protocols[1] ?? '';
    wss.handleUpgrade(req, socket, head, (ws) => {
      let detach;
      try {
        detach = manager.attach({
          termId,
          token,
          send: (data) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(data);
          },
        });
      } catch (err) {
        ws.close(1008, err.message);
        return;
      }
      ws.on('message', (raw) => {
        const text = raw.toString('utf8');
        try {
          if (text.charCodeAt(0) === 0) {
            const msg = JSON.parse(text.slice(1));
            if (msg.type === 'resize') {
              manager.resize({ termId, token, cols: msg.cols, rows: msg.rows });
            }
            return;
          }
          manager.write({ termId, token, data: text });
        } catch {
          // Una trama malformada no tumba la sesión: se ignora y se sigue.
        }
      });
      ws.on('close', () => detach());
    });
  });
  return wss;
}
