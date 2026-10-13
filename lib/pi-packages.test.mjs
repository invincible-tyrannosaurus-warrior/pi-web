import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
const packageLock = require("../package-lock.json");

// pi's packages depend on each other with `^` ranges and the published package
// ships no lockfile, so a global install resolves them afresh. Pinning every pi
// package in the tree as an exact direct dependency makes npm reuse those
// versions; pinning only four let pi-coding-agent 1.1.0 meet pi-codemode 1.2.0
// (missing MCP_TYPESCRIPT_PREAMBLE export, HTTP 500 everywhere).
const PI_SCOPE = "@earendil-works/";

test("every pi package in the tree is a direct dependency pinned to its locked version", () => {
  const nameOf = (path) => path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
  const locked = Object.entries(packageLock.packages).filter(([path]) => nameOf(path).startsWith(PI_SCOPE));
  assert.ok(locked.length > 0, "the lockfile holds pi packages");
  for (const [path, entry] of locked) {
    const name = nameOf(path);
    assert.equal(path, `node_modules/${name}`, `${path}: a second copy of ${name}`);
    assert.equal(packageJson.dependencies[name], entry.version, `${name} must be a dependency pinned to ${entry.version}`);
    assert.equal(entry.version, packageJson.dependencies[`${PI_SCOPE}pi-coding-agent`], `${name} must match pi-coding-agent's version`);
  }
  for (const [name, version] of Object.entries(packageJson.dependencies)) {
    if (!name.startsWith(PI_SCOPE)) continue;
    assert.equal(packageLock.packages[`node_modules/${name}`]?.version, version, `${name} is pinned but not locked at ${version}`);
  }
});
