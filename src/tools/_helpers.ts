import type { FHIRClient } from "../clients/fhir-client.ts";
/**
 * Internal helpers shared by tool modules.
 *
 * Functional rather than decorator-based — keeps Zod schemas and tool
 * argument shapes visible to McpAgent's introspection.
 */
import { fhirClientForCurrentContext, getCurrentContext, hasFhir } from "../context.ts";

export interface ContextErrorEnvelope {
  error: "fhir_context_required";
  message: string;
  required_headers: string[];
  optional_headers: string[];
  spec: string;
  missing?: string[];
}

export function fhirContextError(message: string, missing?: string[]): ContextErrorEnvelope {
  return {
    error: "fhir_context_required",
    message,
    required_headers: ["X-FHIR-Server-URL", "X-FHIR-Access-Token"],
    optional_headers: ["X-Patient-ID"],
    spec: "https://www.sharponmcp.com/overview.html",
    ...(missing ? { missing } : {}),
  };
}

export function checkFhirContext(
  opts: {
    requirePatient?: boolean;
    patientId?: string | null;
  } = {},
): ContextErrorEnvelope | null {
  const ctx = getCurrentContext();
  if (!hasFhir(ctx)) {
    const missing: string[] = [];
    if (!ctx.serverUrl) missing.push("server_url");
    if (!ctx.accessToken) missing.push("access_token");
    return fhirContextError(
      "This tool requires FHIR context. Send X-FHIR-Server-URL and X-FHIR-Access-Token request headers (SHARP-on-MCP §3.2).",
      missing,
    );
  }
  if (opts.requirePatient && !(opts.patientId || ctx.patientId)) {
    return fhirContextError(
      "Pass an explicit patient_id argument or set the X-Patient-ID header.",
      ["patient_id"],
    );
  }
  return null;
}

export function resolvePatientId(explicit?: string | null): string | null {
  if (explicit) return explicit;
  return getCurrentContext().patientId;
}

export { fhirClientForCurrentContext, getCurrentContext };
export type { FHIRClient };
