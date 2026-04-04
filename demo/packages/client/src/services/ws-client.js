/**
 * WebSocket client with auto-reconnect.
 */
export class WsClient {
  /** @param {string} url */
  constructor(url) {
    this.url = url;
    /** @type {WebSocket | null} */
    this.ws = null;
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.shouldReconnect = true;
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => { this.reconnectDelay = 1000; };
    this.ws.onmessage = (event) => this.handleMessage(event);
    this.ws.onclose = () => this.scheduleReconnect();
    this.ws.onerror = () => {}; // onclose will fire after
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.ws) this.ws.close();
  }

  /** @param {{ type: string, payload?: object }} message */
  send(message) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * @param {string} type
   * @param {Function} callback
   */
  on(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(callback);
  }

  /**
   * @param {string} type
   * @param {Function} callback
   */
  off(type, callback) {
    this.listeners.get(type)?.delete(callback);
  }

  /** @param {MessageEvent} event */
  handleMessage(event) {
    try {
      const data = JSON.parse(event.data);
      const handlers = this.listeners.get(data.type);
      if (handlers) {
        handlers.forEach((fn) => fn(data.payload));
      }
    } catch { /* ignore malformed */ }
  }

  /** @private */
  scheduleReconnect() {
    if (!this.shouldReconnect) return;
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      this.maxReconnectDelay
    );
  }
}
