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

import type { Env } from "./env.ts";
import { SERVER_NAME, SERVER_VERSION, buildServer } from "./server.ts";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  isJSONRPCNotification,
  isJSONRPCRequest,
  type JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";

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