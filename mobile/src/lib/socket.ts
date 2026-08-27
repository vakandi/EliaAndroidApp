/**
 * WebSocket manager for ws://<host>:5656/ws (PLAN.md §1.2).
 * Unit B implementation: connect/close lifecycle, ping every 30s while
 * open, and parsing of incoming JSON into the SocketEvent union.
 * Reconnect backoff + polling live in store.ts (it owns the timers).
 */
import { PING_INTERVAL_MS } from './config';

export type SocketEvent =
  | { event: 'initial_status'; subworkers: Record<string, unknown>[] }
  | { event: 'subworker_started' | 'subworker_completed'; name: string }
  | { event: 'subworker_error'; name: string; error: string }
  | { event: 'run_log'; name: string; text: string; field: string }
  | { event: 'run_banner'; name: string; banner: Record<string, unknown> }
  | { event: 'pong' }
  | { event: 'unknown'; raw: unknown };

export interface SocketHandlers {
  onEvent(e: SocketEvent): void;
  onOpen(): void;
  onClose(): void;
  onError(err: string): void;
}

/**
 * Parse one raw WS payload into a SocketEvent.
 * The server always tags events with `event`, but a bare
 * `{subworkers:[...]}` frame is accepted as initial_status
 * (mirrors SubworkerManager.handleWSMessage).
 */
export function parseSocketEvent(data: unknown): SocketEvent {
  if (typeof data !== 'object' || data === null) {
    return { event: 'unknown', raw: data };
  }
  const obj = data as Record<string, unknown>;
  const kind = typeof obj.event === 'string' ? obj.event : '';

  switch (kind) {
    case 'initial_status':
      return {
        event: 'initial_status',
        subworkers: Array.isArray(obj.subworkers)
          ? (obj.subworkers as Record<string, unknown>[])
          : [],
      };
    case 'subworker_started':
    case 'subworker_completed':
      return typeof obj.name === 'string'
        ? { event: kind, name: obj.name }
        : { event: 'unknown', raw: data };
    case 'subworker_error':
      return typeof obj.name === 'string'
        ? {
            event: 'subworker_error',
            name: obj.name,
            error: typeof obj.error === 'string' ? obj.error : 'Unknown error',
          }
        : { event: 'unknown', raw: data };
    case 'run_log':
      return typeof obj.name === 'string' && typeof obj.text === 'string'
        ? { event: 'run_log', name: obj.name, text: obj.text, field: typeof obj.field === 'string' ? obj.field : 'text' }
        : { event: 'unknown', raw: data };
    case 'run_banner':
      return typeof obj.name === 'string' && typeof obj.banner === 'object' && obj.banner !== null
        ? { event: 'run_banner', name: obj.name, banner: obj.banner as Record<string, unknown> }
        : { event: 'unknown', raw: data };
    case 'pong':
      return { event: 'pong' };
    default:
      // Connection-success payload without an explicit event key.
      if (Array.isArray(obj.subworkers)) {
        return {
          event: 'initial_status',
          subworkers: obj.subworkers as Record<string, unknown>[],
        };
      }
      return { event: 'unknown', raw: data };
  }
}

export class SubworkerSocket {
  private ws: WebSocket | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private wsUrl: string,
    private handlers: SocketHandlers,
    private authToken = '',
  ) {}

  /** Open the socket; sends {"type":"ping"} every PING_INTERVAL_MS once open. */
  connect(): void {
    // React Native exposes the WHATWG WebSocket API globally; handlers are
    // assigned as properties (addEventListener is unreliable on RN).
    // RN WebSocket custom headers are unreliable cross-platform, so the
    // shared token rides as a ?token= query param instead.
    let url = this.wsUrl;
    if (this.authToken) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}token=${encodeURIComponent(this.authToken)}`;
    }
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return; // stale socket already replaced
      this.startPing();
      this.handlers.onOpen();
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (this.ws !== ws) return;
      const text = typeof ev.data === 'string' ? ev.data : '';
      if (!text) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return; // non-JSON frame — ignore, like AppLog path in Swift
      }
      this.handlers.onEvent(parseSocketEvent(parsed));
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.stopPing();
      this.ws = null;
      this.handlers.onClose();
    };

    ws.onerror = () => {
      if (this.ws !== ws) return;
      this.handlers.onError('WebSocket error');
    };
  }

  /** Close the socket and stop the ping timer; detaches all handlers. */
  close(): void {
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    // Detach before closing so late events never reach stale handlers.
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    try {
      ws.close();
    } catch {
      // already closed / never opened — nothing to do
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      try {
        this.ws?.send(JSON.stringify({ type: 'ping' }));
      } catch {
        // send on a dying socket — onclose/onerror will surface it
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}
