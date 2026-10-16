import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { anchorFromRects, placeSelectionToolbar } = await createJiti(import.meta.url).import("./selection-toolbar.ts");

const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
const bounds = { top: 40, bottom: 840, left: 100, right: 900 };
const toolbar = { width: 200, height: 28 };

test("one line: centered over the selected words", () => {
  const words = rect(300, 400, 400, 420);
  assert.deepEqual(anchorFromRects([words], words), { x: 350, top: 400, bottom: 420 });
});

test("several lines: anchored to the first line, from the selection start to the line end", () => {
  const first = rect(500, 400, 880, 420);
  const anchor = anchorFromRects([first, rect(120, 420, 880, 440), rect(120, 440, 300, 460)], rect(120, 400, 880, 460));
  assert.deepEqual(anchor, { x: 690, top: 400, bottom: 460 });
});

test("skips empty line boxes and returns null for an empty range", () => {
  assert.equal(anchorFromRects([], rect(0, 0, 0, 0)), null);
  const words = rect(300, 400, 400, 420);
  assert.equal(anchorFromRects([rect(0, 0, 0, 0), words], words).x, 350);
});

test("goes above the first line, flips below the last when there is no room", () => {
  const anchor = { x: 500, top: 400, bottom: 460 };
  assert.deepEqual(placeSelectionToolbar(anchor, toolbar, bounds), { top: 366, left: 400, side: "above" });
  const nearTop = { x: 500, top: 60, bottom: 120 };
  assert.deepEqual(placeSelectionToolbar(nearTop, toolbar, bounds), { top: 126, left: 400, side: "below" });
});

test("touch prefers below; a kept side grows away from the text", () => {
  const anchor = { x: 500, top: 400, bottom: 460 };
  assert.equal(placeSelectionToolbar(anchor, toolbar, bounds, { preferBelow: true }).side, "below");
  const grown = placeSelectionToolbar(anchor, { width: 420, height: 160 }, bounds, { side: "above" });
  assert.equal(grown.top + 160, 394);
});

test("stays inside the bounds horizontally and vertically", () => {
  assert.equal(placeSelectionToolbar({ x: 110, top: 400, bottom: 420 }, toolbar, bounds).left, 108);
  assert.equal(placeSelectionToolbar({ x: 890, top: 400, bottom: 420 }, toolbar, bounds).left, 692);
  // A long selection running past both edges: the toolbar stays on screen.
  const top = placeSelectionToolbar({ x: 500, top: 20, bottom: 2000 }, toolbar, bounds).top;
  assert.ok(top >= 48 && top + 28 <= 832);
});
