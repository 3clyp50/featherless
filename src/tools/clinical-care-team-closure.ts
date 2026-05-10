import { FHIRError } from "../clients/fhir-client.ts";
import type { Env } from "../env.ts";
import type { McpServer } from "../mcp/server.ts";
import { checkFhirContext, fhirClientForCurrentContext } from "./_helpers.ts";
import {
  type CareTeamClosureInput,
  type CareTeamClosureOutput,
  careTeamClosureInputSchema,
} from "./schemas/care-team-closure.ts";
import type { VisitContext } from "./schemas/visit-context.ts";

type Dict = Record<string, unknown>;

interface ValidationResult {
  resource_type: string;
  id: string;
  ok: boolean;
  issue_count: number;
  status_code?: number;
  message?: string;
}

interface WriteResult {
  resource_type: string;
  id: string;
  ok: boolean;
  status_code?: number;
  location?: string;
  message?: string;
}

function addDays(date: string, days: number): string {
  const base = validDateOnly(date) ?? new Date().toISOString().slice(0, 10);
  const d = new Date(`${base}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function validDateOnly(date: string | null | undefined): string | null {
  if (!date) return null;
  const candidate = date.slice(0, 10);
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === candidate ? candidate : null;
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function patientRef(ctx: VisitContext): Dict {
  return { reference: `Patient/${ctx.patient.id}`, display: ctx.patient.name };
}

function encounterRef(ctx: VisitContext): Dict {
  return { reference: `Encounter/${ctx.encounter.id}` };
}

function idSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "order"
  );
}

function timingDueDate(
  encounterDate: string,
  timing: string | null | undefined,
): string | undefined {
  if (!timing) return undefined;
  const text = timing.toLowerCase();
  const match = /(\d+)\s*(day|days|week|weeks|month|months)/.exec(text);
  if (!match) return undefined;
  const amount = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const unit = match[2] ?? "days";
  const days = unit.startsWith("month")
    ? amount * 30
    : unit.startsWith("week")
      ? amount * 7
      : amount;
  return addDays(encounterDate, days);
}

function ownerForOrder(order: VisitContext["orders"][number]): string {
  switch (order.type) {
    case "lab":
      return "Lab scheduling";
    case "imaging":
      return "Radiology scheduling";
    case "appointment":
      return "Front desk scheduling";
    default:
      return "Care team";
  }
}

function taskDescriptionForOrder(order: VisitContext["orders"][number]): string {
  const display = order.display.trim() || "Follow-up order";
  if (/^(arrange|book|order|repeat|schedule)\b/i.test(display)) return display;
  return `Schedule ${display}`;
}

function taskIdForOrder(
  ctx: VisitContext,
  order: VisitContext["orders"][number],
  description: string,
  index: number,
): string {
  const encounter = idSlug(ctx.encounter.id).slice(0, 24) || "encounter";
  const suffix = `${idSlug(order.type)}-${index + 1}`;
  const reserved = `task-${encounter}-${suffix}`.length + 1;
  const descriptionPart = idSlug(description).slice(0, Math.max(0, 64 - reserved));
  return ["task", encounter, descriptionPart, suffix].filter(Boolean).join("-");
}

function task(
  id: string,
  ctx: VisitContext,
  opts: {
    description: string;
    owner: string;
    due?: string;
  },
): Dict {
  const out: Dict = {
    resourceType: "Task",
    id,
    status: "requested",
    intent: "order",
    code: { text: opts.description },
    description: opts.description,
    for: patientRef(ctx),
    encounter: encounterRef(ctx),
    authoredOn: `${ctx.encounter.date}T12:00:00Z`,
    requester: { display: ctx.encounter.provider ?? "Care team" },
    owner: { display: opts.owner },
  };
  if (opts.due) out.restriction = { period: { end: opts.due } };
  return out;
}

function taskFromOrder(
  ctx: VisitContext,
  order: VisitContext["orders"][number],
  index: number,
): Dict {
  const description = taskDescriptionForOrder(order);
  return task(taskIdForOrder(ctx, order, description, index), ctx, {
    description,
    owner: ownerForOrder(order),
    due: timingDueDate(ctx.encounter.date, order.timing),
  });
}

export function buildCareTeamClosureResources(
  ctx: VisitContext,
  packetMarkdown = "Patient packet pending clinician review.",
): Dict[] {
  const patientId = ctx.patient.id;
  const encounterId = ctx.encounter.id;
  const encounterDate = validDateOnly(ctx.encounter.date) ?? new Date().toISOString().slice(0, 10);
  const closureCtx: VisitContext = { ...ctx, encounter: { ...ctx.encounter, date: encounterDate } };
  const generated = `${encounterDate}T12:00:00Z`;
  const orderTasks = closureCtx.orders.map((order, index) =>
    taskFromOrder(closureCtx, order, index),
  );

  return [
    ...orderTasks,
    {
      resourceType: "CommunicationRequest",
      id: `commreq-${encounterId}-patient-packet`,
      status: "draft",
      intent: "proposal",
      subject: patientRef(closureCtx),
      encounter: encounterRef(closureCtx),
      authoredOn: generated,
      requester: { display: closureCtx.encounter.provider ?? "Care team" },
      recipient: [patientRef(closureCtx)],
      payload: [{ contentString: "Send patient visit packet to portal after clinician review." }],
    },
    {
      resourceType: "DocumentReference",
      id: `docref-${encounterId}-patient-packet`,
      status: "current",
      type: { text: "Patient visit packet" },
      subject: patientRef(closureCtx),
      date: generated,
      description: "Patient-facing visit packet generated by Featherless.",
      content: [
        {
          attachment: {
            contentType: "text/markdown; charset=utf-8",
            title: `Patient packet for ${closureCtx.patient.name}`,
            data: base64Utf8(packetMarkdown),
          },
        },
      ],
      context: { encounter: [encounterRef(closureCtx)] },
    },
  ];
}

function issueCount(outcome: Dict): number {
  const issue = outcome.issue;
  return Array.isArray(issue) ? issue.length : 0;
}

async function validateResources(resources: Dict[]): Promise<ValidationResult[]> {
  const fhir = fhirClientForCurrentContext();
  const results: ValidationResult[] = [];
  for (const resource of resources) {
    const resourceType = String(resource.resourceType ?? "Resource");
    const id = String(resource.id ?? "");
    try {
      const outcome = await fhir.post(`/${resourceType}/$validate`, resource);
      results.push({
        resource_type: resourceType,
        id,
        ok: true,
        issue_count: issueCount(outcome),
      });
    } catch (e) {
      if (e instanceof FHIRError) {
        results.push({
          resource_type: resourceType,
          id,
          ok: false,
          issue_count: issueCount(e.detail),
          status_code: e.statusCode,
          message: e.message,
        });
        continue;
      }
      throw e;
    }
  }
  return results;
}

async function putResource(resource: Dict): Promise<WriteResult> {
  const fhir = fhirClientForCurrentContext();
  const resourceType = String(resource.resourceType ?? "Resource");
  const id = String(resource.id ?? "");
  const url = `${fhir.baseUrl}/${resourceType}/${id}`;
  const headers: Record<string, string> = {
    Accept: "application/fhir+json",
    "Content-Type": "application/fhir+json",
  };
  if (fhir.accessToken) headers.Authorization = `Bearer ${fhir.accessToken}`;
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(resource),
  });
  if (!res.ok) {
    return {
      resource_type: resourceType,
      id,
      ok: false,
      status_code: res.status,
      message: res.statusText || `HTTP ${res.status}`,
    };
  }
  return {
    resource_type: resourceType,
    id,
    ok: true,
    status_code: res.status,
    location: res.headers.get("location") ?? undefined,
  };
}

async function writeResources(resources: Dict[]): Promise<WriteResult[]> {
  const results: WriteResult[] = [];
  for (const resource of resources) {
    results.push(await putResource(resource));
  }
  return results;
}

export async function prepareCareTeamClosure(
  args: CareTeamClosureInput,
  env: Env = {},
): Promise<CareTeamClosureOutput | Dict> {
  const err = checkFhirContext({
    requirePatient: true,
    patientId: args.visit_context.patient.id,
  });
  if (err) return err as unknown as Dict;

  const resources = buildCareTeamClosureResources(args.visit_context, args.patient_packet_markdown);
  const validation_results = await validateResources(resources);
  const write_back_requested = args.write_back === true;
  const write_back_enabled = env.WRITE_BACK === "1";
  const out: CareTeamClosureOutput = {
    patient_id: args.visit_context.patient.id,
    encounter_id: args.visit_context.encounter.id,
    generated_at: new Date().toISOString(),
    write_back_requested,
    write_back_enabled,
    resources,
    validation_results,
  };
  if (write_back_requested && write_back_enabled) {
    out.write_results = await writeResources(resources);
  }
  return out;
}

export function registerClinicalCareTeamClosureTools(server: McpServer, env: Env): void {
  server.tool(
    "clinical_prepare_care_team_closure",
    "Prepare standards-shaped FHIR closure resources for a completed visit: " +
      "Task resources for explicit follow-up orders, 1 draft CommunicationRequest proposal, and 1 DocumentReference. " +
      "Validates each resource against the configured FHIR server and only writes back when WRITE_BACK=1.",
    careTeamClosureInputSchema,
    async (args) => prepareCareTeamClosure(args, env),
  );
}
