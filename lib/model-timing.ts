// Per-call model latency (TTFT, decode speed), measured locally like DeepSeek Harness's
// session-stats fold. Pi records no stream timing, so pi-web appends it as a custom entry.
// Observed latency: it includes the awaited extension handlers that run before pi-web's listener.
import type { SessionEntry } from "./types";

export const MODEL_TIMING_TYPE = "pi-web:model-timing";

/** One LLM call: `at` is the assistant `message.timestamp` (set by pi-ai before the request). */
export interface TimingCall {
  at: number;
  /** request start → first non-empty token delta (thinking included), ms. */
  ttft: number;
  /** first token → message end, ms. */
  gen: number;
}

export interface ModelTiming {
  /** Calls with a recorded first token. */
  calls: number;
  ttftMs: number;
  /** Summed decode time over calls whose output tokens are known. */
  genMs: number;
  genTokens: number;
}

export const emptyModelTiming = (): ModelTiming => ({ calls: 0, ttftMs: 0, genMs: 0, genTokens: 0 });

/** Display strings shared by the composer readout and the session panel. */
/** Display parts; `text` is "TTFT · TPS", e.g. "2.0s · 41 tok/s". Null without recorded calls. */
export function formatModelTiming(timing: ModelTiming | null | undefined): { ttft: string; tps: string | null; text: string } | null {
  if (!timing || timing.calls === 0) return null;
  const ttft = `${(timing.ttftMs / timing.calls / 1000).toFixed(1)}s`;
  const tps = timing.genMs > 0 ? `${Math.round(timing.genTokens / (timing.genMs / 1000))} tok/s` : null;
  return { ttft, tps, text: tps ? `${ttft} · ${tps}` : ttft };
}

interface TimingEvent {
  type: string;
  message?: unknown;
  assistantMessageEvent?: unknown;
}

function isTokenDelta(update: unknown): boolean {
  if (typeof update !== "object" || update === null) return false;
  const { type, delta } = update as { type?: unknown; delta?: unknown };
  if (type === "toolcall_start") return true;
  return (type === "text_delta" || type === "thinking_delta" || type === "toolcall_delta")
    && typeof delta === "string" && delta !== "";
}

/** Collects calls from AgentSession events; `flush()` persists them in one entry per run. */
export class TimingRecorder {
  private firstTokenAt: number | null = null;
  private pending: TimingCall[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  observe(event: TimingEvent): void {
    const role = (event.message as { role?: unknown } | undefined)?.role;
    if (event.type === "message_start" && role === "assistant") {
      this.firstTokenAt = null;
    } else if (event.type === "message_update") {
      if (this.firstTokenAt === null && isTokenDelta(event.assistantMessageEvent)) this.firstTokenAt = this.now();
    } else if (event.type === "message_end" && role === "assistant") {
      const { timestamp, stopReason } = event.message as { timestamp?: unknown; stopReason?: unknown };
      const first = this.firstTokenAt;
      this.firstTokenAt = null;
      // Like dsh, a cancelled or failed call stays uncounted.
      if (first === null || typeof timestamp !== "number" || stopReason === "error" || stopReason === "aborted") return;
      this.pending.push({ at: timestamp, ttft: Math.max(0, first - timestamp), gen: Math.max(0, this.now() - first) });
    }
  }

  /** Called at `turn_end` (and `agent_end`), so the entry never lands between a tool call and its result. */
  flush(sessionManager: { appendCustomEntry(customType: string, data?: unknown): string }): void {
    if (this.pending.length === 0) return;
    const calls = this.pending;
    this.pending = [];
    sessionManager.appendCustomEntry(MODEL_TIMING_TYPE, { v: 1, calls });
  }
}

function isTimingCall(value: unknown): value is TimingCall {
  const call = value as TimingCall;
  return typeof call === "object" && call !== null
    && [call.at, call.ttft, call.gen].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);
}

/** The valid calls of one `pi-web:model-timing` entry's data. */
export function parseTimingCalls(data: unknown): TimingCall[] {
  const { v, calls } = (data ?? {}) as { v?: unknown; calls?: unknown };
  return v === 1 && Array.isArray(calls) ? calls.filter(isTimingCall) : [];
}

/** Recorded calls keyed by their assistant `message.timestamp`. */
export function timingCallsByAt(entries: readonly SessionEntry[]): Map<number, TimingCall> {
  const calls = new Map<number, TimingCall>();
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== MODEL_TIMING_TYPE) continue;
    for (const call of parseTimingCalls(entry.data)) calls.set(call.at, call);
  }
  return calls;
}

function outputTokens(message: { usage?: { output?: unknown } }): number | undefined {
  const output = message.usage?.output;
  return typeof output === "number" && Number.isFinite(output) && output >= 0 ? output : undefined;
}

/** Whole-file fold; output tokens come from the matching assistant message's usage. */
export function foldModelTiming(entries: readonly SessionEntry[]): ModelTiming {
  const outputByTimestamp = new Map<number, number>();
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const output = outputTokens(entry.message);
    if (typeof entry.message.timestamp === "number" && output !== undefined) outputByTimestamp.set(entry.message.timestamp, output);
  }
  const timing = emptyModelTiming();
  for (const call of timingCallsByAt(entries).values()) {
    timing.calls += 1;
    timing.ttftMs += call.ttft;
    const output = outputByTimestamp.get(call.at);
    if (output !== undefined) {
      timing.genMs += call.gen;
      timing.genTokens += output;
    }
  }
  return timing;
}

/** One reply group (a prompt's assistant calls): the session math over just these calls. */
export function turnModelTiming(messages: readonly { modelTiming?: TimingCall; usage?: { output?: unknown } }[]): ModelTiming | null {
  let timing: ModelTiming | null = null;
  for (const message of messages) {
    const call = message.modelTiming;
    if (!call) continue;
    timing ??= emptyModelTiming();
    timing.calls += 1;
    timing.ttftMs += call.ttft;
    const output = outputTokens(message);
    if (output !== undefined) {
      timing.genMs += call.gen;
      timing.genTokens += output;
    }
  }
  return timing;
}
