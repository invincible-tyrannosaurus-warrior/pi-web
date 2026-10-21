import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { TimingRecorder, foldModelTiming, MODEL_TIMING_TYPE } = await jiti.import("./model-timing.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");

function assistant(timestamp, output, stopReason = "stop") {
  return {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    api: "openai-completions",
    provider: "test",
    model: "m",
    usage: { input: 1, output, cacheRead: 0, cacheWrite: 0, totalTokens: 1 + output, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason,
    timestamp,
  };
}

/** Replays one call: request at `at`, events at the given clock times, ending at `end`. */
function call(recorder, clock, message, updates, end) {
  recorder.observe({ type: "message_start", message });
  for (const [time, update] of updates) {
    clock.now = time;
    recorder.observe({ type: "message_update", message, assistantMessageEvent: update });
  }
  clock.now = end;
  recorder.observe({ type: "message_end", message });
}

test("records TTFT from the first non-empty delta, thinking included, and skips failed calls", () => {
  const clock = { now: 0 };
  const recorder = new TimingRecorder(() => clock.now);
  const entries = [];
  const sm = { appendCustomEntry: (customType, data) => { entries.push({ customType, data }); return "x"; } };

  call(recorder, clock, assistant(1_000, 60), [
    [1_100, { type: "text_start" }],
    [1_200, { type: "thinking_delta", delta: "" }],
    [1_800, { type: "thinking_delta", delta: "hm" }],
    [2_000, { type: "text_delta", delta: "ok" }],
  ], 4_800);
  call(recorder, clock, assistant(5_000, 3), [[5_300, { type: "toolcall_start" }]], 5_400);
  call(recorder, clock, assistant(6_000, 0, "aborted"), [[6_100, { type: "text_delta", delta: "x" }]], 6_200);
  call(recorder, clock, assistant(7_000, 0, "error"), [], 7_100);

  recorder.flush(sm);
  recorder.flush(sm); // nothing pending: no second entry
  assert.deepEqual(entries, [{
    customType: MODEL_TIMING_TYPE,
    data: { v: 1, calls: [{ at: 1_000, ttft: 800, gen: 3_000 }, { at: 5_000, ttft: 300, gen: 100 }] },
  }]);
});

test("persisted timing stays out of model context and folds with ratio-of-sums speed", () => {
  const sm = SessionManager.inMemory("/tmp");
  sm.appendMessage({ role: "user", content: "hi", timestamp: 900 });
  sm.appendMessage(assistant(1_000, 60));
  sm.appendMessage(assistant(5_000, 3));
  const recorder = new TimingRecorder();
  recorder.pending = [{ at: 1_000, ttft: 800, gen: 3_000 }, { at: 5_000, ttft: 300, gen: 100 }, { at: 9_999, ttft: 100, gen: 50 }];
  recorder.flush(sm);
  sm.appendMessage({ role: "user", content: "next", timestamp: 10_000 });

  assert.equal(sm.buildSessionContext().messages.length, 4);
  assert.deepEqual(foldModelTiming(sm.getEntries()), {
    calls: 3,
    ttftMs: 1_200,
    // The call without a matching assistant message has no output tokens: excluded from speed.
    genMs: 3_100,
    genTokens: 63,
  });
});

test("ignores malformed timing entries", () => {
  const entries = [
    { type: "custom", customType: MODEL_TIMING_TYPE, data: { v: 2, calls: [{ at: 1, ttft: 1, gen: 1 }] } },
    { type: "custom", customType: MODEL_TIMING_TYPE, data: { v: 1, calls: [{ at: 1, ttft: -1, gen: 1 }, null, { at: 1, ttft: "1", gen: 1 }] } },
  ];
  assert.equal(foldModelTiming(entries).calls, 0);
});

test("reply group: average TTFT and summed speed over its recorded calls", async () => {
  const { turnModelTiming, formatModelTiming } = await jiti.import("./model-timing.ts");
  assert.equal(turnModelTiming([{ usage: { output: 5 } }]), null);
  const timing = turnModelTiming([
    { modelTiming: { at: 1, ttft: 2_000, gen: 500 }, usage: { output: 50 } },
    { usage: { output: 9 } }, // no record (e.g. aborted): ignored
    { modelTiming: { at: 2, ttft: 900, gen: 1_500 }, usage: { output: 150 } },
  ]);
  assert.deepEqual(timing, { calls: 2, ttftMs: 2_900, genMs: 2_000, genTokens: 200 });
  assert.deepEqual(formatModelTiming(timing), { ttft: "1.4s", tps: "100 tok/s", text: "1.4s · 100 tok/s" });
});

test("session reader attaches each call's record, even when the timing entry is past the page", async () => {
  const { buildSessionContext } = await jiti.import("./session-reader.ts");
  const sm = SessionManager.inMemory("/tmp");
  sm.appendMessage({ role: "user", content: "hi", timestamp: 900 });
  const assistantId = sm.appendMessage(assistant(1_000, 60));
  const recorder = new TimingRecorder();
  recorder.pending = [{ at: 1_000, ttft: 800, gen: 3_000 }];
  recorder.flush(sm);
  const entries = sm.getEntries();

  const full = buildSessionContext(entries);
  assert.deepEqual(full.messages.at(-1).modelTiming, { at: 1_000, ttft: 800, gen: 3_000 });
  // An older page ending at the assistant: the timing entry lies outside the slice.
  const page = buildSessionContext(entries, assistantId, { tail: 2 });
  assert.deepEqual(page.messages.at(-1).modelTiming, { at: 1_000, ttft: 800, gen: 3_000 });
});
