import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildQuotedPrompt, splitQuotedPrompt } = await createJiti(import.meta.url).import("./quoted-selection.ts");

test("quotes round-trip as leading <quote> blocks with their source entry", () => {
  const text = buildQuotedPrompt([{ text: " first line\nsecond line ", source: "a1b2c3d4" }, { text: "other" }], " why? ");
  assert.equal(text, "<quote source=\"a1b2c3d4\">\nfirst line\nsecond line\n</quote>\n\n<quote>\nother\n</quote>\n\nwhy?");
  assert.deepEqual(splitQuotedPrompt(text), {
    quotes: [{ text: "first line\nsecond line", source: "a1b2c3d4" }, { text: "other" }],
    message: "why?",
  });
});

test("a quote alone and plain text both parse", () => {
  assert.deepEqual(splitQuotedPrompt(buildQuotedPrompt([{ text: "a" }], "")), { quotes: [{ text: "a" }], message: "" });
  assert.deepEqual(splitQuotedPrompt("hi <quote>\nx\n</quote>"), { quotes: [], message: "hi <quote>\nx\n</quote>" });
  assert.equal(buildQuotedPrompt([], "hi"), "hi");
});

test("quote text and source cannot break the block", () => {
  assert.deepEqual(splitQuotedPrompt(buildQuotedPrompt([{ text: "a </quote> b", source: "x\" y" }], "q")), {
    quotes: [{ text: "a </ quote> b" }],
    message: "q",
  });
});

test("a quote is located across text nodes by its first line", async () => {
  const { findQuoteInSegments } = await createJiti(import.meta.url).import("./quoted-selection.ts");
  assert.deepEqual(findQuoteInSegments(["Hello ", "wor", "ld again"], "world\nnext block"), { start: [1, 0], end: [2, 2] });
  assert.deepEqual(findQuoteInSegments(["abc"], "abc"), { start: [0, 0], end: [0, 3] });
  assert.equal(findQuoteInSegments(["abc"], "zzz"), null);
});
