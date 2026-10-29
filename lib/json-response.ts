import { promisify } from "util";
import { gzip as gzipCallback } from "zlib";

const gzip = promisify(gzipCallback);
const MIN_GZIP_BYTES = 1024;

function acceptsGzip(header: string | null): boolean {
  if (!header) return false;
  let wildcard = false;
  for (const part of header.split(",")) {
    const [coding, ...params] = part.trim().toLowerCase().split(";");
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const accepted = q === undefined || Number(q.slice(2)) > 0;
    if (coding.trim() === "gzip") return accepted;
    if (coding.trim() === "*") wildcard = accepted;
  }
  return wildcard;
}

/**
 * JSON response gzipped for clients that accept it.
 *
 * Next's built-in compression skips Route Handler responses (vercel/next.js#98007),
 * so large session payloads otherwise cross remote links uncompressed. A response
 * that already carries Content-Encoding is left alone by Next once that is fixed.
 */
export async function jsonResponse(req: Request, body: unknown, init: ResponseInit = {}): Promise<Response> {
  const json = JSON.stringify(body);
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.append("Vary", "Accept-Encoding");
  if (Buffer.byteLength(json) < MIN_GZIP_BYTES || !acceptsGzip(req.headers.get("accept-encoding"))) {
    return new Response(json, { ...init, headers });
  }
  headers.set("Content-Encoding", "gzip");
  return new Response(new Uint8Array(await gzip(json)), { ...init, headers });
}
