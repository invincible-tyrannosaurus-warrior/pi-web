import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../instrumentation-node.ts", import.meta.url), "utf8");

test("server startup starts the pi SDK import after the dispatcher config, without waiting (#964)", () => {
  // Next waits for register() before answering requests, so the import runs in the background.
  assert.match(source, /\n {2}import\("@earendil-works\/pi-coding-agent"\)\.catch\(\(\) => \{\}\);/);
  assert.doesNotMatch(source, /await import\("@earendil-works\//);
  assert.ok(
    source.indexOf("configureHttpDispatcher(readHttpIdleTimeoutMs())") < source.indexOf('import("@earendil-works/pi-coding-agent")'),
    "the dispatcher must be configured before the SDK import starts",
  );
});
