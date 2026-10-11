import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { FILE_TREE_EXPANSION_STORAGE_KEY: KEY, MAX_REMEMBERED_FILE_TREE_CWDS, readExpandedPaths, rememberExpandedPaths } =
  await createJiti(import.meta.url).import("./file-tree-expansion.ts");

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) };
}

test("each cwd gets back its own open folders; collapsing everything forgets that cwd", () => {
  const storage = memoryStorage();
  rememberExpandedPaths("/work/a", ["/work/a/src", "/work/a/src/lib"], storage);
  rememberExpandedPaths("/work/b", ["/work/b/docs"], storage);
  assert.deepEqual(readExpandedPaths("/work/a", storage), ["/work/a/src", "/work/a/src/lib"]);
  assert.deepEqual(readExpandedPaths("/work/b", storage), ["/work/b/docs"]);
  assert.deepEqual(readExpandedPaths("/work/c", storage), []);
  rememberExpandedPaths("/work/b", [], storage);
  assert.deepEqual(readExpandedPaths("/work/b", storage), []);
  assert.deepEqual(readExpandedPaths("/work/a", storage), ["/work/a/src", "/work/a/src/lib"]);
});

test("keeps at most 20 cwds, dropping the least recently used; a visit counts as use", () => {
  const storage = memoryStorage();
  for (let i = 0; i < MAX_REMEMBERED_FILE_TREE_CWDS; i++) rememberExpandedPaths(`/p/${i}`, [`/p/${i}/x`], storage);
  // Going back to the oldest project (which re-records it) makes it the newest.
  rememberExpandedPaths("/p/0", readExpandedPaths("/p/0", storage), storage);
  rememberExpandedPaths("/p/new", ["/p/new/y"], storage);
  const kept = JSON.parse(storage.getItem(KEY)).map((entry) => entry.cwd);
  assert.equal(kept.length, MAX_REMEMBERED_FILE_TREE_CWDS);
  assert.equal(kept[0], "/p/new");
  assert.ok(kept.includes("/p/0"));
  assert.ok(!kept.includes("/p/1"));
  assert.deepEqual(readExpandedPaths("/p/1", storage), []);
});

test("missing, malformed or refusing storage reads as nothing open and never throws", () => {
  assert.deepEqual(readExpandedPaths("/a", undefined), []);
  assert.deepEqual(readExpandedPaths("/a", memoryStorage({ [KEY]: "{broken" })), []);
  assert.deepEqual(readExpandedPaths("/a", memoryStorage({ [KEY]: '{"/a":["x"]}' })), []);
  assert.deepEqual(readExpandedPaths("/a", memoryStorage({ [KEY]: '[{"cwd":"/a","paths":[1]}]' })), []);
  const refusing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); } };
  assert.deepEqual(readExpandedPaths("/a", refusing), []);
  assert.doesNotThrow(() => rememberExpandedPaths("/a", ["/a/b"], refusing));
  // A malformed entry is skipped; valid entries beside it still restore.
  const mixed = memoryStorage({ [KEY]: '[{"cwd":"/x"},{"cwd":"/a","paths":["/a/b"]}]' });
  assert.deepEqual(readExpandedPaths("/a", mixed), ["/a/b"]);
});
