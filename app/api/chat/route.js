/**
 * /api/chat – streaming proxy to the NVIDIA Inference API.
 *
 * Accepts POST { messages, tier? } and returns a Server-Sent Events stream.
 * The model router (lib/qwen.js) selects the concrete model and handles
 * timeouts, fallbacks, and thinking-mode control.
 */

import { callQwen, ApiError, resolveTier } from "../../../lib/qwen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES = new Set(["system", "user", "assistant"]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET() {
  return json({
    ok: true,
    endpoint: "/api/chat",
    method: "POST",
    routing: "auto",
  });
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const messages = body?.messages;
  const valid =
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.every(
      (m) => m && ROLES.has(m.role) && typeof m.content === "string"
    );
  if (!valid) {
    return json(
      { error: "`messages` must be a non-empty array of { role, content }." },
      400
    );
  }

  const requestedTier = body?.tier || body?.model || "auto";
  const tier = resolveTier(requestedTier, messages);

  try {
    const clean = messages.map(({ role, content }) => ({ role, content }));
    const result = await callQwen(clean, { tier, signal: req.signal });

    if (!result.response.body) {
      return json({ error: "The upstream model returned an empty response." }, 502);
    }

    return new Response(result.response.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-KoreAI-Tier": result.tier,
        "X-KoreAI-Model": result.model,
      },
    });
  } catch (err) {
    if (err?.name === "AbortError") return new Response(null, { status: 499 });
    const status = err instanceof ApiError ? err.status : 500;
    return json({ error: err?.message || "Unknown server error" }, status);
  }
}
