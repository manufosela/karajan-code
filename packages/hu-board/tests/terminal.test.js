// KJC-TSK-0816 (MGL-E, ADR 0008) — la terminal embebida: un pty del agente
// puenteado por WebSocket, SOLO en loopback y SOLO con el token de la
// sesión. Todo inyectable: cero procesos y cero sockets reales aquí.
import { describe, it, expect, vi } from 'vitest';
import { createTerminalManager } from '../src/terminal.js';

const fakePty = () => {
  const listeners = { data: [], exit: [] };
  return {
    written: [],
    killed: false,
    onData(cb) { listeners.data.push(cb); },
    onExit(cb) { listeners.exit.push(cb); },
    write(d) { this.written.push(d); },
    resize: vi.fn(),
    kill() { this.killed = true; listeners.exit.forEach((cb) => cb({ exitCode: 0 })); },
    emitData(d) { listeners.data.forEach((cb) => cb(d)); },
  };
};

const manager = (pty = fakePty()) =>
  createTerminalManager({ spawnPty: vi.fn(() => pty), cwd: '/proyecto' });

describe('terminal embebida (KJC-TSK-0816)', () => {
  it('start crea UN pty con token aleatorio; un segundo start reutiliza la sesión viva', () => {
    const spawnPty = vi.fn(() => fakePty());
    const m = createTerminalManager({ spawnPty, cwd: '/proyecto' });
    const a = m.start({ agent: 'claude' });
    expect(a.token).toMatch(/^[a-f0-9]{32,}$/);
    const b = m.start({ agent: 'claude' });
    expect(b.termId).toBe(a.termId);
    expect(spawnPty).toHaveBeenCalledOnce();
  });

  it('el agente arranca en el cwd del proyecto y SIN la variable CLAUDECODE heredada', () => {
    const spawnPty = vi.fn(() => fakePty());
    const m = createTerminalManager({ spawnPty, cwd: '/proyecto', env: { CLAUDECODE: '1', PATH: '/bin' } });
    m.start({ agent: 'claude' });
    const [cmd, , opts] = spawnPty.mock.calls[0];
    expect(cmd).toBe('claude');
    expect(opts.cwd).toBe('/proyecto');
    expect(opts.env.CLAUDECODE).toBeUndefined();
    expect(opts.env.PATH).toBe('/bin');
  });

  it('solo acepta agentes del catálogo — ni comandos arbitrarios ni claves del prototipo', () => {
    const m = manager();
    expect(() => m.start({ agent: 'rm -rf /' })).toThrow(/agente/i);
    expect(() => m.start({ agent: 'constructor' })).toThrow(/agente/i);
  });

  it('attach exige token; el detach NO mata el pty y se puede reconectar', () => {
    const pty = fakePty();
    const m = manager(pty);
    const { termId, token } = m.start({ agent: 'claude' });
    expect(() => m.attach({ termId, token: 'malo', send: () => {} })).toThrow(/token/i);
    const socket = { sent: [] };
    const detach = m.attach({ termId, token, send: (d) => socket.sent.push(d) });
    pty.emitData('hola');
    expect(socket.sent).toContain('hola');
    detach();
    pty.emitData('adios');
    expect(socket.sent).not.toContain('adios');
    expect(pty.killed).toBe(false);
    const sent = [];
    m.attach({ termId, token, send: (d) => sent.push(d) });
    pty.emitData('sigo vivo');
    expect(sent).toContain('sigo vivo');
  });

  it('write llega al pty y stop lo mata y limpia la sesión', () => {
    const pty = fakePty();
    const m = manager(pty);
    const { termId, token } = m.start({ agent: 'claude' });
    m.write({ termId, token, data: 'ls\r' });
    expect(pty.written).toContain('ls\r');
    m.stop({ termId, token });
    expect(pty.killed).toBe(true);
    expect(() => m.write({ termId, token, data: 'x' })).toThrow(/sesión|session/i);
  });
});
