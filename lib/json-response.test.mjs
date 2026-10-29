import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { jsonResponse } = await jiti.import("./json-response.ts");

const big = { text: "x".repeat(4096) };
const req = (acceptEncoding) => new Request("http://local/api", acceptEncoding ? { headers: { "accept-encoding": acceptEncoding } } : {});

test("gzips large bodies when the client accepts gzip", async () => {
  const res = await jsonResponse(req("gzip, deflate, br"), big, { headers: { "Cache-Control": "no-store" } });
  assert.equal(res.headers.get("content-encoding"), "gzip");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(res.headers.get("vary"), /Accept-Encoding/);
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()), big);
});

test("sends identity for small bodies, missing headers and refused gzip", async () => {
  for (const [header, body] of [["gzip", { ok: true }], [undefined, big], ["gzip;q=0, br", big], ["identity", big]]) {
    const res = await jsonResponse(req(header), body);
    assert.equal(res.headers.get("content-encoding"), null, String(header));
    assert.deepEqual(await res.json(), body);
  }
});

test("accepts gzip through a wildcard and keeps the status", async () => {
  const res = await jsonResponse(req("br;q=1, *"), big, { status: 201 });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("content-encoding"), "gzip");
});
