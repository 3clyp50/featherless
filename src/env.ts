/**
 * Workers bindings + vars surface. Keep in sync with wrangler.jsonc.
 */
export interface Env {
  // Memory layer (optional — registerMemoryTools() no-ops when bindings missing)
  AI?: Ai;
  MEMORY_INDEX?: VectorizeIndex;
  MEMORY_META?: D1Database;

  // Behaviour flags (vars)
  SHARP_STRICT_CONTEXT?: string; // "1" enables strict mode
  FEATHERLESS_DEV_MODE?: string; // "1" enables env-var fallback in context.ts
  MEM0_DISABLED?: string; // "1" disables memory tool registration
  LLM_MODEL?: string;

  // Dev-only fallback FHIR context (only consulted when FEATHERLESS_DEV_MODE=1)
  FHIR_SERVER_URL?: string;
  FHIR_ACCESS_TOKEN?: string;
  PATIENT_ID?: string;
}
