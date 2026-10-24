import { isContextOverflow, isRetryableAssistantError, type AssistantMessage } from "@earendil-works/pi-ai";

// shortcut: pi's RETRYABLE_PROVIDER_ERROR_PATTERN (pi-ai utils/retry.ts, 1.3.0) misses a
// relay's "Upstream HTTP/2 stream failed" and a bare "stream_read_error", so a dropped
// stream ends the run. Delete this file and its AgentSessionWrapper call once pi's list
// covers them. Adds cases only: an HTTP/2 *stream* plus a failure word in one clause.
const STREAM_DROP = /http\/?2[ _-]?stream(?!ing)[^.\n]{0,24}?(?:fail|reset|clos|terminat|abort|cancel|drop|broken|error)|\bstream_read_error\b/i;

// pi's quota/billing pattern is private. Appending a retryable status to the text makes pi's
// own classifier answer `false` only for that pattern, so its list is reused and cannot drift.
function isAccountLimit(message: AssistantMessage): boolean {
  return !isRetryableAssistantError({ ...message, stopReason: "error", errorMessage: `${message.errorMessage} 503` });
}

interface RetryJudgeHost {
  _isRetryableError?: (this: unknown, message: AssistantMessage) => boolean;
}

export function retryStreamDrops(session: object): void {
  const host = session as RetryJudgeHost;
  const original = host._isRetryableError;
  // A renamed SDK method makes this a no-op; retry-stream-drops.test.mjs pins the name.
  if (typeof original !== "function") return;
  host._isRetryableError = function (this: unknown, message: AssistantMessage): boolean {
    // pi's verdict is only ever overruled towards `true`, so nothing it retries stops retrying.
    if (original.call(this, message)) return true;
    return message.stopReason === "error"
      && !!message.errorMessage
      && !isContextOverflow(message)
      && STREAM_DROP.test(message.errorMessage)
      && !isAccountLimit(message);
  };
}
