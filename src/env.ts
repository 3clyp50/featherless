/**
 * Workers bindings + vars surface. Keep in sync with wrangler.jsonc.
 */
export interface WorkerServiceBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface Env {
  // Memory layer (optional — registerMemoryTools() no-ops when bindings missing)
  AI?: Ai;
  MEMORY_INDEX?: VectorizeIndex;
  MEMORY_META?: D1Database;
  FEATHERLESS_MCP?: WorkerServiceBinding;
  RENDER_CACHE?: KVNamespace;

  // Behaviour flags (vars)
  SHARP_STRICT_CONTEXT?: string; // "1" enables strict mode
  FEATHERLESS_DEV_MODE?: string; // "1" enables env-var fallback in context.ts
  MEM0_DISABLED?: string; // "1" disables memory tool registration
  LLM_MODEL?: string;
  WRITE_BACK?: string; // "1" allows selected tools to PUT generated FHIR resources
  FEATHERLESS_MCP_URL?: string; // Orchestrator target MCP endpoint when no service binding is used
  ORCHESTRATOR_URL?: string; // Public base URL advertised in the A2A AgentCard
  FHIR_EXTENSION_URI?: string; // Prompt Opinion A2A FHIR-context metadata key
  ORCHESTRATOR_API_KEY?: string; // Optional X-API-Key gate for A2A POST /
  MCP_CALL_TIMEOUT_MS?: string; // Orchestrator downstream MCP call timeout

  // Dev-only fallback FHIR context (only consulted when FEATHERLESS_DEV_MODE=1)
  FHIR_SERVER_URL?: string;
  FHIR_ACCESS_TOKEN?: string;
  PATIENT_ID?: string;
}
