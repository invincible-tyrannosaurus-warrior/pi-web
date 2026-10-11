import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "ALL_PROXY",
  "all_proxy",
];

test("configures HTTP_PROXY, HTTPS_PROXY, and NO_PROXY for global fetch", async (t) => {
  const originalEnv = new Map(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of PROXY_ENV_KEYS) delete process.env[key];

  const connectTargets = [];
  const forwardedRequests = [];
  const proxy = createServer((req, res) => {
    forwardedRequests.push(`${req.method} ${req.url}`);
    res.writeHead(204, { Connection: "close" });
    res.end();
  });
  proxy.on("connect", (req, socket) => {
    connectTargets.push(req.url);
    socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");

  t.after(async () => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise((resolve, reject) => {
      proxy.close((error) => error ? reject(error) : resolve());
    });
  });

  const address = proxy.address();
  assert.ok(address && typeof address === "object");
  const proxyUrl = `http://127.0.0.1:${address.port}`;
  process.env.HTTP_PROXY = proxyUrl;
  process.env.HTTPS_PROXY = proxyUrl;
  process.env.NO_PROXY = "bypass.invalid";

  const jiti = createJiti(import.meta.url);
  const { configureHttpDispatcher } = await jiti.import("./http-dispatcher.ts");
  const { getGlobalDispatcher } = await import("undici");

  assert.throws(() => configureHttpDispatcher(-1), /Invalid HTTP idle timeout/);
  configureHttpDispatcher(2_000);

  const dispatcher = getGlobalDispatcher();
  configureHttpDispatcher(5_000);
  assert.equal(getGlobalDispatcher(), dispatcher, "configuration should be idempotent");

  const httpResponse = await fetch("http://target.invalid/through-http-proxy", {
    signal: AbortSignal.timeout(2_000),
  });
  assert.equal(httpResponse.status, 204);
  assert.deepEqual(forwardedRequests, ["GET http://target.invalid/through-http-proxy"]);
  assert.deepEqual(connectTargets, []);

  await assert.rejects(fetch("https://target.invalid/through-https-proxy", {
    signal: AbortSignal.timeout(2_000),
  }));
  assert.deepEqual(connectTargets, ["target.invalid:443"]);

  const forwardedRequestCount = forwardedRequests.length;
  const connectTargetCount = connectTargets.length;
  await assert.rejects(fetch("http://bypass.invalid:9/no-proxy", {
    signal: AbortSignal.timeout(2_000),
  }));
  assert.equal(forwardedRequests.length, forwardedRequestCount);
  assert.equal(connectTargets.length, connectTargetCount);
});

test("reads httpIdleTimeoutMs from the agent settings file", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-http-idle-"));
  const settingsPath = join(agentDir, "settings.json");
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));

  const jiti = createJiti(import.meta.url);
  const { readHttpIdleTimeoutMs } = await jiti.import("./http-dispatcher.ts");
  const read = (text) => {
    if (text === undefined) rmSync(settingsPath, { force: true });
    else writeFileSync(settingsPath, text);
    return readHttpIdleTimeoutMs(agentDir);
  };

  assert.equal(read(undefined), undefined, "no settings file keeps the default");
  assert.equal(read("{ not json"), undefined, "unparsable settings keep the default");
  assert.equal(read(JSON.stringify({ theme: "dark" })), undefined, "a missing key keeps the default");
  assert.equal(read(JSON.stringify({ httpIdleTimeoutMs: -1 })), undefined, "a value the CLI rejects keeps the default");
  assert.equal(read(JSON.stringify({ httpIdleTimeoutMs: null })), undefined, "a null value keeps the default");
  assert.equal(read(JSON.stringify(["httpIdleTimeoutMs"])), undefined, "settings that are not an object keep the default");
  assert.equal(read(JSON.stringify({ httpIdleTimeoutMs: 1_200_000 })), 1_200_000, "the configured timeout is used");
  assert.equal(read(JSON.stringify({ httpIdleTimeoutMs: 0 })), 0, "0 disables the timeout");
  assert.equal(read(JSON.stringify({ httpIdleTimeoutMs: "disabled" })), 0, "the CLI's disabled spelling disables the timeout");
  assert.equal(read(`\ufeff${JSON.stringify({ httpIdleTimeoutMs: 900_000 })}`), 900_000, "a byte-order mark is allowed");

  const previous = process.env.PI_CODING_AGENT_DIR;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  assert.equal(readHttpIdleTimeoutMs(), 900_000, "the default directory comes from PI_CODING_AGENT_DIR");
});

test("resolves PI_CODING_AGENT_DIR as pi's getAgentDir() does", async (t) => {
  const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
  const jiti = createJiti(import.meta.url);
  const { defaultAgentDir } = await jiti.import("./http-dispatcher.ts");

  const previous = process.env.PI_CODING_AGENT_DIR;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  });

  for (const value of [undefined, "", "~", "~/agent", "~\\agent", "/abs/agent", "rel/agent", " /padded ", "file:///tmp/agent", "/c/Users/agent", "/mnt/d/agent"]) {
    if (value === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = value;
    assert.equal(defaultAgentDir(), getAgentDir(), `PI_CODING_AGENT_DIR=${JSON.stringify(value)}`);
  }
});
