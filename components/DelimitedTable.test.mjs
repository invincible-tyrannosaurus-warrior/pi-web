import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { DelimitedTable } = await jiti.import("./DelimitedTable.tsx");

// Server render: no scroll box is attached, so the first screen is the initial window.
function render(content, complete = true) {
  return renderToStaticMarkup(React.createElement(DelimitedTable, {
    content,
    filePath: "/tmp/data.csv",
    complete,
    scrollRef: { current: null },
  }));
}

test("header row plus a gutter with the file line each record starts on", () => {
  const html = render('name,note\nalice,"two\nlines"\nbob,x\n');
  assert.match(html, /<th class="file-table-gutter" scope="col">1<\/th>/);
  assert.match(html, />name<\/th>/);
  // The multi-line record starts on line 2, so bob is line 4, not record 3.
  assert.deepEqual([...html.matchAll(/file-table-gutter">(\d+)</g)].map((m) => m[1]), ["2", "4"]);
});

test("renders only the first screen and keeps the full height with spacer rows", () => {
  const records = Array.from({ length: 1000 }, (_, index) => String(index)).join("\n");
  const html = render(`n\n${records}\n`);
  const rendered = html.match(/class="file-table-row/g).length;
  assert.ok(rendered > 20 && rendered < 100, `rendered ${rendered} rows`);
  const bottom = Number(html.match(/class="file-table-spacer" style="height:(\d+)px"/)[1]);
  assert.equal(bottom, (1000 - rendered) * 26);
});

test("a loaded prefix leaves out its cut last record", () => {
  const rowsIn = (html) => (html.match(/class="file-table-row/g) ?? []).length;
  assert.equal(rowsIn(render("a\n1\n2", false)), 1);
  assert.equal(rowsIn(render("a\n1\n2", true)), 2);
});

test("an empty file renders nothing", () => {
  assert.equal(render(""), "");
});
