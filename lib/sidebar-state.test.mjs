import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { getSidebarStatePath, readSidebarState, updateSidebarState, updateProjectOrder, updateProjectName } = await createJiti(import.meta.url).import("./sidebar-state.ts");
test("project writes share the pin/archive lock, are idempotent, and retain hidden slots", async (t) => {
  const path = fixture(t);
  await updateProjectOrder({ addProjects: ["a", "hidden", "b", "c", "d"] }, path);
  const bytes = readFileSync(path, "utf8");
  assert.equal((await updateProjectOrder({ addProjects: ["c", "a"] }, path)).changed, false);
  assert.equal(readFileSync(path, "utf8"), bytes);
  await Promise.all([
    updateProjectOrder({ move: "d", before: "b" }, path),
    updateProjectOrder({ move: "c", before: "a" }, path),
    updateSidebarState(["root"], { pinned: true }, path),
    updateSidebarState(["other"], { archived: true }, path),
  ]);
  const state = readSidebarState(path);
  assert.deepEqual(state.projectOrder, ["c", "a", "hidden", "d", "b"]);
  assert.deepEqual(state.pinned, ["root"]);
  assert.ok(state.archived.other);
  await assert.rejects(updateProjectOrder({ move: "a", before: "b", after: "c" }, path), /Invalid/);
  await assert.rejects(updateProjectOrder({ addProjects: ["__proto__"] }, path), /Invalid/);
});

test("invalid persisted order refuses all writes instead of discarding pins or oversized state", async (t) => {
  const path = fixture(t);
  for (const projectOrder of [null, ["a", "a"], [""], Array.from({ length: 1001 }, (_, i) => String(i)),
    Array.from({ length: 80 }, (_, i) => `${i}` + "中".repeat(4000))]) {
    const bytes = JSON.stringify({ version: 1, pinned: ["root"], archived: {}, projectOrder });
    writeFileSync(path, bytes);
    await assert.rejects(updateProjectOrder({ addProjects: ["a"] }, path), /Corrupt sidebar state/);
    await assert.rejects(updateSidebarState(["root"], { archived: true }, path), /Corrupt sidebar state/);
    assert.equal(readFileSync(path, "utf8"), bytes);
  }
});

test("project names share the locked file: set, clear, keep pins and order, and refuse writes when full", async (t) => {
  const path = fixture(t);
  await updateSidebarState(["root"], { pinned: true }, path);
  await updateProjectOrder({ addProjects: ["/work/a"] }, path);
  assert.equal(await updateProjectName("/work/a", "Alpha", path), true);
  assert.equal(await updateProjectName("/work/b", "Beta", path), true);
  assert.deepEqual(readSidebarState(path).projectNames, { "/work/a": "Alpha", "/work/b": "Beta" });
  assert.equal(await updateProjectName("/work/a", "", path), true);
  const state = readSidebarState(path);
  assert.deepEqual(state.projectNames, { "/work/b": "Beta" });
  assert.deepEqual(state.pinned, ["root"]);
  assert.deepEqual(state.projectOrder, ["/work/a"]);

  // Full store: a new name is refused and the file keeps its exact bytes.
  const full = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`/work/p${i}`, "n"]));
  writeFileSync(path, JSON.stringify({ version: 1, pinned: [], archived: {}, projectNames: full }));
  const bytes = readFileSync(path, "utf8");
  assert.equal(await updateProjectName("/work/new", "New", path), false);
  assert.equal(readFileSync(path, "utf8"), bytes);
  // Renaming an existing key does not need a new slot.
  assert.equal(await updateProjectName("/work/p1", "Renamed", path), true);
  assert.equal(readSidebarState(path).projectNames["/work/p1"], "Renamed");

  await assert.rejects(updateProjectName("__proto__", "x", path), /Invalid project name update/);
  await assert.rejects(updateProjectName("/work/a", " x\ny", path), /Invalid project name update/);
});

test("a malformed project name field makes the state corrupt, like the other fields", async (t) => {
  const path = fixture(t);
  writeFileSync(path, JSON.stringify({ version: 1, pinned: [], archived: {}, projectNames: { "/work/a": "" } }));
  assert.deepEqual(readSidebarState(path), { version: 1, pinned: [], archived: {} });
  await assert.rejects(updateProjectName("/work/b", "B", path), /Corrupt sidebar state/);
});

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "sidebar-state-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = getSidebarStatePath(dir);
  mkdirSync(dirname(path));
  return path;
}

test("missing state seeds legacy pins and migrates without touching the old file", async (t) => {
  const path = fixture(t);
  const legacy = join(dirname(path), "pinned-sessions.json");
  writeFileSync(legacy, '["old"]');
  assert.deepEqual(readSidebarState(path), { version: 1, pinned: ["old"], archived: {} });
  assert.equal(existsSync(path), false, "reads do not write");
  await updateSidebarState(["new"], { pinned: true }, path);
  assert.deepEqual(readSidebarState(path).pinned, ["old", "new"]);
  assert.equal(readFileSync(legacy, "utf8"), '["old"]');
  writeFileSync(legacy, '["ignored"]');
  assert.deepEqual(readSidebarState(path).pinned, ["old", "new"]);
});

test("pin and archive exclude each other, and unknown fields survive writes", async (t) => {
  const path = fixture(t);
  writeFileSync(path, JSON.stringify({ version: 1, pinned: ["a"], archived: {}, projectOrder: ["p2", "p1"], future: { keep: true } }));
  await updateSidebarState(["a"], { archived: true }, path);
  let state = readSidebarState(path);
  assert.deepEqual(state.pinned, []);
  assert.equal(new Date(state.archived.a).toISOString(), state.archived.a);
  await updateSidebarState(["a"], { pinned: true }, path);
  state = readSidebarState(path);
  assert.deepEqual(state.pinned, ["a"]);
  assert.deepEqual(state.archived, {});
  assert.deepEqual(state.projectOrder, ["p2", "p1"]);
  assert.deepEqual(state.future, { keep: true });
  await updateSidebarState(["b"], { archived: true }, path);
  await updateSidebarState(["b"], { archived: false }, path);
  assert.deepEqual(readSidebarState(path).archived, {});
});

test("corrupt state reads as empty but refuses writes and preserves its exact bytes", async (t) => {
  const path = fixture(t);
  for (const text of ["{broken", "null", "[]", '{"version":2,"pinned":[],"archived":{}}', '{"version":1,"pinned":[],"archived":{"a":"invalid"}}']) {
    writeFileSync(path, text);
    assert.deepEqual(readSidebarState(path), { version: 1, pinned: [], archived: {} });
    await assert.rejects(updateSidebarState(["a"], { pinned: true }, path), /Corrupt sidebar state.*refusing to overwrite/);
    assert.equal(readFileSync(path, "utf8"), text);
  }
});

test("concurrent first writes preserve migration and both updates under the file lock", async (t) => {
  const path = fixture(t);
  writeFileSync(join(dirname(path), "pinned-sessions.json"), '["legacy"]');
  await Promise.all([
    updateSidebarState(["a"], { pinned: true }, path),
    updateSidebarState(["b"], { archived: true }, path),
  ]);
  const state = readSidebarState(path);
  assert.deepEqual(new Set(state.pinned), new Set(["legacy", "a"]));
  assert.ok(state.archived.b);
});

test("invalid ids and ambiguous updates are rejected before creating state", async (t) => {
  const path = fixture(t);
  await assert.rejects(updateSidebarState(["__proto__"], { archived: true }, path), /Invalid session ids/);
  await assert.rejects(updateSidebarState(["a"], { archived: true, pinned: true }, path), /exactly one/);
  assert.equal(existsSync(path), false);
});
