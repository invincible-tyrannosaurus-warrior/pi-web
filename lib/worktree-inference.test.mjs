import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createJiti } from "jiti";

const { invalidateProjectCache, resolveProject } = await createJiti(import.meta.url).import("./worktree.ts");

test("removed worktree inference requires core.bare=true, not just HEAD/objects/refs", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "pi-web-inference-"));
  t.after(() => { invalidateProjectCache(); return rm(temp, { recursive: true, force: true }); });
  const root = join(temp, "repo.git");
  const removed = `${root}-worktrees/removed`;
  await mkdir(join(root, "objects"), { recursive: true });
  await mkdir(join(root, "refs"));
  await writeFile(join(root, "HEAD"), "ref: refs/heads/main\n");
  const check = async (expected) => {
    invalidateProjectCache();
    const info = await resolveProject(removed);
    assert.equal(info.isWorktree, expected);
    assert.equal(info.isTopLevel, expected);
    assert.equal(info.projectRoot, expected ? root : removed);
  };
  await check(false); // Ordinary folders with Git-looking names, without config.
  for (const config of ["[core]\n bare = false\n", "[remote]\n bare = true\n", "[core]\n[other]\n bare = true\n"]) {
    await writeFile(join(root, "config"), config);
    await check(false);
  }
  await writeFile(join(root, "config"), "[core]\n repositoryformatversion = 0\n bare = true\n");
  // Read-only Git validation of the fixture; no init/clone/config writes.
  const { stdout } = await promisify(execFile)("git", ["-C", root, "rev-parse", "--is-bare-repository"]);
  assert.equal(stdout.trim(), "true");
  await check(true);
  await writeFile(join(root, "config"), " \t[ CoRe ] \r\n \tBaRe \t= \tTrUe \t; comment\r\n[remote]\nbare = false\n");
  await check(true);
  await rm(join(root, "refs"), { recursive: true });
  await check(false); // Config alone is not sufficient either.
});
