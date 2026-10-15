import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { QuoteCard } = await jiti.import("./QuoteCard.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const render = (quote) => renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(QuoteCard, { quote })));
const chipText = (html) => html.match(/<span class="quote-chip-text">([\s\S]*)<\/span><\/button>/)[1];

test("typesets inline and display math inline in the chip", () => {
  const text = chipText(render({ text: "前文\n$$\nIR \\approx IC \\times \\sqrt{N}\n$$\n其中 $N$ 是次数" }));
  assert.equal((text.match(/class="katex"/g) ?? []).length, 2);
  assert.doesNotMatch(text, /katex-display|\$/);
  assert.match(text, /^前文 <span>/);
  assert.match(text, /<\/span> 其中 <span>/);
});

test("leaves prices and file excerpts as plain text", () => {
  assert.doesNotMatch(render({ text: "costs $5 and $10" }), /katex/);
  assert.doesNotMatch(render({ text: "const a = $x$;", file: "a.ts", lines: "1" }), /katex/);
});
