/**
 * Generic FHIR R4 read/search MCP tools — vendor-neutral.
 */
import { z } from "zod";
import type { McpServer } from "../mcp/server.ts";
import { FHIRError } from "../clients/fhir-client.ts";
import { ResourceTypeSchema } from "../models/types.ts";
import {
  bundleNextLink,
  bundleToResources,
  bundleTotal,
  patientSummary,
} from "../fhir-utils.ts";
import {
  checkFhirContext,
  fhirClientForCurrentContext,
  resolvePatientId,
} from "./_helpers.ts";

export function registerFhirTools(server: McpServer): void {
  server.tool(
    "fhir_get_capability_statement",
    "Return the FHIR server's CapabilityStatement (GET /metadata). Useful for discovering supported resource types and search parameters.",
    z.object({}),
    async () => {
      const err = checkFhirContext();
      if (err) return err;
      try {
        const fhir = fhirClientForCurrentContext();
        const cap = await fhir.getCapabilityStatement();
        const rest = (Array.isArray(cap.rest) && cap.rest[0]) || {};
        const resources = (Array.isArray(rest.resource) ? rest.resource : []) as Record<string, unknown>[];
        return {
          fhir_version: cap.fhirVersion ?? null,
          status: cap.status ?? null,
          publisher: cap.publisher ?? null,
          software: ((cap.software ?? {}) as Record<string, unknown>).name ?? null,
          implementation: ((cap.implementation ?? {}) as Record<string, unknown>).description ?? null,
          supported_resources: resources.slice(0, 30).map((r) => ({
            type: r.type ?? null,
            interactions: ((r.interaction as { code?: string }[] | undefined) ?? []).map((i) => i.code ?? null),
            search_params: ((r.searchParam as { name?: string }[] | undefined) ?? []).map((p) => p.name ?? null),
          })),
          security: rest.security ?? {},
          total_resource_types: resources.length,
        };
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }
    },
  );

  server.tool(
    "fhir_get_patient",
    "Read a single FHIR Patient resource and return a compact summary. Argument patient_id falls back to X-Patient-ID header / JWT patient claim.",
    z.object({ patient_id: z.string().optional() }),
    async ({ patient_id }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";
      try {
        const fhir = fhirClientForCurrentContext();
        const patient = await fhir.getPatient(pid);
        return { ...patientSummary(patient), raw: patient };
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }
    },
  );

  server.tool(
    "fhir_search",
    "Search any FHIR R4 resource type. Returns a compact Bundle summary with a next_link cursor.",
    z.object({
      resource_type: ResourceTypeSchema,
      patient_id: z.string().optional(),
      params: z.string().optional().describe("Additional query string params, e.g. category=vital-signs&_sort=-date"),
      count: z.number().int().min(1).max(250).default(25),
    }),
    async ({ resource_type, patient_id, params, count }) => {
      const err = checkFhirContext();
      if (err) return err;

      const searchParams: Record<string, string> = { _count: String(count) };
      const effectivePatient = resolvePatientId(patient_id);
      if (effectivePatient && resource_type !== "Patient") {
        searchParams.patient = effectivePatient;
      } else if (resource_type === "Patient" && patient_id) {
        searchParams._id = patient_id;
      }
      if (params) {
        for (const pair of params.split("&")) {
          const idx = pair.indexOf("=");
          if (idx > 0) {
            const key = pair.slice(0, idx);
            const value = pair.slice(idx + 1);
            if (key) searchParams[key] = value;
          }
        }
      }

      try {
        const fhir = fhirClientForCurrentContext();
        const bundle = await fhir.search(resource_type, searchParams);
        const resources = bundleToResources(bundle);
        return {
          resource_type: "Bundle",
          search_type: resource_type,
          total: bundleTotal(bundle),
          returned: resources.length,
          has_more: bundleNextLink(bundle) !== null,
          next_link: bundleNextLink(bundle),
          entries: resources.slice(0, 50).map((r) => ({
            resourceType: r.resourceType ?? null,
            id: r.id ?? null,
            resource: r,
          })),
        };
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }
    },
  );

  server.tool(
    "fhir_read",
    "Read a single FHIR resource by resourceType and id. Use when you already know the exact id from a previous search.",
    z.object({
      resource_type: ResourceTypeSchema,
      resource_id: z.string(),
    }),
    async ({ resource_type, resource_id }) => {
      const err = checkFhirContext();
      if (err) return err;
      try {
        const fhir = fhirClientForCurrentContext();
        return await fhir.getResource(resource_type, resource_id);
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }
    },
  );

  server.tool(
    "fhir_patient_everything",
    "Invoke Patient/{id}/$everything and summarise the result. Note: not all FHIR servers implement $everything.",
    z.object({
      patient_id: z.string().optional(),
      start: z.string().optional().describe("Lower bound clinical date (YYYY-MM-DD)"),
      end: z.string().optional().describe("Upper bound clinical date (YYYY-MM-DD)"),
    }),
    async ({ patient_id, start, end }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";
      try {
        const fhir = fhirClientForCurrentContext();
        const bundle = await fhir.getPatientEverything(pid, { start, end });
        const resources = bundleToResources(bundle);
        const counts: Record<string, number> = {};
        for (const r of resources) {
          const t = (r.resourceType as string) ?? "Unknown";
          counts[t] = (counts[t] ?? 0) + 1;
        }
        return {
          patient_id: pid,
          total_resources: resources.length,
          resource_summary: counts,
          next_link: bundleNextLink(bundle),
          entries: resources.slice(0, 100).map((r) => ({
            resourceType: r.resourceType ?? null,
            id: r.id ?? null,
            resource: r,
          })),
        };
      } catch (e) {
        if (e instanceof FHIRError) {
          if (e.statusCode === 404 || e.statusCode === 405 || e.statusCode === 501) {
            return {
              error: "operation_not_supported",
              message:
                "The FHIR server does not support Patient/$everything. Use fhir_search for individual resource types instead.",
              alternative_tool: "fhir_search",
            };
          }
          return e.toToolResponse();
        }
        throw e;
      }
    },
  );
}
