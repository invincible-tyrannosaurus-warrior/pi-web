import assert from "node:assert/strict";
import test from "node:test";
import { shareProducedFile } from "./save-file.ts";

function mockShare(outcomes) {
  const shared = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      canShare: () => true,
      share: async ({ files }) => {
        shared.push(files[0]);
        const outcome = outcomes.shift();
        if (outcome) throw new DOMException("", outcome);
      },
    },
  });
  return shared;
}

test("an expired share keeps the file so the next tap shares it without producing again", async () => {
  const shared = mockShare(["NotAllowedError", undefined]);
  let produced = 0;
  const produce = async () => new File([String(++produced)], "a.png");

  assert.equal((await shareProducedFile("a", produce)).result, "retry");
  const retry = shareProducedFile("a", produce);
  // share() must be reached synchronously, inside the tap's activation.
  assert.equal(shared.length, 2);
  assert.equal((await retry).result, "shared");
  assert.equal(produced, 1);
  assert.equal(shared[0], shared[1]);
});

test("a second expiry falls back to download, and a different key produces a fresh file", async () => {
  mockShare(["NotAllowedError", "NotAllowedError", "AbortError"]);
  let produced = 0;
  const produce = async () => new File([String(++produced)], "a.png");

  await shareProducedFile("a", produce);
  assert.equal((await shareProducedFile("a", produce)).result, "unavailable");
  assert.equal((await shareProducedFile("b", produce)).result, "canceled");
  assert.equal(produced, 2);
});
