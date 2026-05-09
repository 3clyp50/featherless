/**
 * Minimal Streamable-HTTP MCP server for Cloudflare Workers.
 *
 * Implements the JSON-RPC subset needed for SHARP-on-MCP compliance:
 *   - initialize (with experimental.fhir_context_required capability)
 *   - notifications/initialized (no-op ack)
 *   - tools/list   (Zod → JSON Schema)
 *   - tools/call   (dispatch to registered handler)
 *   - ping
 *
 * Stateless: every POST is its own request/response cycle. No SSE,
 * no DO-backed sessions — fine for hackathon scope and SHARP doesn't
 * require streaming for tool calls.
 */
import { z, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "../mcp/zod-to-json-schema.ts";

export interface ToolDefinition<S extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: S;
  handler: (args: z.infer<S>) => Promise<unknown> | unknown;
}

export interface ServerInfo {
  name: string;
  version: string;
  instructions?: string;
}

export interface ServerCapabilities {
  tools?: { listChanged?: boolean };
  experimental?: Record<string, Record<string, unknown>>;
  extensions?: Record<string, unknown>;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

const PROTOCOL_VERSION = "2025-03-26";

export class McpServer {
  private readonly tools = new Map<string, ToolDefinition>();
  readonly info: ServerInfo;
  readonly capabilities: ServerCapabilities;

  constructor(info: ServerInfo, capabilities: ServerCapabilities = {}) {
    this.info = info;
    this.capabilities = {
      tools: { listChanged: false },
      ...capabilities,
    };
  }

  tool<S extends ZodTypeAny>(name: string, description: string, inputSchema: S, handler: ToolDefinition<S>["handler"]): void {
    if (this.tools.has(name)) {
      throw new Error(`Tool already registered: ${name}`);
    }
    this.tools.set(name, { name, description, inputSchema, handler } as ToolDefinition);
  }

  listTools(): { name: string; description: string; inputSchema: unknown }[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
    }));
  }

  private async callTool(name: string, args: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    const parsed = tool.inputSchema.safeParse(args ?? {});
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          { type: "text", text: `Invalid arguments: ${parsed.error.message}` },
        ],
      };
    }
    const result = await tool.handler(parsed.data);
    // If tool already returned MCP content shape, pass through.
    if (
      result &&
      typeof result === "object" &&
      Array.isArray((result as { content?: unknown }).content)
    ) {
      return result;
    }
    // Otherwise wrap as a single text-content tool response with the JSON payload.
    return {
      content: [
        { type: "text", text: JSON.stringify(result, null, 2) },
      ],
      structuredContent: result,
    };
  }

  /**
   * Handle a single JSON-RPC request body and return the response object.
   * Returns null for notifications (no id).
   */
  async handleRequest(body: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = body.id ?? null;
    const isNotification = body.id === undefined;

    try {
      switch (body.method) {
        case "initialize": {
          const result = {
            protocolVersion: PROTOCOL_VERSION,
            serverInfo: this.info,
            capabilities: this.capabilities,
            ...(this.info.instructions ? { instructions: this.info.instructions } : {}),
          };
          return { jsonrpc: "2.0", id, result };
        }
        case "notifications/initialized":
          return null;
        case "ping":
          return { jsonrpc: "2.0", id, result: {} };
        case "tools/list":
          return { jsonrpc: "2.0", id, result: { tools: this.listTools() } };
        case "tools/call": {
          const params = (body.params ?? {}) as { name?: string; arguments?: unknown };
          if (!params.name) throw new Error("tools/call requires `name`");
          const result = await this.callTool(params.name, params.arguments);
          return { jsonrpc: "2.0", id, result };
        }
        default:
          if (isNotification) return null;
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method not found: ${body.method}` },
          };
      }
    } catch (err) {
      if (isNotification) return null;
      const message = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message, data: err instanceof Error ? { name: err.name } : undefined },
      };
    }
  }
}
