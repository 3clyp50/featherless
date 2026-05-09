/**
 * Worker entry point. Routes:
 *   POST /mcp  — JSON-RPC over Streamable HTTP (single request → single response)
 *   GET  /     — info page (HTML)
 *   GET  /health — liveness
 *
 * Each /mcp POST runs inside an AsyncLocalStorage-scoped SharpContext built
 * from request headers (per SHARP-on-MCP §3.2).
 */
import type { Env } from "./env.ts";
import { buildServer, SERVER_NAME, SERVER_VERSION } from "./server.ts";
import { parseSharpHeaders, runWithContext, hasFhir } from "./context.ts";

export type { Env };

const JSON_HEADERS = { "Content-Type": "application/json" };
const HANDSHAKE_METHODS = new Set(["initialize", "notifications/initialized", "tools/list", "ping"]);

async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }

  // Build per-request SHARP context from headers.
  const ctx = parseSharpHeaders(request, env);
  const strict = env.SHARP_STRICT_CONTEXT === "1";

  const dispatch = async (msg: { method?: string; id?: string | number | null }): Promise<unknown> => {
    const server = buildServer(env);

    // Strict mode: reject tools/call without context (handshake passes through).
    if (
      strict &&
      msg.method === "tools/call" &&
      !hasFhir(ctx) &&
      !HANDSHAKE_METHODS.has(msg.method)
    ) {
      return {
        jsonrpc: "2.0",
        id: msg.id ?? null,
        error: {
          code: -32001,
          message:
            "fhir_context_required: send X-FHIR-Server-URL and X-FHIR-Access-Token headers per SHARP-on-MCP §3.2.",
        },
      };
    }

    return server.handleRequest(msg as never);
  };

  // Support batched requests (per JSON-RPC 2.0).
  const responses = await runWithContext(ctx, async () => {
    if (Array.isArray(body)) {
      const results = await Promise.all(body.map((m) => dispatch(m)));
      return results.filter((r) => r !== null);
    }
    return dispatch(body as { method?: string; id?: string | number | null });
  });

  if (responses === null || (Array.isArray(responses) && responses.length === 0)) {
    return new Response(null, { status: 204 });
  }

  return new Response(JSON.stringify(responses), { status: 200, headers: JSON_HEADERS });
}

const INFO_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>${SERVER_NAME} v${SERVER_VERSION}</title>
<style>body{font:14px/1.5 -apple-system,sans-serif;max-width:680px;margin:48px auto;padding:0 16px}code{background:#f3f3f3;padding:2px 6px;border-radius:3px}</style>
</head><body>
<h1>${SERVER_NAME} <small style="color:#888">v${SERVER_VERSION}</small></h1>
<p>SHARP-on-MCP compliant FHIR R4 MCP server.</p>
<p>POST JSON-RPC requests to <code>/mcp</code>. Forward SHARP headers on every <code>tools/call</code>:</p>
<ul>
  <li><code>X-FHIR-Server-URL</code></li>
  <li><code>X-FHIR-Access-Token</code></li>
  <li><code>X-Patient-ID</code> (optional; falls back to JWT <code>patient</code> claim)</li>
</ul>
<p>See <a href="https://www.sharponmcp.com/overview.html">sharponmcp.com</a> for the spec.</p>
</body></html>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") return handleMcp(request, env);
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname === "/" || url.pathname === "")
      return new Response(INFO_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
