import assert from "node:assert/strict";
import { syncBuiltinESMExports } from "node:module";
import fs from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { DELETE } = await jiti.import("./route.ts");
const { cacheSessionPath, invalidateSessionPathCache, invalidateSessionListCache } = await jiti.import("../../../lib/session-reader.ts");
const { updateSidebarState, readSidebarState, getSidebarStatePath } = await jiti.import("../../../lib/sidebar-state.ts");
const { readSessionFileRecord } = await jiti.import("../../../lib/session-delete.ts");
const { DELETE: singleDelete } = await jiti.import("./[id]/route.ts");
const bulk = (ids) => DELETE(new Request("http://localhost/api/sessions", { method: "DELETE", body: JSON.stringify({ ids }) }));

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "session-bulk-delete-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  const previousRegistry = globalThis.__piSessions;
  process.env.PI_CODING_AGENT_DIR = dir;
  globalThis.__piSessions = new Map();
  invalidateSessionListCache();
  const sessionsDir = join(dir, "sessions", "fixture");
  await mkdir(sessionsDir, { recursive: true });
  const ids = [];
  t.after(async () => {
    for (const id of ids) invalidateSessionPathCache(id);
    invalidateSessionListCache();
    globalThis.__piSessions = previousRegistry;
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    async session(id, parentSession, subagent = false, directory = sessionsDir) {
      await mkdir(directory, { recursive: true });
      const path = join(directory, `${id}.jsonl`);
      const header = { type: "session", version: 3, id, cwd: directory, timestamp: "2026-01-01T00:00:00.000Z", ...(parentSession ? { parentSession } : {}) };
      const entries = [header];
      if (subagent) entries.push({ type: "custom", customType: "pi-web:subagent", id: "meta", parentId: null, timestamp: header.timestamp,
        data: { version: 1, parentSessionId: "root", parentSessionPath: parentSession, profile: "Explore", description: "Preserve this transcript" } });
      entries.push({ type: "message", id: "user", parentId: null, timestamp: header.timestamp, message: { role: "user", content: `keep ${id}` } });
      await writeFile(path, entries.map(JSON.stringify).join("\n") + "\n");
      cacheSessionPath(id, path);
      ids.push(id);
      return path;
    },
  };
}

test("bulk delete validates every id and the cap before touching any session", async (t) => {
  const f = await fixture(t);
  const path = await f.session("safe");
  const original = await readFile(path, "utf8");
  for (const ids of [undefined, [], "safe", [null], [1], ["safe", "../escape"], ["/tmp/a"], ["__proto__"], ["x".repeat(257)], Array(501).fill("safe")]) {
    assert.equal((await bulk(ids)).status, 400, JSON.stringify(ids));
    assert.equal(await readFile(path, "utf8"), original);
  }
  assert.equal((await DELETE(new Request("http://localhost/api/sessions", { method: "DELETE", body: "{bad" }))).status, 400);
  const result = await (await bulk(Array(500).fill("safe"))).json();
  assert.equal(result.results.length, 1, "deduplicates after bounding the input");
  assert.equal(result.results[0].ok, true);
});

test("bulk delete refuses running and busy sessions but reports independent successes", async (t) => {
  const f = await fixture(t);
  const runningPath = await f.session("running");
  const busyPath = await f.session("busy");
  const idlePath = await f.session("idle");
  globalThis.__piSessions.set("running", { isRunning: () => true });
  globalThis.__piSessions.set("busy", { isRunning: () => false, isBusyForFileMutation: () => true });
  const response = await bulk(["running", "idle", "missing", "busy"]);
  assert.equal(response.status, 200);
  const { results } = await response.json();
  assert.deepEqual(results.map(({ id, ok, status }) => ({ id, ok, status })), [
    { id: "running", ok: false, status: 409 }, { id: "idle", ok: true, status: 200 },
    { id: "missing", ok: false, status: 404 }, { id: "busy", ok: false, status: 409 },
  ]);
  assert.match(await readFile(runningPath, "utf8"), /keep running/);
  assert.match(await readFile(busyPath, "utf8"), /keep busy/);
  await assert.rejects(readFile(idlePath), { code: "ENOENT" });
});

test("single and bulk root deletion cascade subagent families, reparent forks, and clean sidebar ids", async (t) => {
  for (const mode of ["single", "bulk"]) await t.test(mode, async (t) => {
    const f = await fixture(t);
    const root = await f.session("root");
    const fork = await f.session("fork", root);
    const child = await f.session("child", root, true);
    const nested = await f.session("nested", child, true);
    const childFork = await f.session("child-fork", child);
    const other = await f.session("other");
    await updateSidebarState(["root", "child", "other"], { pinned: true });
    await updateSidebarState(["root"], { archived: true });
    const otherBytes = await readFile(other, "utf8");
    const result = mode === "bulk" ? (await (await bulk(["root"])).json()).results[0]
      : await (await singleDelete(new Request("http://localhost/api/sessions/root", { method: "DELETE" }),
        { params: Promise.resolve({ id: "root" }) })).json();
    assert.equal(result.ok, true);
    assert.deepEqual(new Set(result.deletedSessionIds), new Set(["root", "child", "nested", "child-fork"]));
    for (const path of [root, child, nested, childFork]) await assert.rejects(readFile(path), { code: "ENOENT" });
    assert.equal(JSON.parse((await readFile(fork, "utf8")).split("\n")[0]).parentSession, undefined);
    assert.equal(await readFile(other, "utf8"), otherBytes);
    assert.deepEqual(readSidebarState().archived, {});
    assert.deepEqual(readSidebarState().pinned, ["other"]);
  });
});

test("deleting an intermediate selected fork reparents its children to the surviving ancestor", async (t) => {
  const f = await fixture(t);
  const root = await f.session("root");
  const fork = await f.session("fork", root);
  const child = await f.session("child", fork, true);
  const { results } = await (await bulk(["fork"])).json();
  assert.equal(results[0].ok, true);
  const record = readSessionFileRecord(child);
  assert.equal(record.parentPath, root);
  const meta = record.entries.find((entry) => entry.customType === "pi-web:subagent");
  assert.equal(meta.data.parentSessionId, "root");
  assert.equal(meta.data.parentSessionPath, root);
});

test("a running child blocks a parent's reparenting plan without changing either file", async (t) => {
  const f = await fixture(t);
  const root = await f.session("root");
  const fork = await f.session("fork", root);
  const original = await readFile(fork, "utf8");
  globalThis.__piSessions.set("fork", { isBusyForFileMutation: () => true });
  const { results } = await (await bulk(["root"])).json();
  assert.equal(results[0].status, 409);
  assert.equal(await readFile(fork, "utf8"), original);
  assert.match(await readFile(root, "utf8"), /keep root/);
});

test("stale id-to-path mappings are refused before rewriting the wrong transcript", async (t) => {
  const f = await fixture(t);
  const path = await f.session("safe");
  const original = await readFile(path, "utf8");
  cacheSessionPath("wrong-id", path);
  t.after(() => invalidateSessionPathCache("wrong-id"));
  const { results } = await (await bulk(["wrong-id"])).json();
  assert.equal(results[0].status, 409);
  assert.equal(await readFile(path, "utf8"), original);
});

test("selected ancestors can be deleted in either order without deleting an unselected descendant", async (t) => {
  for (const ids of [["root", "fork"], ["fork", "root"]]) await t.test(ids.join(","), async (t) => {
    const f = await fixture(t);
    const root = await f.session("root");
    const fork = await f.session("fork", root);
    const child = await f.session("child", fork);
    const { results } = await (await bulk(ids)).json();
    assert.deepEqual(results.map((result) => result.ok), [true, true]);
    assert.equal(JSON.parse((await readFile(child, "utf8")).split("\n")[0]).parentSession, undefined);
    assert.match(await readFile(child, "utf8"), /keep child/);
  });
});

test("bulk delete bounds actual JSON bytes before parsing, with and without Content-Length", async (t) => {
  const f = await fixture(t);
  const path = await f.session("safe");
  const original = await readFile(path, "utf8");
  const body = JSON.stringify({ ids: ["safe"] });
  const declared = new Request("http://localhost/api/sessions", { method: "DELETE", headers: { "content-length": "65537" }, body });
  assert.equal((await DELETE(declared)).status, 413);
  for (const headers of [{}, { "content-length": "1" }]) {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.enqueue(new Uint8Array(64 * 1024).fill(32));
      },
      cancel() { cancelled = true; },
    });
    const request = new Request("http://localhost/api/sessions", { method: "DELETE", headers, body: stream, duplex: "half" });
    assert.equal((await DELETE(request)).status, 413);
    assert.equal(cancelled, true);
    assert.equal(await readFile(path, "utf8"), original);
  }
  const exactLimit = body.padEnd(64 * 1024, " ");
  const response = await DELETE(new Request("http://localhost/api/sessions", { method: "DELETE", body: exactLimit }));
  assert.equal((await response.json()).results[0].ok, true);
});

test("cached and runtime paths cannot escape through symlinked directories or nonregular files", async (t) => {
  const f = await fixture(t);
  const outside = join(f.dir, "outside");
  const path = await f.session("outside", undefined, false, outside);
  const original = await readFile(path, "utf8");
  const linked = join(f.dir, "sessions", "linked");
  await symlink(outside, linked, "dir");
  cacheSessionPath("outside", join(linked, "outside.jsonl"));
  assert.equal((await (await bulk(["outside"])).json()).results[0].status, 403);
  assert.equal(await readFile(path, "utf8"), original);
  invalidateSessionPathCache("outside");
  globalThis.__piSessions.set("runtime", { sessionFile: path, isRunning: () => false, shutdown: async () => assert.fail("outside runtime must not be shut down") });
  assert.equal((await (await bulk(["runtime"])).json()).results[0].status, 403);
  assert.equal(await readFile(path, "utf8"), original);
  invalidateSessionPathCache("runtime");
  const directory = join(f.dir, "sessions", "directory.jsonl");
  await mkdir(directory);
  cacheSessionPath("directory", directory);
  t.after(() => invalidateSessionPathCache("directory"));
  assert.equal((await (await bulk(["directory"])).json()).results[0].status, 403);
  const wrongSuffix = join(f.dir, "sessions", "not-jsonl.txt");
  await writeFile(wrongSuffix, original);
  cacheSessionPath("wrong-suffix", wrongSuffix);
  t.after(() => invalidateSessionPathCache("wrong-suffix"));
  assert.equal((await (await bulk(["wrong-suffix"])).json()).results[0].status, 403);
});

test("per-id header scans never read unrelated transcript bodies", async (t) => {
  const f = await fixture(t);
  const targets = [];
  for (let i = 0; i < 6; i++) targets.push(await f.session(`target-${i}`));
  const unrelated = await f.session("unrelated");
  await writeFile(unrelated, (await readFile(unrelated, "utf8")) + "x".repeat(1024 * 1024));
  const originalRead = fs.readFileSync;
  const originalList = fs.readdirSync;
  const bodiesRead = [];
  let directoryScans = 0;
  t.mock.method(fs, "readFileSync", function (path, ...args) {
    if (typeof path === "string" && path.endsWith(".jsonl")) bodiesRead.push(path);
    return originalRead.call(this, path, ...args);
  });
  t.mock.method(fs, "readdirSync", function (path, ...args) {
    if (String(path) === join(f.dir, "sessions", "fixture")) directoryScans++;
    return originalList.call(this, path, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  // jiti snapshots builtin imports, so compile the profiled route after installing the spies.
  const profiled = await createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false }).import("./route.ts");
  const response = await profiled.DELETE(new Request("http://localhost/api/sessions", {
    method: "DELETE", body: JSON.stringify({ ids: targets.map((_, i) => `target-${i}`) }),
  }));
  const { results } = await response.json();
  assert.ok(results.every((result) => result.ok), JSON.stringify(results));
  assert.equal(directoryScans, targets.length);
  assert.equal(bodiesRead.includes(unrelated), false);
  assert.ok(targets.every((path) => bodiesRead.includes(path)), "affected files are read for consistency and usage accounting");
});

test("affected children outside the real sessions root are refused before any mutation", async (t) => {
  const f = await fixture(t);
  const root = await f.session("root");
  const outside = await f.session("child", root, true, join(f.dir, "outside"));
  const original = await readFile(outside, "utf8");
  await symlink(outside, join(f.dir, "sessions", "fixture", "child.jsonl"));
  const { results } = await (await bulk(["root"])).json();
  assert.equal(results[0].status, 403);
  assert.equal(await readFile(outside, "utf8"), original);
  assert.match(await readFile(root, "utf8"), /keep root/);
});

test("pre-commit verification refuses changes to any affected file without rewriting forks", async (t) => {
  for (const changed of ["root", "child", "fork"]) await t.test(changed, async (t) => {
    const f = await fixture(t);
    const root = await f.session("root");
    const child = await f.session("child", root, true);
    const fork = await f.session("fork", root);
    const paths = { root, child, fork };
    const original = await readFile(paths[changed], "utf8");
    globalThis.__piSessions.set("root", { isBusyForFileMutation: () => false,
      shutdown: async () => writeFile(paths[changed], original.replace(`keep ${changed}`, "changed!!")) });
    const { results } = await (await bulk(["root"])).json();
    assert.equal(results[0].status, 409);
    assert.match(await readFile(paths[changed], "utf8"), /changed!!/);
    assert.equal(JSON.parse((await readFile(fork, "utf8")).split("\n")[0]).parentSession, root);
    for (const path of [root, child]) assert.ok(await readFile(path, "utf8"));
  });
});

test("sidebar cleanup failure reports committed ids with a warning and preserves corrupt state", async (t) => {
  const f = await fixture(t);
  const root = await f.session("root");
  const path = getSidebarStatePath();
  await mkdir(join(f.dir, "pi-web"), { recursive: true });
  await writeFile(path, "{broken");
  const { results } = await (await bulk(["root"])).json();
  assert.equal(results[0].ok, true);
  assert.deepEqual(results[0].deletedSessionIds, ["root"]);
  assert.match(results[0].warning, /Corrupt sidebar state/);
  assert.equal(await readFile(path, "utf8"), "{broken");
  await assert.rejects(readFile(root), { code: "ENOENT" });
});
