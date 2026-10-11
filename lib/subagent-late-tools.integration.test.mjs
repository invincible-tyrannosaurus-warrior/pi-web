import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { createAgentSessionFromServices, createAgentSessionServices, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

// Registers its tool at session_start, as pi's examples/extensions/dynamic-tools.ts does. It then
// tries to switch on `write`, which the profiles leave out, and offers `generate_image`, which is reserved.
const LATE_EXTENSION = `export default function (pi) {
  pi.on("session_start", () => {
    pi.registerTool({ name: "late_tool", label: "late", description: "late", parameters: { type: "object", properties: {} },
      execute: async () => ({ content: [{ type: "text", text: "LATE_OK" }] }) });
    pi.registerTool({ name: "generate_image", label: "image", description: "image", parameters: { type: "object", properties: {} },
      execute: async () => ({ content: [{ type: "text", text: "IMAGE" }] }) });
    pi.setActiveTools([...pi.getActiveTools(), "write", "generate_image"]);
  });
}
`;
// Registered when the extension loads, so a deny rule can name it.
const EAGER_EXTENSION = `export default function (pi) {
  pi.registerTool({ name: "eager_tool", label: "eager", description: "eager", parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: "EAGER_OK" }] }) });
}
`;

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "subagent-late-tools-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  await mkdir(join(dir, "extensions"), { recursive: true });
  await writeFile(join(dir, "extensions", "late.ts"), LATE_EXTENSION);
  await writeFile(join(dir, "extensions", "eager.ts"), EAGER_EXTENSION);
  await mkdir(join(dir, "agents"), { recursive: true });
  await writeFile(join(dir, "agents", "all.md"), "---\ndescription: All\ntools: read\nload_extensions: true\n---\nCHILD\n");
  await writeFile(join(dir, "agents", "selected.md"), "---\ndescription: Selected\ntools: read, ext:eager\n---\nCHILD\n");
  await writeFile(join(dir, "agents", "denied.md"), "---\ndescription: Denied\ntools: read\nload_extensions: true\ndisallowed_tools: ext:eager\n---\nCHILD\n");

  const faux = fauxProvider({ models: [{ id: "faux-model" }] });
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const services = await createAgentSessionServices({ cwd: dir, agentDir: dir, modelRuntime, settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true } });
  const { session: parentSession } = await createAgentSessionFromServices({
    services, sessionManager: SessionManager.create(dir, join(dir, "sessions")), model: faux.getModel("faux-model"),
  });

  const jiti = createJiti(import.meta.url);
  const { createSubagentController } = await jiti.import("./subagent-runtime.ts");
  const { readSubagentSessionResources } = await jiti.import("./subagents.ts");
  const { AgentSessionWrapper, startRpcSession } = await jiti.import("./rpc-manager.ts");
  const parentId = parentSession.sessionId;
  const wrappers = new Map();
  const parent = {
    inner: parentSession, cwd: dir, sessionFile: parentSession.sessionFile,
    isAlive: () => true, isClosing: () => false, isRunning: () => false,
  };
  const state = { child: undefined };
  const controller = createSubagentController({
    getSession: (id) => (id === parentId ? parent : wrappers.get(id)),
    registerSession(inner) {
      const wrapper = new AgentSessionWrapper(inner, { chatOnly: false });
      wrapper.start();
      wrapper.beginExtensionBinding();
      wrappers.set(inner.sessionId, wrapper);
      state.child = wrapper;
    },
    reopenSession: async () => { throw new Error("unused"); },
    resolveSessionPath: async () => state.child?.sessionFile ?? null,
    invalidateSessionList() {},
    isSubagentsEnabled: () => true,
  });
  // One hook, in order: stop every child before its files go, then restore the global test hooks.
  const originalCreate = ModelRuntime.create;
  t.after(async () => {
    for (const child of new Set([...wrappers.values(), state.child])) {
      if (child?.isAlive()) await child.shutdown();
    }
    parentSession.dispose();
    ModelRuntime.create = originalCreate;
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  // The model calls `late_tool`; returns what it was declared and what the call answered.
  let calls = 0;
  const callLateTool = async (run) => {
    const id = `call-${++calls}`;
    let declared;
    faux.setResponses([
      (context) => {
        declared = getCurrentTools(context.messages).map((tool) => tool.name);
        return fauxAssistantMessage(fauxToolCall("late_tool", {}, { id }), { stopReason: "toolUse" });
      },
      fauxAssistantMessage([fauxText("done")]),
    ]);
    await run();
    const result = state.child.inner.sessionManager.getEntries()
      .find((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolCallId === id).message;
    return { declared, text: result.content.map((block) => block.text).join("") };
  };
  const spawn = (profile) => callLateTool(async () => {
    const execution = await controller.extensionRuntime.start({
      parentContext: { sessionManager: parentSession.sessionManager }, parentToolCallId: "start", profile, task: "work", description: "work",
    });
    assert.equal((await execution.completion).status, "completed");
  });
  const reopenWithFakeProvider = async (id, file) => {
    ModelRuntime.create = async (...args) => {
      const runtime = await originalCreate.apply(ModelRuntime, args);
      runtime.registerNativeProvider(faux.provider);
      return runtime;
    };
    state.child = (await startRpcSession(id, file)).session;
    await state.child.waitUntilReady();
  };
  return { state, callLateTool, spawn, readSubagentSessionResources, reopenWithFakeProvider };
}

test("a child loading extensions without selectors can call a tool registered at session_start (#883)", async (t) => {
  const { state, callLateTool, spawn, readSubagentSessionResources, reopenWithFakeProvider } = await setup(t);
  const assertLateTool = ({ declared, text }) => {
    assert.ok(declared.includes("late_tool"));
    assert.equal(text, "LATE_OK");
    // Read by source, so a built-in a later SDK adds shows up here too.
    const builtins = state.child.inner.getAllTools().filter((tool) => tool.sourceInfo.source === "builtin");
    assert.deepEqual(builtins.map((tool) => tool.name), ["read"]);
    assert.ok(!state.child.inner.getActiveToolNames().includes("write"));
    // Reserved names are never admitted, whichever extension offers them.
    assert.ok(!declared.includes("generate_image"));
    assert.ok(!state.child.inner.getActiveToolNames().includes("generate_image"));
  };

  assertLateTool(await spawn("all"));
  assert.equal(readSubagentSessionResources(state.child.inner.sessionManager.getEntries()).allExtensionTools, true);

  await state.child.send({ type: "reload" });
  assertLateTool(await callLateTool(() => state.child.inner.prompt("again")));

  // Reopening builds the same tool options from the snapshot. Only provider construction is replaced.
  const id = state.child.inner.sessionId;
  const file = state.child.sessionFile;
  await state.child.shutdown();
  await reopenWithFakeProvider(id, file);
  assertLateTool(await callLateTool(() => state.child.inner.prompt("reopened")));
});

test("`ext:` selectors still admit only the tools they name", async (t) => {
  const { state, spawn, readSubagentSessionResources } = await setup(t);
  const { declared, text } = await spawn("selected");
  assert.ok(declared.includes("eager_tool"));
  assert.ok(!declared.includes("late_tool"));
  assert.match(text, /not found/);
  assert.equal(readSubagentSessionResources(state.child.inner.sessionManager.getEntries()).allExtensionTools, undefined);
});

test("deny rules keep the name allowlist, so a denied extension's tools stay out", async (t) => {
  const { state, spawn, readSubagentSessionResources } = await setup(t);
  assert.ok((await spawn("all")).declared.includes("eager_tool"));
  const { declared } = await spawn("denied");
  assert.ok(!declared.includes("eager_tool"));
  assert.equal(readSubagentSessionResources(state.child.inner.sessionManager.getEntries()).allExtensionTools, undefined);
});
