/**
 * Application-scoped zustand store — port of SubworkerManager.swift's
 * @Published properties (PLAN.md §2). Unit B owns the action bodies;
 * initial state below is frozen. UI units consume this store only.
 *
 * Connection behavior (mirrors SubworkerManager.swift exactly):
 * - WS ping every 30s (handled inside SubworkerSocket).
 * - Reconnect backoff: 1s, doubling, capped at RECONNECT_MAX_MS; reset on success.
 * - Poll /status every POLL_DOWN_MS while disconnected, every POLL_CONNECTED_MS
 *   while connected (safety net); poll /server/health + /models + /main-agent
 *   every HEALTH_POLL_MS.
 *
 * Server URL changes: call `useSettingsStore.getState().setServerUrl(url)`.
 * This store watches the settings store and restarts the connection core
 * (stop + start) whenever serverUrl changes — same effect as Swift's
 * updateBaseURL(_:).
 */
import { create } from 'zustand';

import { SubworkerApi, mapSubworkerRaw } from './api';
import {
  HEALTH_POLL_MS,
  POLL_CONNECTED_MS,
  POLL_DOWN_MS,
  RECONNECT_MAX_MS,
} from './config';
import { isPrivateIp } from './discovery';
import {
  notifySubworkerCompleted,
  notifySubworkerError,
  notifySubworkerStarted,
} from './notifications';
import { SubworkerSocket, type SocketEvent } from './socket';
import { useSettingsStore } from './settings';
import type {
  ConnectionState,
  ModelOption,
  ScheduleDetail,
  ServerHealth,
  SubworkerInfo,
} from './types';

/** Backoff starts at 1s per PLAN.md §1.2 (cap lives in config.ts). */
const RECONNECT_START_MS = 1000;

interface SubworkersState {
  connectionState: ConnectionState;
  wsError: string | null;
  statusError: string | null;
  lastError: string | null;
  subworkers: SubworkerInfo[];
  serverHealth: ServerHealth | null;
  availableModels: ModelOption[];
  mainAgentName: string;
  isLoading: boolean;

  start(): void;
  stop(): void;
  reconnect(): void;
  refreshNow(): Promise<void>;
  triggerSubworker(name: string): Promise<void>;
  enableSubworker(name: string): Promise<void>;
  disableSubworker(name: string): Promise<void>;
  fetchLogs(name: string, lines?: number): Promise<string[]>;
  setModel(name: string, modelId: string, variant: string): Promise<void>;
  setMainAgent(name: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Module-scoped runtime handles — intentionally NOT reactive state.
// ---------------------------------------------------------------------------

let api: SubworkerApi | null = null;
let socket: SubworkerSocket | null = null;
let running = false;

let statusPollTimer: ReturnType<typeof setInterval> | null = null;
let pollMode: 'fast' | 'slow' | null = null;

let healthPollTimer: ReturnType<typeof setInterval> | null = null;

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelayMs = RECONNECT_START_MS;

let settingsWatchInstalled = false;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseScheduleDetail(raw: unknown): ScheduleDetail | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.type !== 'string' || obj.type === '') return null;
  const detail: ScheduleDetail = { type: obj.type };
  if (Array.isArray(obj.hours)) {
    detail.hours = obj.hours.filter((h): h is number => typeof h === 'number');
  }
  if (typeof obj.minute === 'number') detail.minute = obj.minute;
  if (typeof obj.expression === 'string') detail.expression = obj.expression;
  return detail;
}

function mapSubworkerWithSchedule(raw: Record<string, unknown>): SubworkerInfo {
  return { ...mapSubworkerRaw(raw), scheduleDetail: parseScheduleDetail(raw.schedule) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Merge fresh rows over previous ones, preserving lastError/lastCompleted. */
function mergeSubworkers(
  incoming: SubworkerInfo[],
  previous: SubworkerInfo[],
): SubworkerInfo[] {
  const prevByName = new Map(previous.map((s) => [s.name, s]));
  return incoming.map((row) => {
    const prev = prevByName.get(row.name);
    if (!prev) return row;
    return {
      ...row,
      lastError: row.lastError ?? prev.lastError,
      lastCompleted: row.lastCompleted ?? prev.lastCompleted,
      // HTTP-mapped rows lack schedule detail — keep the WS-provided value.
      scheduleDetail: row.scheduleDetail ?? prev.scheduleDetail,
    };
  });
}

function patchSubworker(name: string, patch: Partial<SubworkerInfo>): void {
  useSubworkersStore.setState((state) => ({
    subworkers: state.subworkers.map((s) =>
      s.name === name ? { ...s, ...patch } : s,
    ),
  }));
}

/** http→ws, https→wss, ensure trailing /ws (mirror of updateBaseURL). */
function computeWsUrl(baseUrl: string): string {
  let wsUrl = baseUrl
    .replace(/^http:\/\//i, 'ws://')
    .replace(/^https:\/\//i, 'wss://');
  if (!wsUrl.endsWith('/ws')) {
    wsUrl = `${wsUrl.replace(/\/+$/, '')}/ws`;
  }
  return wsUrl;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Status polling (fast while down, slow safety-net while connected)
// ---------------------------------------------------------------------------

async function refreshNowCore(): Promise<void> {
  const client = api;
  if (!client || !running) return;
  try {
    const list = await client.getStatus();
    useSubworkersStore.setState((state) => ({
      subworkers: mergeSubworkers(list, state.subworkers),
      isLoading: false,
      statusError: null,
      lastError: null,
    }));
  } catch (err) {
    useSubworkersStore.setState({
      statusError: errMessage(err),
      isLoading: false,
    });
  }
}

function setStatusPoll(intervalMs: number, mode: 'fast' | 'slow'): void {
  if (statusPollTimer !== null) clearInterval(statusPollTimer);
  statusPollTimer = setInterval(() => {
    void refreshNowCore();
  }, intervalMs);
  pollMode = mode;
}

function stopStatusPoll(): void {
  if (statusPollTimer !== null) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
  pollMode = null;
}

function startFastPoll(): void {
  setStatusPoll(POLL_DOWN_MS, 'fast');
  void refreshNowCore(); // immediate first fetch, like Swift's startHTTPPolling
}

function startSlowPoll(): void {
  if (pollMode === 'slow') return;
  setStatusPoll(POLL_CONNECTED_MS, 'slow');
}

// ---------------------------------------------------------------------------
// Health + models + main-agent polling
// ---------------------------------------------------------------------------

async function fetchHealthCycle(): Promise<void> {
  const client = api;
  if (!client || !running) return;

  try {
    const health = await client.getServerHealth();
    useSubworkersStore.setState({ serverHealth: health });
  } catch {
    // server down — keep last known health, like Swift
  }

  // Retry until the catalog lands (first attempt may hit a restarting container).
  if (useSubworkersStore.getState().availableModels.length === 0) {
    try {
      const models = await client.getModels();
      useSubworkersStore.setState({ availableModels: models });
    } catch {
      // retried on next tick
    }
  }

  try {
    const name = await client.getMainAgent();
    if (name && name !== useSubworkersStore.getState().mainAgentName) {
      useSubworkersStore.setState({ mainAgentName: name });
    }
  } catch {
    // ignore — next tick retries
  }
}

function startHealthPoll(): void {
  if (healthPollTimer !== null) clearInterval(healthPollTimer);
  healthPollTimer = setInterval(() => {
    void fetchHealthCycle();
  }, HEALTH_POLL_MS);
  void fetchHealthCycle(); // immediate first fetch
}

// ---------------------------------------------------------------------------
// WebSocket lifecycle + reconnect backoff
// ---------------------------------------------------------------------------

function cancelReconnectTimer(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  cancelReconnectTimer();
  const delay = reconnectDelayMs;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWs();
  }, delay);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS);
}

function handleDisconnect(message: string): void {
  // RN fires onerror then onclose for one drop — handle it once.
  if (reconnectTimer !== null) return;

  useSubworkersStore.setState({
    connectionState: 'disconnected',
    wsError: message,
    statusError: message,
  });
  if (useSubworkersStore.getState().subworkers.length === 0) {
    useSubworkersStore.setState({ isLoading: false });
  }
  startFastPoll();
  scheduleReconnect();
  // NOTE: smart fallback intentionally removed — the serverUrl the user set
  // in Settings is sacred. If the Cloudflare domain is unreachable, the app
  // simply stays disconnected and retries with backoff. The user can change
  // the URL manually in Settings if needed.
}

function markConnected(): void {
  cancelReconnectTimer();
  reconnectDelayMs = RECONNECT_START_MS;
  const url = useSettingsStore.getState().serverUrl;
  const host = hostOf(url);
  if (host && isPrivateIp(host)) {
    useSettingsStore.getState().setLanUrl(url);
  }
  useSubworkersStore.setState({
    connectionState: 'connected',
    wsError: null,
    statusError: null,
  });
  startSlowPoll();
}

function connectWs(): void {
  if (!api || !running) return;
  socket?.close(); // detach any previous socket so stale events never leak

  socket = new SubworkerSocket(
    computeWsUrl(useSettingsStore.getState().serverUrl),
    {
      onOpen: () => markConnected(),
      onEvent: handleSocketEvent,
      onClose: () => handleDisconnect('WebSocket disconnected'),
      onError: (err) => handleDisconnect(err),
    },
    useSettingsStore.getState().authToken,
  );
  socket.connect();
}

// ---------------------------------------------------------------------------
// WS event handling (port of handleWSMessage + friends)
// ---------------------------------------------------------------------------

function handleSocketEvent(e: SocketEvent): void {
  switch (e.event) {
    case 'initial_status': {
      useSubworkersStore.setState((state) => ({
        subworkers: mergeSubworkers(e.subworkers.map(mapSubworkerWithSchedule), state.subworkers),
        isLoading: false,
        statusError: null,
        lastError: null,
      }));
      // initial_status also confirms a live connection.
      if (useSubworkersStore.getState().connectionState !== 'connected') {
        markConnected();
      }
      break;
    }

    case 'subworker_started':
      patchSubworker(e.name, { running: true, lastError: null });
      notifySubworkerStarted(e.name);
      break;

    case 'subworker_completed':
      patchSubworker(e.name, {
        running: false,
        lastError: null,
        lastCompleted: Date.now(),
      });
      notifySubworkerCompleted(e.name);
      break;

    case 'subworker_error':
      patchSubworker(e.name, { running: false, lastError: e.error });
      useSubworkersStore.setState({ lastError: `${e.name}: ${e.error}` });
      notifySubworkerError(e.name, e.error);
      break;

    case 'pong':
      // A pong proves the socket is alive even if we missed onopen.
      if (useSubworkersStore.getState().connectionState !== 'connected') {
        markConnected();
      }
      break;

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Settings watcher — restart the core when serverUrl changes
// ---------------------------------------------------------------------------

function installSettingsWatcher(): void {
  if (settingsWatchInstalled) return;
  settingsWatchInstalled = true;
  useSettingsStore.subscribe((state, prev) => {
    if (!running) return;
    if (state.serverUrl !== prev.serverUrl) {
      stopCore();
      startCore();
    }
  });
}

// ---------------------------------------------------------------------------
// Start / stop lifecycle
// ---------------------------------------------------------------------------

function startCore(): void {
  installSettingsWatcher();
  if (running) return;
  running = true;

  api = new SubworkerApi(
    () => useSettingsStore.getState().serverUrl,
    () => useSettingsStore.getState().authToken,
  );
  useSubworkersStore.setState({
    connectionState: 'connecting',
    wsError: null,
    statusError: null,
    isLoading: true,
  });

  startFastPoll(); // resolves loading even if WS hangs; switches to slow on open
  startHealthPoll();
  connectWs();
}

function stopCore(): void {
  running = false;
  socket?.close();
  socket = null;
  stopStatusPoll();
  if (healthPollTimer !== null) {
    clearInterval(healthPollTimer);
    healthPollTimer = null;
  }
  cancelReconnectTimer();
  reconnectDelayMs = RECONNECT_START_MS;
  useSubworkersStore.setState({
    connectionState: 'disconnected',
    isLoading: true,
    statusError: null,
  });
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSubworkersStore = create<SubworkersState>()(() => ({
  connectionState: 'connecting',
  wsError: null,
  statusError: null,
  lastError: null,
  subworkers: [],
  serverHealth: null,
  availableModels: [],
  mainAgentName: 'elia',
  isLoading: true,

  start: () => {
    startCore();
  },

  stop: () => {
    stopCore();
  },

  reconnect: () => {
    if (!running) return;
    cancelReconnectTimer();
    reconnectDelayMs = RECONNECT_START_MS;
    useSubworkersStore.setState({
      connectionState: 'connecting',
      wsError: null,
      statusError: null,
    });
    connectWs();
  },

  refreshNow: async () => {
    await refreshNowCore();
  },

  triggerSubworker: async (name: string) => {
    const client = api;
    if (!client) return;
    try {
      await client.trigger(name);
      patchSubworker(name, { running: true, lastError: null });
    } catch (err) {
      useSubworkersStore.setState({ lastError: `Trigger failed: ${errMessage(err)}` });
    }
  },

  enableSubworker: async (name: string) => {
    const client = api;
    if (!client) return;
    try {
      await client.enable(name);
      patchSubworker(name, { enabled: true });
    } catch {
      // silent, like Swift's enable handler
    }
  },

  disableSubworker: async (name: string) => {
    const client = api;
    if (!client) return;
    try {
      await client.disable(name);
      patchSubworker(name, { enabled: false });
    } catch {
      // silent, like Swift's disable handler
    }
  },

  fetchLogs: async (name: string, lines?: number) => {
    const client = api;
    if (!client) return [];
    try {
      return await client.getLogs(name, lines ?? 50);
    } catch {
      return [];
    }
  },

  setModel: async (name: string, modelId: string, variant: string) => {
    // Optimistic local update first (mirror of Swift setModel).
    patchSubworker(name, { model: modelId, variant: variant ? variant : null });
    const client = api;
    if (!client) return;
    try {
      await client.setModel(name, modelId, variant || undefined);
      useSubworkersStore.setState({ lastError: null });
    } catch (err) {
      useSubworkersStore.setState({
        lastError: `Model sync failed: ${errMessage(err)}`,
      });
    }
  },

  setMainAgent: async (name: string) => {
    const client = api;
    if (!client) return;
    try {
      await client.setMainAgent(name);
      useSubworkersStore.setState({ mainAgentName: name, lastError: null });
    } catch (err) {
      useSubworkersStore.setState({
        lastError: `Main agent set failed: ${errMessage(err)}`,
      });
    }
  },
}));
