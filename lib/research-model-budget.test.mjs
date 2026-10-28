import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { researchModelBudget, withResearchModelDeadline } = await createJiti(import.meta.url).import("./research-model-budget.ts");

test("research calls have bounded deadlines and exactly one outer retry owner", () => {
  assert.deepEqual(researchModelBudget(), { timeoutMs: 240000, maxRetries: 0 });
  for (const value of [0, 601, 1.5, "240", NaN]) assert.throws(() => researchModelBudget(value));
});

test("the invocation receives its explicit deadline and successful requests settle normally", async () => {
  assert.equal(await withResearchModelDeadline(new AbortController().signal, 2, async options => {
    assert.equal(options.maxRetries, 0);
    assert.equal(options.timeoutMs, 2000);
    assert.equal(options.signal.aborted, false);
    return "completed";
  }), "completed");
});

test("a hung provider is bounded even when it fails to settle after abort", async () => {
  let signal;
  const started = Date.now();
  await assert.rejects(withResearchModelDeadline(new AbortController().signal, 1, async options => {
    signal = options.signal;
    return await new Promise(() => {});
  }), /deadline exceeded/);
  assert.equal(signal.aborted, true);
  assert.ok(Date.now() - started < 4000);
});

test("disconnect aborts the provider and an already aborted request never invokes it", async () => {
  const controller = new AbortController();
  const request = withResearchModelDeadline(controller.signal, 30, async () => await new Promise(() => {}));
  controller.abort(new Error("client disconnected"));
  await assert.rejects(request, /client disconnected/);
  await assert.rejects(withResearchModelDeadline(controller.signal, 30, () => assert.fail("must not start")), /client disconnected/);
});
