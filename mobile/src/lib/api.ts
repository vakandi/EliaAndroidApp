/**
 * REST client for the EliaAgent FastAPI server (PLAN.md §1.2).
 * Unit B implementation — fetch-based, zero native modules.
 * All JSON keys arrive snake_case and are mapped to the camelCase
 * contracts in types.ts (next_run→nextRun, schedule_type→scheduleType,
 * health_status→healthStatus, restart_count→restartCount).
 */
import type {
  ModelOption,
  ServerHealth,
  SubworkerInfo,
} from './types';
import type {
  ChatMessage,
  MessagePart,
  SessionSummary,
} from './session-types';

/** Throw a clear Error when the HTTP response is not OK. */
function assertOk(res: Response, context: string): void {
  if (!res.ok) {
    throw new Error(`${context} failed: HTTP ${res.status}`);
  }
}

/** Parse the body as JSON with a clear error on malformed payloads. */
async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await res.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('response is not a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON from ${res.url}: ${reason}`);
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Map one raw /status or initial_status entry to SubworkerInfo. */
export function mapSubworkerRaw(raw: Record<string, unknown>): SubworkerInfo {
  const name = typeof raw.name === 'string' ? raw.name : '';
  return {
    id: name,
    name,
    enabled: raw.enabled === true,
    running: raw.running === true,
    nextRun: str(raw.next_run),
    scheduleType: str(raw.schedule_type),
    // Server never sends these; the store preserves them across refreshes.
    lastError: null,
    lastCompleted: null,
    model: str(raw.model),
    variant: str(raw.variant),
  };
}

function mapModelRaw(raw: Record<string, unknown>): ModelOption | null {
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  return {
    id: raw.id,
    name: str(raw.name) ?? raw.id,
    provider: str(raw.provider) ?? '',
    variants: Array.isArray(raw.variants)
      ? raw.variants.filter((v): v is string => typeof v === 'string')
      : [],
  };
}

function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function mapMessagePartRaw(raw: Record<string, unknown>): MessagePart {
  return {
    type: str(raw.type) ?? 'unknown',
    text: str(raw.text),
    tool: str(raw.tool),
    input:
      typeof raw.input === 'object' && raw.input !== null && !Array.isArray(raw.input)
        ? (raw.input as Record<string, unknown>)
        : null,
    output: str(raw.output),
  };
}

function mapChatMessageRaw(raw: Record<string, unknown>): ChatMessage | null {
  const infoRaw =
    typeof raw.info === 'object' && raw.info !== null
      ? (raw.info as Record<string, unknown>)
      : {};
  const partsRaw = Array.isArray(raw.parts) ? raw.parts : [];
  return {
    info: {
      role: str(infoRaw.role),
      agent: str(infoRaw.agent),
      model: str(infoRaw.model),
      variant: str(infoRaw.variant),
      timeCreated: num(infoRaw.time_created),
    },
    parts: partsRaw
      .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
      .map(mapMessagePartRaw),
  };
}

function mapSessionSummaryRaw(raw: Record<string, unknown>): SessionSummary | null {
  const sessionId = str(raw.session_id);
  if (!sessionId) return null;
  return {
    sessionId,
    title: str(raw.title),
    agent: str(raw.agent),
    model: str(raw.model),
    timeCreated: num(raw.time_created),
    messageCount: num(raw.message_count),
  };
}

export class SubworkerApi {
  constructor(
    private getBaseUrl: () => string,
    private getAuthToken: () => string = () => '',
  ) {}

  /** Both shared-token headers; empty object when no token is configured. */
  private authHeaders(token?: string): Record<string, string> {
    const value = token ?? this.getAuthToken();
    if (!value) return {};
    return { Authorization: `Bearer ${value}`, 'X-Elia-Token': value };
  }

  /** GET /status → subworkers list */
  async getStatus(): Promise<SubworkerInfo[]> {
    const res = await fetch(`${this.getBaseUrl()}/status`, {
      headers: this.authHeaders(),
    });
    assertOk(res, 'Status');
    const json = await readJson(res);
    const list = json.subworkers;
    if (!Array.isArray(list)) throw new Error('Invalid /status response');
    return list
      .filter((raw): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null)
      .map(mapSubworkerRaw);
  }

  /** GET /server/health → state, pid, restarts */
  async getServerHealth(): Promise<ServerHealth> {
    const res = await fetch(`${this.getBaseUrl()}/server/health`, {
      headers: this.authHeaders(),
    });
    assertOk(res, 'Server health');
    const json = await readJson(res);
    return {
      state: str(json.state) ?? 'unknown',
      healthStatus: str(json.health_status) ?? 'unknown',
      pid: typeof json.pid === 'number' ? json.pid : null,
      restartCount: typeof json.restart_count === 'number' ? json.restart_count : 0,
    };
  }

  /** POST /trigger/{name} */
  async trigger(name: string): Promise<void> {
    const res = await fetch(
      `${this.getBaseUrl()}/trigger/${encodeURIComponent(name)}`,
      { method: 'POST', headers: this.authHeaders() },
    );
    assertOk(res, `Trigger ${name}`);
  }

  /** POST /enable/{name} */
  async enable(name: string): Promise<void> {
    const res = await fetch(
      `${this.getBaseUrl()}/enable/${encodeURIComponent(name)}`,
      { method: 'POST', headers: this.authHeaders() },
    );
    assertOk(res, `Enable ${name}`);
  }

  /** POST /disable/{name} */
  async disable(name: string): Promise<void> {
    const res = await fetch(
      `${this.getBaseUrl()}/disable/${encodeURIComponent(name)}`,
      { method: 'POST', headers: this.authHeaders() },
    );
    assertOk(res, `Disable ${name}`);
  }

  /** GET /logs/{name}?lines=N → log lines */
  async getLogs(name: string, lines?: number): Promise<string[]> {
    const count = lines ?? 50;
    const res = await fetch(
      `${this.getBaseUrl()}/logs/${encodeURIComponent(name)}?lines=${count}`,
      { headers: this.authHeaders() },
    );
    assertOk(res, `Logs ${name}`);
    const json = await readJson(res);
    if (!Array.isArray(json.lines)) return [];
    return json.lines.filter((line): line is string => typeof line === 'string');
  }

  /** GET /models → model catalog (500+ entries) */
  async getModels(): Promise<ModelOption[]> {
    const res = await fetch(`${this.getBaseUrl()}/models`, {
      headers: this.authHeaders(),
    });
    assertOk(res, 'Models');
    const json = await readJson(res);
    if (!Array.isArray(json.models)) throw new Error('Invalid /models response');
    const options: ModelOption[] = [];
    for (const raw of json.models) {
      if (typeof raw !== 'object' || raw === null) continue;
      const mapped = mapModelRaw(raw as Record<string, unknown>);
      if (mapped) options.push(mapped);
    }
    return options;
  }

  /** PUT /status/{name} with {model, variant?} */
  async setModel(name: string, modelId: string, variant?: string): Promise<void> {
    const body: Record<string, string> = { model: modelId };
    if (variant) body.variant = variant;
    const res = await fetch(
      `${this.getBaseUrl()}/status/${encodeURIComponent(name)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        body: JSON.stringify(body),
      },
    );
    assertOk(res, `Set model ${name}`);
  }

  /** GET /main-agent → current main agent name */
  async getMainAgent(): Promise<string> {
    const res = await fetch(`${this.getBaseUrl()}/main-agent`, {
      headers: this.authHeaders(),
    });
    assertOk(res, 'Main agent');
    const json = await readJson(res);
    const name = str(json.name);
    if (!name) throw new Error('Invalid /main-agent response');
    return name;
  }

  /** POST /main-agent with {name} */
  async setMainAgent(name: string): Promise<void> {
    const res = await fetch(`${this.getBaseUrl()}/main-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({ name }),
    });
    assertOk(res, `Set main agent ${name}`);
  }

  /** GET /sessions/{name}/list → per-agent session summaries */
  async getSessionsList(name: string): Promise<SessionSummary[]> {
    const res = await fetch(
      `${this.getBaseUrl()}/sessions/${encodeURIComponent(name)}/list`,
      { headers: this.authHeaders() },
    );
    assertOk(res, `Sessions list ${name}`);
    const json = await readJson(res);
    if (!Array.isArray(json.sessions)) return [];
    const summaries: SessionSummary[] = [];
    for (const raw of json.sessions) {
      if (typeof raw !== 'object' || raw === null) continue;
      const mapped = mapSessionSummaryRaw(raw as Record<string, unknown>);
      if (mapped) summaries.push(mapped);
    }
    return summaries;
  }

  /** GET /sessions/{name}?limit=N[&session_id=…] → chat messages */
  async getSessionMessages(
    name: string,
    sessionId?: string,
    limit?: number,
  ): Promise<ChatMessage[]> {
    const count = limit ?? 50;
    let url = `${this.getBaseUrl()}/sessions/${encodeURIComponent(name)}?limit=${count}`;
    if (sessionId) url += `&session_id=${encodeURIComponent(sessionId)}`;
    const res = await fetch(url, { headers: this.authHeaders() });
    assertOk(res, `Session messages ${name}`);
    const json = await readJson(res);
    const rawMessages = Array.isArray(json.messages) ? json.messages : [];
    const messages: ChatMessage[] = [];
    for (const raw of rawMessages) {
      if (typeof raw !== 'object' || raw === null) continue;
      const mapped = mapChatMessageRaw(raw as Record<string, unknown>);
      if (mapped) messages.push(mapped);
    }
    return messages;
  }

  /**
   * One-shot health probe used by LAN discovery and "Test connection".
   * Resolves true iff baseUrl answers /server/health within timeoutMs
   * and the JSON payload contains a `state` key. When authToken is
   * non-empty both shared-token headers are attached.
   */
  static async probeHealth(
    baseUrl: string,
    timeoutMs: number,
    authToken = '',
  ): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${baseUrl.replace(/\/+$/, '')}/server/health`;
      const headers: Record<string, string> = {};
      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
        headers['X-Elia-Token'] = authToken;
      }
      const res = await fetch(url, { signal: controller.signal, headers });
      if (!res.ok) return false;
      const json: unknown = await res.json();
      return typeof json === 'object' && json !== null && 'state' in json;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
