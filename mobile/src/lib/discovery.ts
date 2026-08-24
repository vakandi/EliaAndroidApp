/**
 * Local-network server discovery (PLAN.md §4) — Unit C.
 *
 * Pure JS, zero native deps beyond expo-network for the device IPv4:
 * 1. Device IPv4 via expo-network; unavailable or outside private ranges → 'not_on_wifi'.
 * 2. /24 candidate list (x.y.z.1–254), own IP excluded, gateway (.1) probed first.
 * 3. Pool of SCAN_CONCURRENCY workers; each probe = fetch with AbortController
 *    timeout SCAN_TIMEOUT_MS. Verified iff JSON has `state` (/server/health),
 *    single fallback retry against /status accepting `subworkers`.
 * 4. Progressive emission via onFound; final list sorted by latencyMs asc.
 * 5. Cancellation-safe: abortScan() or a new scan resolves the in-flight scan
 *    early with { servers: partial, error: 'aborted' }.
 */
import * as Network from 'expo-network';

import { SCAN_CONCURRENCY, SCAN_TIMEOUT_MS } from './config';
import type { DiscoveredServer, ScanError } from './types';

export type ScanResult = { servers: DiscoveredServer[]; error: ScanError | null };

/** Handle over the currently running scan — cancellation + in-flight abort registry. */
interface ActiveScan {
  cancel(): void;
}

let activeScan: ActiveScan | null = null;

/**
 * Scan the device's /24 for an EliaAgent server on `port`.
 * Resolves once every candidate is probed, or early on cancellation.
 */
export function scanLocalNetwork(
  port: number,
  onFound: (s: DiscoveredServer) => void,
  authToken = '',
): Promise<ScanResult> {
  // A new scan always cancels the previous one (PLAN.md §4.7).
  activeScan?.cancel();

  return new Promise<ScanResult>((resolve) => {
    let settled = false;
    let cancelled = false;
    const controllers = new Set<AbortController>();
    const found: DiscoveredServer[] = [];

    const settle = (result: ScanResult): void => {
      if (settled) return;
      settled = true;
      if (activeScan === handle) activeScan = null;
      resolve(result);
    };

    const handle: ActiveScan = {
      cancel(): void {
        if (settled || cancelled) return;
        cancelled = true;
        for (const controller of controllers) controller.abort();
        // Early resolve with whatever was verified so far.
        settle({ servers: sortServers(found), error: 'aborted' });
      },
    };
    activeScan = handle;

    async function run(): Promise<void> {
      let ip: string | null = null;
      try {
        ip = await Network.getIpAddressAsync();
      } catch {
        ip = null;
      }
      if (cancelled) return; // already settled by cancel()
      if (!ip || !isPrivateIp(ip)) {
        settle({ servers: [], error: 'not_on_wifi' });
        return;
      }

      const candidates = buildCandidateList(ip); // gateway (.1) first, own IP excluded
      const probeHeaders: Record<string, string> = {};
      if (authToken) {
        probeHeaders.Authorization = `Bearer ${authToken}`;
        probeHeaders['X-Elia-Token'] = authToken;
      }
      await runPool(candidates, SCAN_CONCURRENCY, async (candidateIp) => {
        if (cancelled) return;
        const server = await probeHost(candidateIp, port, controllers, probeHeaders);
        if (cancelled || !server) return;
        found.push(server);
        try {
          onFound(server);
        } catch (consumerError) {
          // A throwing UI callback must not kill the scan mid-flight.
          console.warn('[discovery] onFound callback threw:', consumerError);
        }
      });

      if (cancelled) return;
      settle({ servers: sortServers(found), error: null });
    }

    void run();
  });
}

/** Cancels the current scan, if any; its promise resolves with error 'aborted'. */
export function abortScan(): void {
  activeScan?.cancel();
}

/**
 * Pure helper: /24 candidates derived from `ip`, gateway (.1) first,
 * own IP excluded. Returns [] for malformed input.
 */
export function buildCandidateList(ip: string): string[] {
  const octets = ip.split('.').map((o) => Number.parseInt(o, 10));
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o))) return [];
  const prefix = `${octets[0]}.${octets[1]}.${octets[2]}`;
  const candidates: string[] = [];
  for (let i = 1; i <= 254; i++) {
    const candidate = `${prefix}.${i}`;
    if (candidate !== ip) candidates.push(candidate);
  }
  return candidates;
}

/** Pure helper: true iff `ip` is RFC1918 private (10.x, 172.16–31.x, 192.168.x). */
export function isPrivateIp(ip: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return false;
  const [first, second] = octets as [number, number, number, number];
  if (first === 10) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  return false;
}

/**
 * Probe one host: /server/health must answer JSON containing `state`;
 * fallback single retry against /status accepting `subworkers`.
 * latencyMs spans both attempts (Date.now delta from probe start).
 */
async function probeHost(
  ip: string,
  port: number,
  controllers: Set<AbortController>,
  headers: Record<string, string> = {},
): Promise<DiscoveredServer | null> {
  const startedAt = Date.now();
  const baseUrl = `http://${ip}:${port}`;

  const health = await fetchJson(`${baseUrl}/server/health`, controllers, headers);
  if (hasJsonProperty(health, 'state')) {
    return { ip, port, baseUrl, latencyMs: Date.now() - startedAt, verified: true };
  }

  const status = await fetchJson(`${baseUrl}/status`, controllers, headers);
  if (hasJsonProperty(status, 'subworkers')) {
    return { ip, port, baseUrl, latencyMs: Date.now() - startedAt, verified: true };
  }

  return null;
}

/**
 * GET with SCAN_TIMEOUT_MS AbortController timeout.
 * Resolves undefined on any failure (timeout, network, non-2xx, bad JSON).
 */
async function fetchJson(
  url: string,
  controllers: Set<AbortController>,
  headers: Record<string, string> = {},
): Promise<Record<string, unknown> | undefined> {
  const controller = new AbortController();
  controllers.add(controller);
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) return undefined;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    controllers.delete(controller);
  }
}

function hasJsonProperty(value: unknown, key: string): boolean {
  return typeof value === 'object' && value !== null && key in value;
}

/** Fixed-size worker pool over `items`; each worker pulls the next index when free. */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function sortServers(servers: DiscoveredServer[]): DiscoveredServer[] {
  return [...servers].sort((a, b) => a.latencyMs - b.latencyMs);
}
