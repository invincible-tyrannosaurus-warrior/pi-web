import { NextResponse } from "next/server";
import { readPreviewProxyConfig } from "@/lib/preview-proxy";

export const dynamic = "force-dynamic";

/** External address of the local-service preview proxy, or null when remote preview is off. */
export function GET() {
  return NextResponse.json({ proxyUrl: readPreviewProxyConfig()?.url ?? null });
}
