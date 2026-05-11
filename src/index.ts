import { hasFhir, parseSharpHeaders, runWithContext } from "./context.ts";
/**
 * Worker entry point. Routes:
 *   POST /mcp  — JSON-RPC over Streamable HTTP (single request → single response)
 *   GET  /     — info page (HTML)
 *   GET  /health — liveness
 *
 * Each /mcp POST runs inside an AsyncLocalStorage-scoped SharpContext built
 * from request headers (per SHARP-on-MCP §3.2).
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  type JSONRPCMessage,
  isJSONRPCNotification,
  isJSONRPCRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { Env } from "./env.ts";
import { getRender } from "./render-store.ts";
import { SERVER_NAME, SERVER_VERSION, buildServer } from "./server.ts";

export type { Env };

/**
 * Bridges the SDK's Streamable HTTP transport to our custom McpServer.
 *
 * The SDK transport handles the HTTP protocol (session IDs, SSE streaming,
 * GET/DELETE methods, CORS). We intercept incoming messages and route them
 * through our existing server.handleRequest().
 */
class StreamableHttpBridge {
  private transport: WebStandardStreamableHTTPServerTransport;

  constructor(
    private readonly mcpServer: ReturnType<typeof buildServer>,
    private readonly strict: boolean,
    private readonly ctx: ReturnType<typeof parseSharpHeaders>,
  ) {
    this.transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — no session persistence
      enableJsonResponse: true, // single request → single JSON response (no SSE)
    });
    this.transport.onerror = (err) => {
      console.error("[mcp.transport] error", err);
    };
  }

  async handleRequest(request: Request): Promise<Response> {
    // Wire up message handling before processing the request
    this.transport.onmessage = async (message: JSONRPCMessage) => {
      // Only requests and notifications come from the client; ignore anything else.
      if (!isJSONRPCRequest(message) && !isJSONRPCNotification(message)) return;

      try {
        // Strict mode: reject tools/call without FHIR context
        if (this.strict && message.method === "tools/call" && !hasFhir(this.ctx)) {
          if (isJSONRPCRequest(message)) {
            await this.transport.send({
              jsonrpc: "2.0",
              id: message.id,
              error: {
                code: -32001,
                message:
                  "fhir_context_required: send X-FHIR-Server-URL and X-FHIR-Access-Token headers per SHARP-on-MCP §3.2.",
              },
            });
          }
          return;
        }

        const response = await this.mcpServer.handleRequest(message);
        if (response !== null) {
          await this.transport.send(response as JSONRPCMessage);
        } else if (isJSONRPCRequest(message)) {
          // Server returned null for a request (malformed: notification-method
          // sent with an id, or a future code path). In JSON-response mode the
          // outer Promise from transport.handleRequest only resolves when
          // transport.send() fires resolveJson — without this fallback the
          // Worker would hang until its wall budget expires.
          await this.transport.send({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32600, message: `Invalid Request: ${message.method}` },
          });
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.transport.onerror?.(error);
        if (isJSONRPCRequest(message)) {
          try {
            await this.transport.send({
              jsonrpc: "2.0",
              id: message.id,
              error: { code: -32603, message: error.message },
            });
          } catch (sendErr) {
            this.transport.onerror?.(
              sendErr instanceof Error ? sendErr : new Error(String(sendErr)),
            );
          }
        }
      }
    };

    return this.transport.handleRequest(request);
  }
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

async function handleMcp(request: Request, env: Env): Promise<Response> {
  const ctx = parseSharpHeaders(request, env);
  const strict = env.SHARP_STRICT_CONTEXT === "1";
  const server = buildServer(env);

  const bridge = new StreamableHttpBridge(server, strict, ctx);

  return runWithContext(ctx, () => bridge.handleRequest(request));
}

async function handleRender(request: Request, env: Env): Promise<Response> {
  if (!env.RENDER_CACHE) {
    return new Response("Render cache not configured", { status: 503 });
  }
  const url = new URL(request.url);
  const token = url.pathname.slice("/render/".length);

  const body = await getRender(env.RENDER_CACHE, token);
  if (body === null) {
    console.warn(`[render] miss token=${token.slice(0, 8)}…`);
    // KV is eventually consistent; on the rare race where a freshly-written
    // token is read before propagation, the user can refresh. Avoiding an
    // in-handler sleep keeps every 404 cheap (DoS-resistant).
    return new Response("Not found or expired", { status: 404 });
  }

  console.log(`[render] hit token=${token.slice(0, 8)}…`);

  const doc = `<!doctype html>
<html><head><meta charset="utf-8">
<title>Clinical Dashboard</title>
<meta name="referrer" content="no-referrer">
<style>body{margin:0;font:14px/1.5 -apple-system,sans-serif;background:#f8fafc}</style>
</head><body>${body}</body></html>`;

  return new Response(doc, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, private",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      // Restrict what the rendered fragment may load/execute. Chart.js loads
      // from jsdelivr; init scripts are inline (so 'unsafe-inline' required).
      // This blocks injected <script src="evil"> and frame embedding.
      "Content-Security-Policy": [
        "default-src 'none'",
        "script-src 'unsafe-inline' https://cdn.jsdelivr.net",
        "style-src 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join("; "),
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") return handleMcp(request, env);
    if (url.pathname.startsWith("/render/")) return handleRender(request, env);
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname === "/" || url.pathname === "")
      return new Response(INFO_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
