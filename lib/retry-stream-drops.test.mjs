import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { isRetryableAssistantError } from "@earendil-works/pi-ai";
import { AgentSession } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { retryStreamDrops } = await jiti.import("./retry-stream-drops.ts");

function judge() {
  // The real SDK judge: it rules out context overflow before consulting pi-ai's list.
  const session = { _modelForMessage: () => undefined, _isRetryableError: AgentSession.prototype._isRetryableError };
  retryStreamDrops(session);
  return (errorMessage, stopReason = "error") => session._isRetryableError({ errorMessage, stopReason });
}

test("the SDK still judges retries through _isRetryableError", () => {
  assert.equal(typeof AgentSession.prototype._isRetryableError, "function");
});

test("relay stream drops are retried though pi's own list misses them", () => {
  const isRetryable = judge();
  for (const errorMessage of ["relay: http/2 stream dropped while streaming tools", "stream_read_error"]) {
    assert.equal(isRetryableAssistantError({ stopReason: "error", errorMessage }), false, errorMessage);
  }
  assert.equal(isRetryable("Upstream HTTP/2 stream failed"), true);
  assert.equal(isRetryable("HTTP/2 stream was reset (INTERNAL_ERROR)"), true);
  assert.equal(isRetryable("relay: http/2 stream dropped while streaming tools"), true);
  assert.equal(isRetryable("stream_read_error"), true);
});

test("pi's verdicts still decide everything else", () => {
  const isRetryable = judge();
  assert.equal(isRetryable("server_error: Our servers are currently overloaded."), true);
  assert.equal(isRetryable("some error we have never seen"), false);
  assert.equal(isRetryable(undefined), false);
  // A user Stop is "aborted", never retried by wording.
  assert.equal(isRetryable("Upstream HTTP/2 stream failed", "aborted"), false);
  for (const errorMessage of [
    "HTTP/2 stream",
    "model http2-large does not support streaming",
    "insufficient_quota: quota exhausted (HTTP/2 stream reset upstream)",
    "billing overdue (http/2 stream failure while sending)",
    "subscription_sharing_usage_limit_exceeded: stream_read_error",
    "Monthly usage limit reached (Upstream HTTP/2 stream failed)",
    "prompt too long: http/2 stream failed while sending 300k tokens",
    "prompt too long: http/2 stream dropped while sending 300k tokens",
  ]) {
    assert.equal(isRetryable(errorMessage), false, errorMessage);
  }
});
