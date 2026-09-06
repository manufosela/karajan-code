// KJC-TSK-0816 (MGL-E, ADR 0008) — la ventana única: la terminal REAL del
// agente embebida en el board; el proceso es el agente interactivo de
// siempre, con los hooks del Sentinel intactos. Seguridad de la superficie:
// server solo en loopback, token aleatorio de 128 bits entregado tras el
// auth del board y comparado en tiempo constante, y catálogo de agentes
// CERRADO — por la red viaja qué agente, jamás un comando arbitrario.
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Catálogo cerrado: los mismos agentes que kj go sabe lanzar. */
export const TERMINAL_AGENTS = Object.freeze({
  claude: { command: 'claude', args: [] },
  codex: { command: 'codex', args: [] },
});

const tokenMatches = (expected, given) => {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(given ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Gestor de LA sesión de terminal del board (singleton por diseño: una
 * conversación por board acota la superficie; multi-terminal queda fuera
 * del alcance del ADR).
 *
 * @param {Object} deps
 * @param {(command: string, args: string[], opts: object) => object} deps.spawnPty
 *   Factoría del pty (node-pty.spawn en producción; fake en tests).
 * @param {string} deps.cwd Directorio del proyecto donde vive el agente.
 * @param {Record<string, string|undefined>} [deps.env]
 */
export function createTerminalManager({ spawnPty, cwd, env = process.env }) {
  /** @type {{termId: string, token: string, pty: object, subscribers: Set<Function>, buffer: string[]} | null} */
  let session = null;

  const requireSession = (termId, token) => {
    if (!session || session.termId !== termId) {
      throw new Error('terminal: no hay sesión viva con ese id.');
    }
    if (!tokenMatches(session.token, token)) {
      throw new Error('terminal: token inválido.');
    }
    return session;
  };

  return {
    /** Arranca (o devuelve) LA sesión — reutilizar la viva evita que cada
     *  recarga multiplique agentes. @param {{agent: string}} params */
    start({ agent }) {
      if (session) return { termId: session.termId, token: session.token, reused: true };
      // hasOwn: sin él, "constructor"/"__proto__" indexarían el prototipo.
      const spec = Object.hasOwn(TERMINAL_AGENTS, agent) ? TERMINAL_AGENTS[agent] : null;
      if (!spec) {
        throw new Error(
          `terminal: agente "${agent}" fuera del catálogo (${Object.keys(TERMINAL_AGENTS).join(', ')}).`,
        );
      }
      // CLAUDECODE fuera: un Claude anidado se niega a arrancar con ella
      // (la misma peculiaridad que ya maneja kj go).
      const { CLAUDECODE: _omit, ...cleanEnv } = env;
      const pty = spawnPty(spec.command, spec.args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 32,
        cwd,
        env: cleanEnv,
      });
      const current = {
        termId: `term-${randomBytes(8).toString('hex')}`,
        token: randomBytes(16).toString('hex'),
        pty,
        subscribers: new Set(),
        buffer: [],
      };
      pty.onData((data) => {
        // Búfer corto para que una reconexión no arranque en negro.
        current.buffer.push(data);
        if (current.buffer.length > 200) current.buffer.shift();
        for (const send of current.subscribers) send(data);
      });
      pty.onExit(() => {
        for (const send of current.subscribers) send('\r\n[la sesión del agente terminó]\r\n');
        // El exit tardío de un pty viejo no debe anular una sesión nueva.
        if (session === current) session = null;
      });
      session = current;
      return { termId: current.termId, token: current.token, reused: false };
    },

    /**
     * Conecta un receptor de salida. Devuelve el detach; soltar la
     * conexión NO mata el pty — el agente sigue y se puede volver.
     */
    attach({ termId, token, send }) {
      const s = requireSession(termId, token);
      for (const chunk of s.buffer) send(chunk);
      s.subscribers.add(send);
      return () => s.subscribers.delete(send);
    },

    write({ termId, token, data }) {
      requireSession(termId, token).pty.write(data);
    },

    resize({ termId, token, cols, rows }) {
      requireSession(termId, token).pty.resize(cols, rows);
    },

    stop({ termId, token }) {
      const s = requireSession(termId, token);
      s.pty.kill();
      session = null;
    },

    alive() {
      return session ? { termId: session.termId } : null;
    },
  };
}
