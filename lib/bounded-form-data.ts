export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the allowed size");
  }
}

function declaredContentLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (!value || !/^\d+$/.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : null;
}

async function readBodyWithinLimit(request: Request, maxBytes: number): Promise<Blob> {
  const declared = declaredContentLength(request);
  if (declared !== null && declared > maxBytes) {
    throw new RequestBodyTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return new Blob();

  const chunks: BlobPart[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new RequestBodyTooLargeError();
      }
      size += value.byteLength;
      const chunk = new Uint8Array(value.byteLength);
      chunk.set(value);
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  return new Blob(chunks);
}

/** Bound the actual stream as well as Content-Length before either parser runs. */
export async function parseJsonWithinLimit(request: Request, maxBytes: number): Promise<unknown> {
  return JSON.parse(await (await readBodyWithinLimit(request, maxBytes)).text());
}

export async function parseFormDataWithinLimit(request: Request, maxBytes: number): Promise<FormData> {
  const body = await readBodyWithinLimit(request, maxBytes);
  const contentType = request.headers.get("content-type");
  const headers = contentType ? { "content-type": contentType } : undefined;
  return new Response(body, { headers }).formData();
}
