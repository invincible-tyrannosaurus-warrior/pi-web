import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const path = "./useAgentSession.ts";
const file = ts.createSourceFile(path, await readFile(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(root, predicate) {
  if (predicate(root)) return root;
  return ts.forEachChild(root, (child) => find(child, predicate));
}
function evaluate(text, bindings) {
  const js = ts.transpileModule(`return (${text});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), js)(...Object.values(bindings));
}
// The first argument of `const <name> = useCallback(fn, deps)`.
function callback(name, bindings) {
  const declaration = find(file, (node) => ts.isVariableDeclaration(node) && node.name.getText(file) === name);
  assert.ok(declaration, name);
  return evaluate(declaration.initializer.arguments[0].getText(file), bindings);
}
const cursorReset = find(file, (node) => ts.isCallExpression(node) && node.expression.getText(file) === "useEffect"
  && node.arguments[0].getText(file).includes("olderPageRef.current = null")).arguments[0].getText(file);

function harness() {
  const olderPageRef = { current: null };
  const calls = [];
  const resolvers = [];
  const fetchContextPage = (sid, leafId, before) => {
    calls.push(`${sid}/${leafId}/${before}`);
    const { promise, resolve } = Promise.withResolvers();
    resolvers.push(resolve);
    return promise;
  };
  const isOlderPageRequested = callback("isOlderPageRequested", { olderPageRef });
  const loadContext = callback("loadContext", { fetchContextPage, isOlderPageRequested, olderPageRef });
  return {
    calls, loadContext, isOlderPageRequested,
    land: (index, context) => resolvers[index](context),
    renderCursor: (historyCursor) => evaluate(cursorReset, { olderPageRef, historyCursor })(),
  };
}

test("an older cursor is fetched once until another cursor renders; a failed page can be asked again", async () => {
  const h = harness();
  const page = { oldestEntryId: "C1", hasMore: true, messages: [], entryIds: ["e1"] };
  const first = h.loadContext("s", "leaf", "C0");
  // A stale report before React renders the landed cursor shares the request.
  assert.equal(h.loadContext("s", "leaf", "C0"), first);
  assert.deepEqual(h.calls, ["s/leaf/C0"]);
  assert.equal(h.isOlderPageRequested("s", "leaf", "C0"), true);

  h.land(0, page);
  assert.deepEqual(await first, page);
  assert.equal(h.loadContext("s", "leaf", "C0"), first, "landed but not rendered yet");
  h.renderCursor("C0");
  assert.equal(h.calls.length, 1, "the page is not fetched again while its cursor is still current");
  h.renderCursor("C1");
  assert.equal(h.isOlderPageRequested("s", "leaf", "C0"), false);
  h.loadContext("s", "leaf", "C0");
  assert.equal(h.calls.length, 2, "a cursor a reload brings back can be asked for again");

  const failed = h.loadContext("s", "leaf", "C1");
  h.land(2, undefined);
  assert.equal(await failed, undefined);
  h.loadContext("s", "leaf", "C1");
  assert.equal(h.calls.length, 4, "a failed page is retried");

  h.loadContext("s", "other-leaf", "C1");
  h.loadContext("t", "leaf", "C1");
  assert.equal(h.calls.length, 6, "another session or leaf is a separate request");
});
