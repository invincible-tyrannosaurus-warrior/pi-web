import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createJiti } from "jiti";

const exec = promisify(execFile);
const { cleanupIsolatedWorktree, createIsolatedWorktree } = await createJiti(import.meta.url).import("./subagent-worktree.ts");
const git = (cwd, ...args) => exec("git", ["-C", cwd, ...args]);

for (const failure of ["inspection", "branch"]) {
  test(`cleanup preserves the checkout after ${failure} failure without forwarding git errors`, async (t) => {
    const repo = await mkdtemp(join(tmpdir(), "pi-web-cleanup-safety-"));
    let worktree;
    t.after(async () => {
      if (worktree) await rm(worktree.path, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    });
    await git(repo, "init", "-q");
    await git(repo, "config", "user.name", "Test");
    await git(repo, "config", "user.email", "test@example.com");
    await writeFile(join(repo, "initial"), "initial");
    await git(repo, "add", ".");
    await git(repo, "commit", "-qm", "initial");
    worktree = await createIsolatedWorktree(repo, "cleanup-safety");
    await writeFile(join(worktree.path, "child.txt"), "preserve me");
    if (failure === "inspection") {
      await writeFile(join(worktree.path, ".git"), "gitdir: /nonexistent-pi-web-test-git-dir\n");
    } else {
      // Even an already-committed clean checkout must survive failure to create its rescue branch.
      await git(worktree.path, "add", ".");
      await git(worktree.path, "commit", "-qm", "child commit");
      worktree.branch = "invalid branch";
    }
    const cleanup = await cleanupIsolatedWorktree(repo, worktree, "test");
    assert.equal(cleanup.cleanupError, failure === "inspection"
      ? "Could not inspect checkout changes." : "Could not preserve commits on a branch.");
    await stat(join(worktree.path, "child.txt"));
    assert.doesNotMatch(cleanup.cleanupError, /fatal:|--force/);
  });
}
