import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { createJiti } from "jiti";
import { fauxProvider } from "@earendil-works/pi-ai";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createModelsConfigServices, getModelsConfigReadServices } = await jiti.import("./model-config-services.ts");
const { invalidateModelsCache } = await jiti.import("./models-cache.ts");
const { loadSkillsWithInstallInfo } = await jiti.import("./skills-service.ts");
const { DefaultResourceLoader, ProjectTrustStore } = await import("@earendil-works/pi-coding-agent");

// Every file and credential store belongs to this fixture, never ~/.pi.
test("settings read services cache and extension-free skills", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-settings-services-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  const other = join(root, "other");
  await Promise.all([mkdir(agentDir), mkdir(cwd), mkdir(other)]);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  globalThis.__settingsFactoryCount = 0;
  const extension = join(agentDir, "slow.mjs");
  await writeFile(extension, `export default async function () {
    globalThis.__settingsFactoryCount++;
    if (globalThis.__settingsFactoryEntered) globalThis.__settingsFactoryEntered();
    if (globalThis.__settingsFactoryHang) await globalThis.__settingsFactoryHang;
    await new Promise(resolve => setTimeout(resolve, 40));
  }`);
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ extensions: [extension] }));
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    delete globalThis.__piModelsConfigReadServices;
    delete globalThis.__settingsFactoryCount;
    delete globalThis.__settingsFactoryHang;
    delete globalThis.__settingsFactoryEntered;
    await rm(root, { recursive: true, force: true });
  });

  await t.test("concurrent requests share one build; warm reads avoid factories", async () => {
    const start = performance.now();
    await createModelsConfigServices(cwd);
    const freshMs = performance.now() - start;
    const count = globalThis.__settingsFactoryCount;
    const [a, b] = await Promise.all([getModelsConfigReadServices(cwd), getModelsConfigReadServices(cwd)]);
    assert.equal(a, b);
    assert.equal(globalThis.__settingsFactoryCount, count + 1);
    const warmStart = performance.now();
    assert.equal(await getModelsConfigReadServices(cwd), a);
    console.log(`service timing: fresh=${freshMs.toFixed(1)}ms warm=${(performance.now() - warmStart).toFixed(1)}ms (one 40ms extension)`);
  });

  await t.test("concurrent getAvailable reads both see newly available auth", async () => {
    const { modelRuntime } = await getModelsConfigReadServices(cwd);
    const faux = fauxProvider({ provider: "concurrent-auth", models: [{ id: "model" }] });
    let authenticated = false;
    faux.provider.auth.apiKey.resolve = async () => {
      await new Promise(resolve => setImmediate(resolve));
      return authenticated ? { auth: {} } : undefined;
    };
    modelRuntime.registerNativeProvider(faux.provider);
    const refs = models => models.filter(model => model.provider === "concurrent-auth").map(model => model.id);
    assert.deepEqual(refs(await modelRuntime.getAvailable()), []);
    authenticated = true;
    const [first, second] = await Promise.all([modelRuntime.getAvailable(), modelRuntime.getAvailable()]);
    assert.deepEqual(refs(first), ["model"]);
    assert.deepEqual(refs(second), ["model"]);
    const rejected = modelRuntime.getAvailable(undefined, { signal: AbortSignal.abort() });
    const next = modelRuntime.getAvailable();
    await assert.rejects(rejected);
    assert.deepEqual(refs(await next), ["model"], "a failed read does not poison the queue");
  });

  await t.test("cwd, agentDir, trust, config files and explicit invalidation separate builds", async () => {
    let a = await getModelsConfigReadServices(cwd);
    assert.notEqual(await getModelsConfigReadServices(other), a);
    for (const file of ["models.json", "auth.json", "models-store.json", "settings.json"]) {
      const path = join(agentDir, file);
      await writeFile(path, file === "settings.json" ? JSON.stringify({ extensions: [extension], enabledModels: ["test/*"] }) : "{}");
      const b = await getModelsConfigReadServices(cwd);
      assert.notEqual(b, a, file);
      a = b;
    }
    invalidateModelsCache();
    const b = await getModelsConfigReadServices(cwd);
    assert.notEqual(b, a);
    await mkdir(join(cwd, ".pi"));
    await writeFile(join(cwd, ".pi", "settings.json"), "{}");
    const untrusted = await getModelsConfigReadServices(cwd);
    new ProjectTrustStore(agentDir).set(cwd, true);
    assert.notEqual(await getModelsConfigReadServices(cwd), untrusted);
    const secondAgent = join(root, "agent2");
    await mkdir(secondAgent);
    process.env.PI_CODING_AGENT_DIR = secondAgent;
    assert.notEqual(await getModelsConfigReadServices(cwd), b);
    process.env.PI_CODING_AGENT_DIR = agentDir;
  });

  await t.test("LRU is bounded and expired entries rebuild", async () => {
    for (let i = 0; i < 9; i++) {
      const dir = join(root, `cwd-${i}`);
      await mkdir(dir);
      await getModelsConfigReadServices(dir);
    }
    assert.equal(globalThis.__piModelsConfigReadServices.size, 8);
    const a = await getModelsConfigReadServices(cwd);
    for (const entry of globalThis.__piModelsConfigReadServices.values()) entry.expiresAt = 0;
    assert.notEqual(await getModelsConfigReadServices(cwd), a);
  });

  await t.test("timed-out factory is evicted and does not block a later build", async (t) => {
    invalidateModelsCache();
    let release;
    globalThis.__settingsFactoryHang = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { globalThis.__settingsFactoryEntered = resolve; });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const pending = getModelsConfigReadServices(cwd);
    const rejected = assert.rejects(pending, /timed out/);
    await entered;
    t.mock.timers.tick(30_000);
    await rejected;
    t.mock.timers.reset();
    delete globalThis.__settingsFactoryHang;
    delete globalThis.__settingsFactoryEntered;
    release();
    const services = await getModelsConfigReadServices(cwd);
    assert.ok(services.modelRuntime);
  });

  await t.test("invalidation detaches a pending build without poisoning its replacement", async () => {
    invalidateModelsCache();
    let release;
    globalThis.__settingsFactoryHang = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { globalThis.__settingsFactoryEntered = resolve; });
    const pending = getModelsConfigReadServices(cwd);
    await entered;
    invalidateModelsCache();
    delete globalThis.__settingsFactoryHang;
    delete globalThis.__settingsFactoryEntered;
    const replacement = await getModelsConfigReadServices(cwd);
    release();
    assert.notEqual(await pending, replacement);
    assert.equal(await getModelsConfigReadServices(cwd), replacement);
  });

  await t.test("skills skip factories and still list disabled skills", async () => {
    for (const name of ["on", "off"]) {
      const dir = join(agentDir, "skills", name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Test skill\n---\nTest\n`);
    }
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ extensions: [extension], skills: ["-skills/off/SKILL.md"] }));
    const beforeStart = performance.now();
    await new DefaultResourceLoader({ cwd, agentDir }).reload();
    const beforeMs = performance.now() - beforeStart;
    const count = globalThis.__settingsFactoryCount;
    const afterStart = performance.now();
    const result = await loadSkillsWithInstallInfo(cwd);
    console.log(`skills timing: before=${beforeMs.toFixed(1)}ms after=${(performance.now() - afterStart).toFixed(1)}ms (one 40ms extension)`);
    assert.equal(globalThis.__settingsFactoryCount, count);
    assert.equal(result.skills.find(skill => skill.name === "on")?.enabled, true);
    assert.equal(result.skills.find(skill => skill.name === "off")?.enabled, false);
  });
});

test("read routes share services while picker writes and auth mutations stay fresh", async () => {
  const picker = await readFile(new URL("../app/api/models-config/picker/route.ts", import.meta.url), "utf8");
  assert.match(picker.slice(picker.indexOf("export async function GET"), picker.indexOf("export async function PUT")), /getModelsConfigReadServices\(resolved.cwd\)/);
  assert.match(picker.slice(picker.indexOf("export async function PUT")), /createModelsConfigServices\(resolved.cwd\)/);
  for (const route of ["auth/providers", "models-config/runtime", "models-config/discover"]) {
    const source = await readFile(new URL(`../app/api/${route}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /getModelsConfigReadServices/);
    assert.doesNotMatch(source, /createModelsConfigServices/);
  }
  const plugins = await readFile(new URL("../app/api/plugins/route.ts", import.meta.url), "utf8");
  assert.match(plugins, /invalidateModelsCache\(\);\n\s*return NextResponse.json\(await readPlugins\(body.cwd\)\)/);
});
