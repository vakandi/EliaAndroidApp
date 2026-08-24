/**
 * Frozen shared contracts between all execution units (PLAN.md §5).
 * Do NOT rename or reshape — Unit B/C implement against these,
 * Units D/E/F consume them.
 */

export type AgentState = 'running' | 'idle' | 'disabled' | 'error' | 'done';

/**
 * Optional schedule detail served by newer servers (null on older ones).
 * interval → daily at each `hours` hour, `minute` past; cron → 5-field
 * expression (minute hour dom month dow, dow 0=Sunday).
 */
export interface ScheduleDetail {
  type: string;
  hours?: number[];
  minute?: number;
  expression?: string;
}

export interface SubworkerInfo {
  id: string;
  name: string;
  enabled: boolean;
  running: boolean;
  nextRun: string | null;
  scheduleType: string | null;
  scheduleDetail?: ScheduleDetail | null;
  lastError: string | null;
  lastCompleted: number | null;
  model: string | null;
  variant: string | null;
}

export interface ServerHealth {
  state: string;
  healthStatus: string;
  pid: number | null;
  restartCount: number;
}

export interface ModelOption {
  id: string;
  name: string;
  provider: string;
  variants: string[];
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface DiscoveredServer {
  ip: string;
  port: number;
  baseUrl: string;
  latencyMs: number;
  verified: boolean;
}

export type ScanError = 'not_on_wifi' | 'aborted';
