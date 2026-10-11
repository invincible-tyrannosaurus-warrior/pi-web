import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

test("switching cwd restores that cwd's open folders instead of collapsing the tree", () => {
  assert.doesNotMatch(source, /setExpandedPaths\(new Set\(\)\);/);
  assert.match(source, /const restored = readExpandedPaths\(cwd\);\s*setExpandedPaths\(new Set\(restored\)\);\s*rememberExpandedPaths\(cwd, restored\);/);
});

test("every folder toggle is remembered under the current cwd", () => {
  const toggle = source.slice(source.indexOf("const handleToggleExpanded = useCallback"), source.indexOf("const applyUploadResult"));
  assert.match(toggle, /const next = new Set\(expandedPaths\);\s*if \(open\) next\.add\(fullPath\); else next\.delete\(fullPath\);\s*setExpandedPaths\(next\);\s*rememberExpandedPaths\(cwd, \[\.\.\.next\]\);/);
  assert.match(toggle, /\}, \[cwd, expandedPaths\]\);/);
});
