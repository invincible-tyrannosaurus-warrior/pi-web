import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

test("manifest reads the app name at runtime without changing other metadata", async () => {
  const { default: manifest, dynamic } = await createJiti(import.meta.url).import("./manifest.ts");
  const original = process.env.PI_WEB_APP_NAME;
  try {
    assert.equal(dynamic, "force-dynamic");
    delete process.env.PI_WEB_APP_NAME;
    const defaults = manifest();
    assert.equal(defaults.name, "Pi Web");
    assert.equal(defaults.short_name, "Pi Web");

    // Reuse the same imported function: the environment must not be captured at load time.
    for (const [value, expected] of [
      ["", "Pi Web"],
      [" \t\n ", "Pi Web"],
      ["Work Pi", "Work Pi"],
      ["  工作 Pi 🚀 \n", "工作 Pi 🚀"],
    ]) {
      process.env.PI_WEB_APP_NAME = value;
      assert.deepEqual(manifest(), { ...defaults, name: expected, short_name: expected });
    }
  } finally {
    if (original === undefined) delete process.env.PI_WEB_APP_NAME;
    else process.env.PI_WEB_APP_NAME = original;
  }
});
