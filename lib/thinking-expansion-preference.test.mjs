import assert from "node:assert/strict";
import test from "node:test";

import { createJiti } from "jiti";

const {
  isThinkingExpandedByDefault,
  setThinkingExpandedByDefault,
  THINKING_EXPANDED_EVENT,
} = await createJiti(import.meta.url).import("./thinking-expansion-preference.ts");

function installWindow() {
  const store = new Map();
  const listeners = new Set();
  const fakeWindow = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    addEventListener: (_type, handler) => listeners.add(handler),
    removeEventListener: (_type, handler) => listeners.delete(handler),
    dispatchEvent: (event) => {
      for (const handler of listeners) handler(event);
      return true;
    },
  };
  globalThis.window = fakeWindow;
  return { fakeWindow, listeners };
}

test("defaults to collapsed when no preference is stored", () => {
  installWindow();
  assert.equal(isThinkingExpandedByDefault(), false);
});

test("persists the preference and notifies listeners on change", () => {
  installWindow();
  let notified = 0;
  globalThis.window.addEventListener(THINKING_EXPANDED_EVENT, () => notified++);

  setThinkingExpandedByDefault(true);
  assert.equal(isThinkingExpandedByDefault(), true);
  assert.equal(notified, 1);

  setThinkingExpandedByDefault(false);
  assert.equal(isThinkingExpandedByDefault(), false);
  assert.equal(notified, 2);
});

test("returns false when window is unavailable (SSR)", () => {
  const original = globalThis.window;
  delete globalThis.window;
  try {
    assert.equal(isThinkingExpandedByDefault(), false);
  } finally {
    if (original !== undefined) globalThis.window = original;
  }
});

test("blocked storage falls back to collapsed, and a change still applies to this page", () => {
  const { fakeWindow } = installWindow();
  let notified = 0;
  fakeWindow.addEventListener(THINKING_EXPANDED_EVENT, () => notified++);
  Object.defineProperty(fakeWindow, "localStorage", {
    get() { throw new DOMException("blocked", "SecurityError"); },
  });
  assert.equal(isThinkingExpandedByDefault(), false);
  assert.doesNotThrow(() => setThinkingExpandedByDefault(true));
  assert.equal(isThinkingExpandedByDefault(), true, "the switch and the behavior agree");
  assert.equal(notified, 1);
});
