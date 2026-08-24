/**
 * Session/chat contracts for PLAN.md §8 (Phase 2 — Chat IA).
 * Wire format comes from the subworkers server:
 *   GET /sessions/{name}/list → {name, sessions:[{session_id, title, agent,
 *     model, time_created, message_count}]}
 *   GET /sessions/{name}?limit=N → {name, session_id, total_messages,
 *     messages:[{info:{role, agent, model, variant, time_created},
 *     parts:[{type, text, tool, input, output}]}]}
 */

/** One content block inside a chat message (text / reasoning / tool call…). */
export interface MessagePart {
  /** e.g. 'step-start' | 'reasoning' | 'text' | 'tool' | 'unknown'. */
  type: string;
  text?: string | null;
  /** Tool name when type === 'tool'. */
  tool?: string | null;
  /** Tool call input payload (server guarantees an object or null). */
  input?: Record<string, unknown> | null;
  /** Tool call output, truncated server-side at 8000 chars. */
  output?: string | null;
}

/** Envelope of a chat message: who sent it, when, with what model. */
export interface ChatMessageInfo {
  role: string | null;
  agent: string | null;
  model: string | null;
  variant: string | null;
  /** Epoch milliseconds. */
  timeCreated: number | null;
}

export interface ChatMessage {
  info: ChatMessageInfo;
  parts: MessagePart[];
}

/** One row of the per-agent sessions list. */
export interface SessionSummary {
  sessionId: string;
  title: string | null;
  agent: string | null;
  model: string | null;
  /** Epoch milliseconds. */
  timeCreated: number | null;
  messageCount: number | null;
}
