/**
 * Timing + network constants (PLAN.md §1.2 connection behavior, §4 discovery).
 */

/** Default EliaAgent FastAPI server base URL. */
export const DEFAULT_BASE_URL = 'http://localhost:5656';

/** Default server port used by URL normalization and LAN scan. */
export const DEFAULT_PORT = 5656;

/** WebSocket ping cadence. */
export const PING_INTERVAL_MS = 30000;

/** Reconnect backoff cap (starts at 1s, doubles each attempt). */
export const RECONNECT_MAX_MS = 30000;

/** HTTP poll cadence while disconnected. */
export const POLL_DOWN_MS = 5000;

/** Safety-net HTTP poll cadence while connected. */
export const POLL_CONNECTED_MS = 15000;

/** Server health poll cadence. */
export const HEALTH_POLL_MS = 30000;

/** Log viewer auto-refresh cadence. */
export const LOG_REFRESH_MS = 2000;

/** Per-host probe timeout for LAN discovery. */
export const SCAN_TIMEOUT_MS = 700;

/** Parallel probe pool size for LAN discovery. */
export const SCAN_CONCURRENCY = 32;

/** Selectable refresh intervals (seconds) in Settings. */
export const REFRESH_INTERVAL_CHOICES = [5, 10, 15, 30, 60];

/**
 * Shared admin token (docs/AUTHENTIFICATION.md).
 * Empty by default for security — set yours in Settings → Auth Token,
 * matching ELIA_AUTH_TOKEN in your server's .env.
 */
export const DEFAULT_AUTH_TOKEN = '';
