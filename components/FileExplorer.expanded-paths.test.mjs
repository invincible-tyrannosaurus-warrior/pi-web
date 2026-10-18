import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

test("switching cwd restores that cwd's open folders instead of collapsing the tree", () => {
  const cwdSwitch = source.slice(source.indexOf("const cwdChanged = prevCwdRef.current !== cwd;"), source.indexOf("setRevealed(null);"));
  assert.doesNotMatch(cwdSwitch, /setExpandedPaths\(new Set\(\)\);/);
  assert.match(source, /const restored = readExpandedPaths\(cwd\);\s*setExpandedPaths\(new Set\(restored\)\);\s*rememberExpandedPaths\(cwd, restored\);/);
});

test("every folder toggle is remembered under the current cwd", () => {
  const toggle = source.slice(source.indexOf("const handleToggleExpanded = useCallback"), source.indexOf("const applyUploadResult"));
  assert.match(toggle, /setExpandedPaths\(next\);\s*rememberExpandedPaths\(cwd, \[\.\.\.next\]\);/);
  assert.match(toggle, /\}, \[cwd, expandedPaths\]\);/);
});

test("folding a folder forgets its open descendants", () => {
  const toggle = source.slice(source.indexOf("const handleToggleExpanded = useCallback"), source.indexOf("const applyUploadResult"));
  assert.match(toggle, /const prefix = `\$\{normalizeFilePathSlashes\(fullPath\)\.replace\(\/\\\/\$\/, ""\)\}\/`;/);
  assert.match(toggle, /if \(path === fullPath \|\| normalizeFilePathSlashes\(path\)\.startsWith\(prefix\)\) next\.delete\(path\);/);
});

test("collapse all clears and forgets the current cwd's open folders", () => {
  assert.match(source, /collapseAll\(\) \{\s*setExpandedPaths\(new Set\(\)\);\s*rememberExpandedPaths\(cwd, \[\]\);/);
});
