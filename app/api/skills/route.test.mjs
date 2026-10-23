import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-skills-route-agent-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PATCH } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

function patchRequest(body) {
  return new Request("http://localhost/api/skills", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("PATCH /api/skills authorizes by loaded-skill membership, not extra roots", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  // DELETE may use the agent dir to locate removable entries; PATCH must not widen access with it.
  const patch = source.slice(source.indexOf("export async function PATCH"));
  assert.match(patch, /loadSkillsWithInstallInfo\(cwd\)/);
  assert.match(patch, /item\.filePath === filePath/);
  // The agent dir is only used to write the global switch, never to widen the file allow-list.
  assert.doesNotMatch(patch, /globalSkillsDir|isExistingFilePathAllowed\(filePath|allowFileRoot/);
});

test("PATCH /api/skills requires cwd", async () => {
  const response = await PATCH(patchRequest({
    filePath: "/tmp/SKILL.md",
    disableModelInvocation: true,
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "cwd required" });
});

test("PATCH /api/skills toggles a loaded skill whose realpath is outside allowed roots", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-skills-route-cwd-"));
  allowFileRoot(cwd);
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const realDir = await mkdtemp(join(tmpdir(), "pi-web-skills-route-real-"));
  t.after(() => rm(realDir, { recursive: true, force: true }));
  await writeFile(
    join(realDir, "SKILL.md"),
    "---\nname: linked-skill\ndescription: Demo skill\n---\nBody.\n",
  );

  const skillsDir = join(testAgentDir, "skills");
  await mkdir(skillsDir, { recursive: true });
  await symlink(realDir, join(skillsDir, "linked-skill"));

  const listed = await GET(new Request(`http://localhost/api/skills?cwd=${encodeURIComponent(cwd)}`));
  assert.equal(listed.status, 200);
  const skill = (await listed.json()).skills.find((item) => item.name === "linked-skill");
  assert.ok(skill, "expected GET to list the symlinked skill");

  const outsider = join(cwd, "not-a-skill.md");
  await writeFile(outsider, "nope\n");
  const denied = await PATCH(patchRequest({
    cwd,
    filePath: outsider,
    disableModelInvocation: true,
  }));
  assert.equal(denied.status, 403);

  const toggled = await PATCH(patchRequest({
    cwd,
    filePath: skill.filePath,
    disableModelInvocation: true,
  }));
  assert.equal(toggled.status, 200);
  assert.deepEqual(await toggled.json(), { success: true });
  assert.match(await readFile(join(realDir, "SKILL.md"), "utf8"), /disable-model-invocation: true/);
});

test("PATCH /api/skills refuses a skill shipped by a package and leaves its file untouched", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-skills-route-cwd-"));
  allowFileRoot(cwd);
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const pkgDir = await mkdtemp(join(tmpdir(), "pi-web-skills-route-pkg-"));
  t.after(() => rm(pkgDir, { recursive: true, force: true }));
  const skillFile = join(pkgDir, "skills", "packaged-skill", "SKILL.md");
  const original = "---\nname: packaged-skill\ndescription: Shipped by a package\n---\nBody.\n";
  await mkdir(join(pkgDir, "skills", "packaged-skill"), { recursive: true });
  await writeFile(skillFile, original);
  await writeFile(join(testAgentDir, "settings.json"), JSON.stringify({ packages: [pkgDir] }));
  t.after(() => rm(join(testAgentDir, "settings.json"), { force: true }));

  const listed = await GET(new Request(`http://localhost/api/skills?cwd=${encodeURIComponent(cwd)}`));
  const skill = (await listed.json()).skills.find((item) => item.name === "packaged-skill");
  assert.equal(skill?.sourceInfo.origin, "package");

  const refused = await PATCH(patchRequest({ cwd, filePath: skill.filePath, disableModelInvocation: true }));
  assert.equal(refused.status, 409);
  assert.equal(await readFile(skillFile, "utf8"), original);
});

test("a skill switched off globally stays listed and can be switched back on", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-skills-route-cwd-"));
  allowFileRoot(cwd);
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const dir = join(testAgentDir, "skills", "switchable-skill");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), "---\nname: switchable-skill\ndescription: Demo\n---\nBody.\n");
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.after(() => rm(join(testAgentDir, "settings.json"), { force: true }));

  const list = async () => (await (await GET(new Request(`http://localhost/api/skills?cwd=${encodeURIComponent(cwd)}`))).json())
    .skills.find((item) => item.name === "switchable-skill");
  const before = await list();
  assert.equal(before.enabled, true);
  assert.equal(before.globalEnabled, true);

  assert.equal((await PATCH(patchRequest({ cwd, filePath: before.filePath, enabled: false }))).status, 200);
  const off = await list();
  assert.ok(off, "a switched-off skill must still be listed");
  assert.equal(off.enabled, false);
  assert.equal(off.globalEnabled, false);
  assert.equal(off.description, "Demo");

  assert.equal((await PATCH(patchRequest({ cwd, filePath: off.filePath, enabled: true }))).status, 200);
  assert.equal((await list()).globalEnabled, true);
});

test("GET /api/skills?filePath= returns a loaded skill's text and refuses any other file", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-skills-content-cwd-"));
  allowFileRoot(cwd);
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const skillDir = join(testAgentDir, "skills", "content-skill");
  await mkdir(skillDir, { recursive: true });
  t.after(() => rm(skillDir, { recursive: true, force: true }));
  const text = "---\nname: content-skill\ndescription: Shows its body\n---\n# Steps\n\nDo it.\n";
  await writeFile(join(skillDir, "SKILL.md"), text);

  const url = (filePath) => `http://localhost/api/skills?cwd=${encodeURIComponent(cwd)}&filePath=${encodeURIComponent(filePath)}`;
  const ok = await GET(new Request(url(join(skillDir, "SKILL.md"))));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { content: text });

  const outsider = join(cwd, "secret.md");
  await writeFile(outsider, "secret\n");
  const denied = await GET(new Request(url(outsider)));
  assert.equal(denied.status, 404);
});

test("a package skill re-enabled by a project delta stays in its package's group", async (t) => {
  const { trustProject } = await jiti.import("../../../lib/project-trust.ts");
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-skills-route-cwd-"));
  allowFileRoot(cwd);
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const pkgDir = await mkdtemp(join(tmpdir(), "pi-web-skills-route-pkg-"));
  t.after(() => rm(pkgDir, { recursive: true, force: true }));
  for (const name of ["kept-off", "turned-on"]) {
    await mkdir(join(pkgDir, "skills", name), { recursive: true });
    await writeFile(join(pkgDir, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n`);
  }
  await mkdir(join(cwd, ".pi", "skills", "own-skill"), { recursive: true });
  await writeFile(join(cwd, ".pi", "skills", "own-skill", "SKILL.md"), "---\nname: own-skill\ndescription: d\n---\n");
  await writeFile(join(testAgentDir, "settings.json"), JSON.stringify({ packages: [{ source: pkgDir, skills: [] }] }));
  t.after(() => rm(join(testAgentDir, "settings.json"), { force: true }));
  t.after(() => rm(join(testAgentDir, "trust.json"), { force: true }));
  await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({
    packages: [{ source: pkgDir, autoload: false, skills: ["+skills/turned-on/SKILL.md"] }],
  }));
  trustProject(cwd, testAgentDir);

  const skills = (await (await GET(new Request(`http://localhost/api/skills?cwd=${encodeURIComponent(cwd)}`))).json()).skills;
  const byName = Object.fromEntries(skills.map((skill) => [skill.name, skill]));
  assert.equal(byName["turned-on"].enabled, true);
  assert.equal(byName["kept-off"].enabled, false);
  // One package, one source: the project delta must not split it into a second group.
  assert.equal(byName["turned-on"].sourceInfo.source, byName["kept-off"].sourceInfo.source);
  assert.equal(byName["turned-on"].sourceInfo.scope, "user");
  // A skill that exists only in this project keeps its project scope.
  assert.equal(byName["own-skill"].sourceInfo.scope, "project");
});
