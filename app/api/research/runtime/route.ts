import { randomUUID } from "node:crypto";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { createModelsConfigServices } from "@/lib/model-config-services";
import { allowFileRoot } from "@/lib/file-access";
import { invalidateSessionListCache } from "@/lib/session-reader";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { isResearchWorker, researchWorkspace } from "@/lib/research-service";
import { researchModelBudget, withResearchModelDeadline } from "@/lib/research-model-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RunSession = { runId: string; error?: string; request?: Record<string, unknown>; release?: () => void };
const state = globalThis as typeof globalThis & { __researchSessions?: Map<string, RunSession> };
const sessions = state.__researchSessions ??= new Map<string, RunSession>();

export async function POST(req: Request) {
  try {
    if (!await isResearchWorker(req)) return Response.json({ error: "Worker authentication required" }, { status: 401 });
    const body = await req.json() as { action: string; runId: string; sessionId?: string; provider?: string; modelId?: string; prompt?: string; images?: { data: string; mimeType: string }[]; modelTimeoutSeconds?: number; reasoning?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" };
    const cwd = await researchWorkspace(body.runId);
    if (body.action === "complete") {
      let budget;
      try { budget = researchModelBudget(body.modelTimeoutSeconds); }
      catch (error) { return Response.json({ error: String(error) }, { status: 400 }); }
      if (body.reasoning && !["minimal", "low", "medium", "high", "xhigh", "max"].includes(body.reasoning)) return Response.json({ error: "Invalid reasoning level" }, { status: 400 });
      const services = await createModelsConfigServices(cwd);
      const model = body.provider && body.modelId ? services.modelRuntime.getModel(body.provider, body.modelId) : undefined;
      if (!model) return Response.json({ error: "Selected Pi model is unavailable" }, { status: 400 });
      const resolved = await services.modelRuntime.getAuth(model);
      if (!resolved?.auth.apiKey) return Response.json({ error: "Selected Pi provider needs authentication" }, { status: 403 });
      if (body.images?.length && !model.input.includes("image")) return Response.json({ error: "Selected Pi model does not accept images" }, { status: 400 });
      const content = [{ type: "text" as const, text: body.prompt || "" }, ...(body.images || []).map(image => ({ type: "image" as const, data: image.data, mimeType: image.mimeType }))];
      const message = await withResearchModelDeadline(req.signal, body.modelTimeoutSeconds, options => completeSimple(model, { messages: [{ role: "user", content, timestamp: Date.now() }] }, {
        apiKey: resolved.auth.apiKey, headers: resolved.auth.headers, maxTokens: 8192,
        ...options,
        ...(body.reasoning ? { reasoning: body.reasoning } : {}),
      }));
      if (message.stopReason === "error" || message.stopReason === "aborted") throw new Error(message.errorMessage || "Model call failed");
      return Response.json({ text: message.content.filter(b => b.type === "text").map(b => b.text).join("\n"),
        model_metadata: { requested_model: model.id, model: message.model, provider: message.provider,
          response_model: message.responseModel ?? null, usage: message.usage, source: "pi-sdk",
          timeout_seconds: budget.timeoutMs / 1000, sdk_retries: 0 } });
    }
    if (body.action === "start") {
      if (!body.provider || !body.modelId || !body.prompt) return Response.json({ error: "Provider, model and prompt are required" }, { status: 400 });
      const { session, realSessionId } = await startRpcSession(`__research__${randomUUID()}`, "", cwd, {
        initialModel: { provider: body.provider, modelId: body.modelId },
        toolNames: ["read", "write", "edit", "bash"],
      });
      const record: RunSession = { runId: body.runId };
      sessions.set(realSessionId, record);
      record.release = session.onEvent(event => {
        if (event.type === "extension_ui_request") record.request = { method: event.method, title: event.title, message: event.message, options: event.options };
        if (event.type === "prompt_error") record.error = String(event.errorMessage || "Agent prompt failed");
        if (event.type === "message_end") {
          const message = event.message as { stopReason?: string; errorMessage?: string } | undefined;
          if (message?.stopReason === "error" || message?.stopReason === "aborted") record.error = message.errorMessage || "Agent model failed";
        }
      }, true);
      allowFileRoot(cwd);
      invalidateSessionListCache();
      try {
        await session.send({ type: "prompt", message: body.prompt });
      } catch (error) {
        record.release();
        sessions.delete(realSessionId);
        throw error;
      }
      return Response.json({ sessionId: realSessionId });
    }
    const sessionId = body.sessionId || "";
    const record = sessions.get(sessionId);
    const session = getRpcSession(sessionId);
    if (!record || record.runId !== body.runId || !session) {
      // After a Pi Web restart no in-process experiment survives. Do not resume it implicitly.
      if (body.action === "abort" && !session) return Response.json({ success: true });
      return Response.json({ error: "Research session no longer available" }, { status: 404 });
    }
    if (body.action === "abort") {
      await session.send({ type: "abort" });
      record.release?.();
      sessions.delete(sessionId);
      return Response.json({ success: true });
    }
    if (body.action === "status") {
      const last = await session.send({ type: "get_last_assistant_text" }) as { text: string };
      return Response.json({ running: session.isRunning(), waitingHuman: session.isAwaitingInput(), request: record.request, text: last.text, error: record.error });
    }
    return Response.json({ error: "Unknown runtime action" }, { status: 400 });
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).replace(/sk-[A-Za-z0-9._-]+/g, "[redacted]");
    return Response.json({ error: message }, { status: 500 });
  }
}
