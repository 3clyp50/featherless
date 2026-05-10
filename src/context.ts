import { AsyncLocalStorage } from "node:async_hooks";
/**
 * SHARP-on-MCP per-request context propagation.
 *
 * Per §3.2 of the SHARP-on-MCP spec, healthcare context (FHIR server URL,
 * access token, default patient) is delivered to the MCP server via HTTP
 * headers on every request — not via a server-side OAuth flow.
 *
 * Headers:
 *   X-FHIR-Server-URL    Base URL of the FHIR R4 server.
 *   X-FHIR-Access-Token  Bearer token already minted by the agent's host.
 *   X-Patient-ID         Optional default patient context.
 */
import { decodeJwt } from "jose";
import { FHIRClient } from "./clients/fhir-client.ts";
import type { Env } from "./env.ts";

export const HEADER_FHIR_SERVER_URL = "X-FHIR-Server-URL";
export const HEADER_FHIR_ACCESS_TOKEN = "X-FHIR-Access-Token";
export const HEADER_PATIENT_ID = "X-Patient-ID";

export interface SharpContext {
  serverUrl: string | null;
  accessToken: string | null;
  patientId: string | null;
  fhirUser: string | null;
  scopes: string | null;
  extraHeaders: Record<string, string>;
}

export const EMPTY_CONTEXT: SharpContext = {
  serverUrl: null,
  accessToken: null,
  patientId: null,
  fhirUser: null,
  scopes: null,
  extraHeaders: {},
};

export function hasFhir(ctx: SharpContext): boolean {
  return Boolean(ctx.serverUrl && ctx.accessToken);
}

export class FHIRContextMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FHIRContextMissingError";
  }
}

const als = new AsyncLocalStorage<SharpContext>();

export function runWithContext<T>(ctx: SharpContext, fn: () => Promise<T> | T): Promise<T> | T {
  return als.run(ctx, fn);
}

/**
 * Try to decode the SMART `patient` claim from a bearer access token.
 * Decode-only, never verify — host validates signatures.
 */
function jwtClaims(token: string | null): {
  patient: string | null;
  fhirUser: string | null;
  scopes: string | null;
} {
  if (!token) return { patient: null, fhirUser: null, scopes: null };
  try {
    const claims = decodeJwt(token) as Record<string, unknown>;
    const patient = typeof claims.patient === "string" ? claims.patient : null;
    const fhirUser = typeof claims.fhirUser === "string" ? claims.fhirUser : null;
    const scopes =
      typeof claims.scope === "string"
        ? claims.scope
        : Array.isArray(claims.scope)
          ? (claims.scope as string[]).join(" ")
          : null;
    return { patient, fhirUser, scopes };
  } catch {
    return { patient: null, fhirUser: null, scopes: null };
  }
}

function stripBearer(token: string | null): string | null {
  if (!token) return null;
  const t = token.trim();
  if (t.toLowerCase().startsWith("bearer ")) return t.slice(7).trim();
  return t;
}

function rstripSlash(url: string | null): string | null {
  if (!url) return null;
  return url.replace(/\/+$/, "");
}

/**
 * Read SHARP headers from a Request and build a SharpContext.
 * Falls back to env vars when FEATHERLESS_DEV_MODE === "1".
 */
export function parseSharpHeaders(req: Request, env: Env): SharpContext {
  const h = req.headers;
  const devMode = env.FEATHERLESS_DEV_MODE === "1";

  const headerServerUrl = h.get(HEADER_FHIR_SERVER_URL);
  const headerToken = h.get(HEADER_FHIR_ACCESS_TOKEN);
  const headerPatient = h.get(HEADER_PATIENT_ID);

  const serverUrl = rstripSlash(
    headerServerUrl ?? (devMode ? (env.FHIR_SERVER_URL ?? null) : null),
  );
  const accessToken = stripBearer(
    headerToken ?? (devMode ? (env.FHIR_ACCESS_TOKEN ?? null) : null),
  );

  // Patient resolution order matches Python: JWT → header → env (dev only)
  const claims = jwtClaims(accessToken);
  const patientId = claims.patient ?? headerPatient ?? (devMode ? (env.PATIENT_ID ?? null) : null);

  return {
    serverUrl,
    accessToken,
    patientId,
    fhirUser: claims.fhirUser,
    scopes: claims.scopes,
    extraHeaders: {},
  };
}

export function getCurrentContext(): SharpContext {
  return als.getStore() ?? EMPTY_CONTEXT;
}

export function requireFhirContext(): SharpContext {
  const ctx = getCurrentContext();
  if (!hasFhir(ctx)) {
    throw new FHIRContextMissingError(
      "FHIR context required. Send X-FHIR-Server-URL and X-FHIR-Access-Token headers (SHARP-on-MCP §3.2).",
    );
  }
  return ctx;
}

/**
 * Returns a configured FHIRClient bound to the current request's context.
 * fetch has no client to close, so this is a plain accessor (no async-with wrapper).
 */
export function fhirClientForCurrentContext(): FHIRClient {
  const ctx = requireFhirContext();
  return new FHIRClient({
    baseUrl: ctx.serverUrl as string,
    accessToken: ctx.accessToken,
    extraHeaders: ctx.extraHeaders,
  });
}
