import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  checkSessionMembership,
  listSessionsIncremental,
  resetSessionScanIndexForTests,
  SESSION_MEMBERSHIP_CHECK_MS,
} = await jiti.import("./session-list-scanner.ts");
const { getSessionListVersion, invalidateSessionListCache, listAllSessions } = await jiti.import("./session-reader.ts");

const header = (id) => JSON.stringify({ type: "session", version: 3, id, cwd: "/tmp", timestamp: "2026-01-01T00:00:00.000Z" }) + "\n";

function fixture(t) {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const root = fs.mkdtempSync(join(tmpdir(), "pi-web-membership-"));
  const sessions = join(root, "sessions");
  fs.mkdirSync(join(sessions, "project"), { recursive: true });
  process.env.PI_CODING_AGENT_DIR = root;
  resetSessionScanIndexForTests();
  invalidateSessionListCache();
  t.after(() => {
    resetSessionScanIndexForTests();
    invalidateSessionListCache();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    sessions,
    write(id) {
      const path = join(sessions, "project", `${id}.jsonl`);
      fs.writeFileSync(path, header(id));
      return path;
    },
  };
}

test("the running poll's version read finds a session another process created, once", async (t) => {
  const f = fixture(t);
  await listAllSessions();
  const before = getSessionListVersion();

  f.write("external");
  const deadline = Date.now() + 3000;
  while (getSessionListVersion() === before && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const bumped = getSessionListVersion();
  assert.ok(bumped > before, "a new file must advance the version without a force refresh");

  await new Promise((resolve) => setTimeout(resolve, SESSION_MEMBERSHIP_CHECK_MS + 100));
  assert.equal(getSessionListVersion(), bumped, "later polls with no membership change must not bump");
});

test("membership checks: none before a scan, throttled, one at a time, stale results dropped", async (t) => {
  const f = fixture(t);
  let changes = 0;
  const onChange = () => changes++;
  assert.equal(checkSessionMembership(f.sessions, onChange, 1_000_000), undefined, "no check before the first scan");

  const a = f.write("a");
  await listSessionsIncremental();

  fs.appendFileSync(a, JSON.stringify({ type: "message", id: "1" }) + "\n");
  await checkSessionMembership(f.sessions, onChange, 2_000_000);
  assert.equal(changes, 0, "appends keep the filename, so they never count");

  const b = f.write("b");
  const running = checkSessionMembership(f.sessions, onChange, 3_000_000);
  assert.ok(running);
  assert.equal(checkSessionMembership(f.sessions, onChange, 9_000_000), undefined, "never two at once");
  // A scan that records its listing while the check reads replaces the baseline.
  globalThis.__piSessionMembership = { files: new Set([a, b]) };
  await running;
  assert.equal(changes, 0, "the overtaken check is dropped");

  assert.equal(checkSessionMembership(f.sessions, onChange, 3_000_000 + SESSION_MEMBERSHIP_CHECK_MS - 1), undefined, "at most one per interval");
  await checkSessionMembership(f.sessions, onChange, 3_000_000 + SESSION_MEMBERSHIP_CHECK_MS);
  assert.equal(changes, 0);

  fs.rmSync(a);
  await checkSessionMembership(f.sessions, onChange, 3_000_000 + 2 * SESSION_MEMBERSHIP_CHECK_MS);
  assert.equal(changes, 1, "a removed file bumps once");
  await checkSessionMembership(f.sessions, onChange, 3_000_000 + 3 * SESSION_MEMBERSHIP_CHECK_MS);
  assert.equal(changes, 1, "not again until the next scan");
});
