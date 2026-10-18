import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveScopedResources, setGlobalResourceEnabled, setProjectOverrides } = await jiti.import("./project-resource-overrides.ts");

function skill(dir, name) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\n`);
  return join(dir, name, "SKILL.md");
}

function setup(globalPackage) {
  const root = mkdtempSync(join(tmpdir(), "pi-overrides-"));
  const agentDir = join(root, "agent");
  const pkgDir = join(root, "pkg");
  const cwd = join(root, "project");
  mkdirSync(cwd, { recursive: true });
  const a = skill(join(pkgDir, "skills"), "pkg-a");
  const b = skill(join(pkgDir, "skills"), "pkg-b");
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "pkg", pi: { skills: ["./skills"] } }));
  const solo = skill(join(agentDir, "skills"), "solo");
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [globalPackage(pkgDir)] }));
  return { agentDir, cwd, a, b, solo };
}

const projectSettings = (cwd) => JSON.parse(readFileSync(join(cwd, ".pi/settings.json"), "utf8"));

async function state(cwd, agentDir, path) {
  const { resources } = await resolveScopedResources(cwd, agentDir);
  const found = resources.find((r) => r.type === "skills" && r.path === path);
  return found && { enabled: found.enabled, override: found.override, globalEnabled: found.globalEnabled };
}

test("package resource: turning off writes an autoload:false delta; turning back on drops it", async () => {
  const { agentDir, cwd, a, b } = setup((dir) => dir);
  await setProjectOverrides(cwd, agentDir, [{ type: "skills", path: a }], false);

  const [entry] = projectSettings(cwd).packages;
  assert.equal(entry.autoload, false);
  assert.deepEqual(entry.skills, ["-skills/pkg-a/SKILL.md"]);
  assert.deepEqual(await state(cwd, agentDir, a), { enabled: false, override: "unload", globalEnabled: true });
  assert.deepEqual(await state(cwd, agentDir, b), { enabled: true, override: "inherit", globalEnabled: true });

  await setProjectOverrides(cwd, agentDir, [{ type: "skills", path: a }], true);
  assert.deepEqual(projectSettings(cwd).packages, []);
  assert.deepEqual(await state(cwd, agentDir, a), { enabled: true, override: "inherit", globalEnabled: true });
});

test("package disabled globally can be loaded in one project only", async () => {
  const { agentDir, cwd, a, b } = setup((dir) => ({ source: dir, skills: [] }));
  assert.deepEqual(await state(cwd, agentDir, b), { enabled: false, override: "inherit", globalEnabled: false });

  await setProjectOverrides(cwd, agentDir, [{ type: "skills", path: b }], true);
  assert.deepEqual(await state(cwd, agentDir, b), { enabled: true, override: "load", globalEnabled: false });
  assert.equal((await state(cwd, agentDir, a)).enabled, false);

  await setProjectOverrides(cwd, agentDir, [{ type: "skills", path: b }], false);
  assert.deepEqual(projectSettings(cwd).packages, []);
});

test("refuses to write over an unreadable project settings file", async () => {
  const { agentDir, cwd, a } = setup((dir) => dir);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi/settings.json"), "{ broken");
  new ProjectTrustStore(agentDir).set(cwd, true);
  await assert.rejects(setProjectOverrides(cwd, agentDir, [{ type: "skills", path: a }], false), /Cannot read/);
  assert.equal(readFileSync(join(cwd, ".pi/settings.json"), "utf8"), "{ broken");
});

test("top-level skill: project unload uses absolute path patterns", async () => {
  const { agentDir, cwd, solo } = setup((dir) => dir);
  await setProjectOverrides(cwd, agentDir, [{ type: "skills", path: solo }], false);

  assert.deepEqual(projectSettings(cwd).skills, [solo, `-${solo}`]);
  assert.deepEqual(await state(cwd, agentDir, solo), { enabled: false, override: "unload", globalEnabled: true });

  await setProjectOverrides(cwd, agentDir, [{ type: "skills", path: solo }], true);
  assert.deepEqual(projectSettings(cwd).skills, []);
  assert.equal((await state(cwd, agentDir, solo)).enabled, true);
});

test("hand-written project entries are read-only", async () => {
  const { agentDir, cwd, a } = setup((dir) => dir);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi/settings.json"), JSON.stringify({
    packages: [{ source: "../../pkg", autoload: false, skills: ["!**"] }],
  }));
  new ProjectTrustStore(agentDir).set(cwd, true);
  const { resources } = await resolveScopedResources(cwd, agentDir);
  const found = resources.find((r) => r.path === a);
  assert.equal(found.enabled, false);
  assert.equal(found.editable, false);
  await assert.rejects(setProjectOverrides(cwd, agentDir, [{ type: "skills", path: a }], true), /hand-written/);
});

test("global toggle writes +/- entries into user settings like `pi config`", async () => {
  const { agentDir, cwd, a, b, solo } = setup((dir) => dir);
  const globalSettings = () => JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));

  await setGlobalResourceEnabled(cwd, agentDir, { type: "skills", path: a }, false);
  assert.deepEqual(globalSettings().packages[0].skills, ["-skills/pkg-a/SKILL.md"]);
  assert.deepEqual(await state(cwd, agentDir, a), { enabled: false, override: "inherit", globalEnabled: false });
  assert.equal((await state(cwd, agentDir, b)).enabled, true);

  await setGlobalResourceEnabled(cwd, agentDir, { type: "skills", path: a }, true);
  assert.deepEqual(globalSettings().packages[0].skills, ["+skills/pkg-a/SKILL.md"]);
  assert.equal((await state(cwd, agentDir, a)).enabled, true);

  await setGlobalResourceEnabled(cwd, agentDir, { type: "skills", path: solo }, false);
  assert.equal((await state(cwd, agentDir, solo)).globalEnabled, false);
  await assert.rejects(setGlobalResourceEnabled(cwd, agentDir, { type: "skills", path: join(cwd, "nope") }, false), /Not a global resource/);
});

test("built-in extensions switch as builtin:<name> entries, globally and per project", async () => {
  const { agentDir, cwd } = setup((dir) => dir);
  const mcp = async () => (await resolveScopedResources(cwd, agentDir)).resources
    .find((r) => r.type === "extensions" && r.path === "builtin:mcp");
  assert.equal((await mcp()).enabled, true);

  await setGlobalResourceEnabled(cwd, agentDir, { type: "extensions", path: "builtin:mcp" }, false);
  assert.deepEqual(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).extensions, ["-builtin:mcp"]);
  assert.equal((await mcp()).enabled, false);

  await setProjectOverrides(cwd, agentDir, [{ type: "extensions", path: "builtin:mcp" }], true);
  assert.deepEqual(projectSettings(cwd).extensions, ["+builtin:mcp"]);
  assert.deepEqual({ enabled: (await mcp()).enabled, override: (await mcp()).override }, { enabled: true, override: "load" });

  await setProjectOverrides(cwd, agentDir, [{ type: "extensions", path: "builtin:mcp" }], false);
  assert.deepEqual(projectSettings(cwd).extensions, []);
});

test("removing a global package drops only the project deltas over it", async () => {
  const { dropRemovedPackageDeltas } = await jiti.import("./project-resource-overrides.ts");
  const { agentDir, cwd, a } = setup((dir) => dir);
  await setProjectOverrides(cwd, agentDir, [{ type: "skills", path: a }], false);
  const delta = projectSettings(cwd).packages[0];
  const globalSource = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).packages[0];
  // Still installed globally: the delta is live.
  assert.equal(await dropRemovedPackageDeltas(cwd, agentDir, globalSource), false);

  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [] }));
  const copy = join(cwd, ".pi/git/github.com/acme/solo");
  mkdirSync(copy, { recursive: true });
  // A deliberate project package that loads only some resources looks like a delta; it must stay.
  const solo = { source: "git:github.com/acme/solo", autoload: false, skills: ["+skills/a/SKILL.md"] };
  writeFileSync(join(cwd, ".pi/settings.json"), JSON.stringify({ packages: [delta, solo] }));

  assert.equal(await dropRemovedPackageDeltas(cwd, agentDir, globalSource), true);
  assert.deepEqual(projectSettings(cwd).packages, [solo]);
  assert.equal(existsSync(copy), true);
  assert.equal(await dropRemovedPackageDeltas(cwd, agentDir, "npm:other"), false);
});

test("dropping deltas leaves an unreadable global settings file's projects alone", async () => {
  const { dropRemovedPackageDeltas } = await jiti.import("./project-resource-overrides.ts");
  const { agentDir, cwd, a } = setup((dir) => dir);
  await setProjectOverrides(cwd, agentDir, [{ type: "skills", path: a }], false);
  const before = readFileSync(join(cwd, ".pi/settings.json"), "utf8");
  const source = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).packages[0];
  writeFileSync(join(agentDir, "settings.json"), "{ broken");
  assert.equal(await dropRemovedPackageDeltas(cwd, agentDir, source), false);
  assert.equal(readFileSync(join(cwd, ".pi/settings.json"), "utf8"), before);
});

test("with several same-identity project entries the editor follows the last, which pi uses", async () => {
  const { agentDir, cwd, a } = setup((dir) => dir);
  await setProjectOverrides(cwd, agentDir, [{ type: "skills", path: a }], false);
  const [delta] = projectSettings(cwd).packages;
  writeFileSync(join(cwd, ".pi/settings.json"), JSON.stringify({ packages: [delta, { ...delta, skills: undefined }] }));
  assert.deepEqual(await state(cwd, agentDir, a), { enabled: true, override: "inherit", globalEnabled: true });
});

test("a delta written for an older npm version keeps receiving overrides after the global source changes", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-overrides-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  mkdirSync(cwd, { recursive: true });
  const installed = join(agentDir, "npm/node_modules/foo");
  const f = skill(join(installed, "skills"), "f");
  const g = skill(join(installed, "skills"), "g");
  const setVersion = (version) => {
    writeFileSync(join(installed, "package.json"), JSON.stringify({ name: "foo", version, pi: { skills: ["./skills"] } }));
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [`npm:foo@${version}`] }));
  };
  setVersion("1.0.0");
  await setProjectOverrides(cwd, agentDir, [{ type: "skills", path: f }], false);
  setVersion("2.0.0");
  await setProjectOverrides(cwd, agentDir, [{ type: "skills", path: g }], false);

  assert.deepEqual(projectSettings(cwd).packages, [
    { source: "npm:foo@1.0.0", autoload: false, skills: ["-skills/f/SKILL.md", "-skills/g/SKILL.md"] },
  ]);
  assert.equal((await state(cwd, agentDir, f)).enabled, false);
});
