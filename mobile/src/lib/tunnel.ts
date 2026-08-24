/**
 * Cloudflare Tunnel remote-access API client (PLAN.md §9.2 Unit M).
 * Talks to the server-side tunnel router (§9.1):
 *   GET  /tunnel/status → {configured, domain, tunnel_id, cloudflared_running,
 *                          public_ok, last_error, step}
 *   POST /tunnel/check  {domain, api_token} → quick validation, creates nothing
 *   POST /tunnel/setup  {domain, api_token} → starts the async orchestration;
 *       progress is read back from GET /tunnel/status via the `step` field:
 *       verifying_token → checking_zone → creating_tunnel → routing_dns →
 *       starting_cloudflared → verifying_public → done | error
 */
import { useSettingsStore } from './settings';

export const TUNNEL_POLL_INTERVAL_MS = 2000;

export type TunnelSetupStep =
  | 'verifying_token'
  | 'checking_zone'
  | 'creating_tunnel'
  | 'routing_dns'
  | 'starting_cloudflared'
  | 'verifying_public'
  | 'done'
  | 'error';

/** Ordered non-terminal steps for wizard progress rendering. */
export const TUNNEL_STEP_ORDER: readonly TunnelSetupStep[] = [
  'verifying_token',
  'checking_zone',
  'creating_tunnel',
  'routing_dns',
  'starting_cloudflared',
  'verifying_public',
] as const;

export function tunnelStepLabel(step: TunnelSetupStep): string {
  switch (step) {
    case 'verifying_token':
      return 'Verifying your API token';
    case 'checking_zone':
      return 'Checking the domain on Cloudflare';
    case 'creating_tunnel':
      return 'Creating the tunnel';
    case 'routing_dns':
      return 'Routing DNS to the tunnel';
    case 'starting_cloudflared':
      return 'Starting the connector';
    case 'verifying_public':
      return 'Verifying public access';
    default:
      return step;
  }
}

export interface TunnelStatus {
  configured: boolean;
  domain: string | null;
  tunnelId: string | null;
  cloudflaredRunning: boolean;
  publicOk: boolean;
  lastError: string | null;
  step: TunnelSetupStep | null;
}

export interface TunnelCheckResult {
  ok: boolean;
  message: string | null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function parseStep(value: unknown): TunnelSetupStep | null {
  if (
    value === 'verifying_token' ||
    value === 'checking_zone' ||
    value === 'creating_tunnel' ||
    value === 'routing_dns' ||
    value === 'starting_cloudflared' ||
    value === 'verifying_public' ||
    value === 'done' ||
    value === 'error'
  ) {
    return value;
  }
  return null;
}

function mapStatusRaw(json: Record<string, unknown>): TunnelStatus {
  return {
    configured: bool(json.configured),
    domain: str(json.domain),
    tunnelId: str(json.tunnel_id),
    cloudflaredRunning: bool(json.cloudflared_running),
    publicOk: bool(json.public_ok),
    lastError: str(json.last_error) ?? str(json.detail) ?? str(json.message),
    step: parseStep(json.step),
  };
}

async function assertOk(res: Response, context: string): Promise<void> {
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as Record<string, unknown>;
      const reason = str(body.detail) ?? str(body.error) ?? str(body.message);
      if (reason) detail = ` — ${reason}`;
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new Error(`${context} failed: HTTP ${res.status}${detail}`);
  }
}

export class TunnelApi {
  constructor(private getBaseUrl: () => string) {}

  private endpoint(path: string): string {
    return `${this.getBaseUrl().replace(/\/+$/, '')}${path}`;
  }

  /** Shared-token headers — the tunnel API is protected like every other route. */
  private authHeaders(json = false): Record<string, string> {
    const token = useSettingsStore.getState().authToken;
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      headers['X-Elia-Token'] = token;
    }
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  }

  /** GET /tunnel/status — current config + orchestration progress. */
  async getStatus(): Promise<TunnelStatus> {
    const res = await fetch(this.endpoint('/tunnel/status'), {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`Tunnel status failed: HTTP ${res.status}`);
    const json: unknown = await res.json();
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      throw new Error('Invalid /tunnel/status response');
    }
    return mapStatusRaw(json as Record<string, unknown>);
  }

  /** POST /tunnel/check — validate token + zone quickly without creating anything. */
  async check(domain: string, apiToken: string): Promise<TunnelCheckResult> {
    let res: Response;
    try {
      res = await fetch(this.endpoint('/tunnel/check'), {
        method: 'POST',
        headers: this.authHeaders(true),
        body: JSON.stringify({ domain, api_token: apiToken }),
      });
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      // Non-JSON body — fall through to status-based result.
    }
    if (!res.ok) {
      return {
        ok: false,
        message:
          str(json.detail) ??
          str(json.error) ??
          str(json.message) ??
          `Server rejected the check (HTTP ${res.status}).`,
      };
    }
    const tokenOk = json.token_ok;
    const legacyOk = json.ok;
    const ok =
      typeof tokenOk === 'boolean'
        ? tokenOk
        : legacyOk !== false && json.valid !== false;
    return { ok, message: str(json.detail) ?? str(json.message) };
  }

  /** POST /tunnel/setup — kick off the full orchestration (progress via getStatus). */
  async startSetup(domain: string, apiToken: string): Promise<void> {
    const res = await fetch(this.endpoint('/tunnel/setup'), {
      method: 'POST',
      headers: this.authHeaders(true),
      body: JSON.stringify({ domain, api_token: apiToken }),
    });
    await assertOk(res, 'Tunnel setup');
    // The server reports logical failures inside a 200 body ({status:"error"}).
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      return;
    }
    if (json.status === 'error') {
      throw new Error(str(json.message) ?? 'Tunnel setup failed to start.');
    }
  }

  /**
   * POST /tunnel/remove — full Cloudflare cleanup: stops cloudflared, deletes
   * the DNS record and the tunnel itself (cascade), removes local state.
   * This is the ONLY way to clean up Cloudflare resources created by setup.
   */
  async resetTunnel(): Promise<{ removed: boolean; remoteErrors: string[] }> {
    const res = await fetch(this.endpoint('/tunnel/remove'), {
      method: 'POST',
      headers: this.authHeaders(),
    });
    await assertOk(res, 'Tunnel reset');
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const errors = Array.isArray(json.remote_errors)
      ? (json.remote_errors as unknown[]).map(String)
      : [];
    return { removed: json.status === 'removed', remoteErrors: errors };
  }

  /**
   * Polls GET /tunnel/status every intervalMs until `step` reaches a terminal
   * state (`done` or `error`). Reports every snapshot to onStatus. Resolves
   * with the final snapshot; rejects only when polling itself is aborted.
   */
  async pollSetup(
    onStatus: (status: TunnelStatus) => void,
    options?: { intervalMs?: number; signal?: AbortSignal },
  ): Promise<TunnelStatus> {
    const intervalMs = options?.intervalMs ?? TUNNEL_POLL_INTERVAL_MS;
    const signal = options?.signal;

    for (;;) {
      if (signal?.aborted) throw new Error('Polling cancelled');

      let status: TunnelStatus;
      try {
        status = await this.getStatus();
      } catch (err) {
        // Transient poll failures surface as progress errors but keep polling —
        // the server may be mid-restart while starting cloudflared.
        status = {
          configured: false,
          domain: null,
          tunnelId: null,
          cloudflaredRunning: false,
          publicOk: false,
          lastError: err instanceof Error ? err.message : String(err),
          step: null,
        };
      }
      onStatus(status);

      if (status.step === 'done' || status.step === 'error') return status;

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, intervalMs);
        const onAbort = (): void => {
          clearTimeout(timer);
          reject(new Error('Polling cancelled'));
        };
        signal?.addEventListener('abort', onAbort);
      });
    }
  }
}

/** Shared instance pointed at the current settings store URL. */
export const tunnelApi = new TunnelApi(() => useSettingsStore.getState().serverUrl);

/** Strips scheme/path/trailing junk from a pasted domain ("https://sub.x.com/" → "sub.x.com"). */
export function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}
