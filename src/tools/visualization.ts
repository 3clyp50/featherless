import { createUIResource } from "@mcp-ui/server";
/**
 * MCP-UI visualisation tools — Chart.js dashboards rendered as ui:// resources.
 *
 * Each tool returns a tool response with `content: [createUIResource(...)]`
 * so the MCP-UI host can render the HTML inside its sidebar / inspector.
 */
import { z } from "zod";
import type { Env } from "../env.ts";
import { FHIRError } from "../clients/fhir-client.ts";
import {
  allergySummary,
  bundleToResources,
  conditionSummary,
  encounterSummary,
  immunizationSummary,
  medicationRequestSummary,
  observationSummary,
  patientSummary,
} from "../fhir-utils.ts";
import type { McpServer } from "../mcp/server.ts";
import {
  buildLabTrendChart,
  buildMedicationTimeline,
  buildProblemDistributionChart,
  buildVisitFrequencyChart,
  buildVitalsDashboard,
} from "../ui/clinical-charts.ts";
import { buildClinicalContextDisplay } from "../ui/clinical-display.ts";
import { checkFhirContext, fhirClientForCurrentContext, resolvePatientId } from "./_helpers.ts";

type Dict = Record<string, unknown>;

function uiResource(uri: string, html: string): Dict {
  return createUIResource({
    uri: uri as `ui://${string}`,
    content: { type: "rawHtml", htmlString: html },
    encoding: "text",
  }) as Dict;
}

function safeResources<T>(value: PromiseSettledResult<T>): Dict[] {
  if (value.status !== "fulfilled") return [];
  return bundleToResources(value.value as Dict);
}

export function registerVisualizationTools(server: McpServer, env: Env): void {
  // ====
  // Single-test lab trend chart
  // ====

  server.tool(
    "visualize_lab_trend",
    "Render an interactive Chart.js trend chart for a single lab test as an MCP-UI resource.",
    z.object({
      loinc_or_test: z.string().describe("LOINC code or partial test name"),
      patient_id: z.string().optional(),
      date_from: z.string().optional().describe("Earliest date to include, YYYY-MM-DD"),
      normal_low: z.number().optional(),
      normal_high: z.number().optional(),
    }),
    async ({ loinc_or_test, patient_id, date_from, normal_low, normal_high }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";

      try {
        const fhir = fhirClientForCurrentContext();
        const bundle = await fhir.getObservations(pid, {
          code: loinc_or_test,
          date: date_from ? `ge${date_from}` : undefined,
          count: 200,
          sort: "date",
        });
        const observations = bundleToResources(bundle).map(observationSummary);
        const series = observations
          .filter((o) => typeof o.value === "number")
          .map((o) => ({
            date: ((o.date as string) ?? "").slice(0, 10),
            value: o.value,
            unit: ((o.unit as string) ?? "") || "",
          }));

        const normalRange =
          typeof normal_low === "number" && typeof normal_high === "number"
            ? ([normal_low, normal_high] as [number, number])
            : undefined;

        let html: string;
        if (!series.length) {
          html = `<div style="padding:1rem;color:#64748b;font-family:sans-serif;">No numeric observations found for <code>${loinc_or_test}</code>.</div>`;
        } else {
          const testLabel = (observations[0]?.test as string) || loinc_or_test;
          html = buildLabTrendChart(testLabel, series, normalRange);
        }

        const uri = `ui://featherless/lab-trend/${pid}/${Math.floor(Date.now() / 1000)}`;
        return {
          content: [uiResource(uri, html)],
          patient_id: pid,
          test: loinc_or_test,
          data_points: series.length,
        };
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }
    },
  );

  // ====
  // Vitals dashboard
  // ====

  server.tool(
    "visualize_vitals",
    "Render an interactive dashboard of the patient's vital signs as an MCP-UI resource.",
    z.object({
      patient_id: z.string().optional(),
      date_from: z.string().optional(),
    }),
    async ({ patient_id, date_from }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";

      try {
        const fhir = fhirClientForCurrentContext();
        const bundle = await fhir.getObservations(pid, {
          category: "vital-signs",
          date: date_from ? `ge${date_from}` : undefined,
          count: 200,
          sort: "date",
        });
        const vitals = bundleToResources(bundle).map(observationSummary);
        const html = buildVitalsDashboard(vitals);
        const uri = `ui://featherless/vitals/${pid}/${Math.floor(Date.now() / 1000)}`;
        return {
          content: [uiResource(uri, html)],
          patient_id: pid,
          data_points: vitals.length,
        };
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }
    },
  );

  // ====
  // Full patient dashboard
  // ====

  server.tool(
    "visualize_patient_dashboard",
    "Render the complete patient clinical dashboard as an MCP-UI resource. Combines demographics, allergies, meds, problems, recent labs, encounters, optional Chart.js trends.",
    z.object({
      patient_id: z.string().optional(),
      include_charts: z.boolean().default(true),
      lab_lookback_days: z.number().int().min(1).max(3650).default(90),
    }),
    async ({ patient_id, include_charts, lab_lookback_days }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";

      const now = new Date();
      const labSince = new Date(now.getTime() - lab_lookback_days * 86_400_000)
        .toISOString()
        .slice(0, 10);

      let fhir: ReturnType<typeof fhirClientForCurrentContext>;
      try {
        fhir = fhirClientForCurrentContext();
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }

      const settled = await Promise.allSettled([
        fhir.getPatient(pid),
        fhir.getAllergies(pid, { count: 100 }),
        fhir.getMedicationRequests(pid, { status: "active", count: 100 }),
        fhir.getConditions(pid, { clinicalStatus: "active", count: 100 }),
        fhir.getImmunizations(pid, { count: 100 }),
        fhir.getObservations(pid, {
          category: "laboratory",
          date: `ge${labSince}`,
          count: 100,
          sort: "-date",
        }),
        fhir.getEncounters(pid, { count: 10 }),
      ]);

      const [patientR, allergiesR, medsR, problemsR, immsR, labsR, encountersR] = settled;
      const patient = patientR.status === "fulfilled" ? (patientR.value as Dict) : {};
      const demographics = Object.keys(patient).length ? patientSummary(patient) : {};
      const allergies = safeResources(allergiesR).map(allergySummary);
      const medications = safeResources(medsR).map(medicationRequestSummary);
      const problems = safeResources(problemsR).map(conditionSummary);
      const immunizations = safeResources(immsR).map(immunizationSummary);
      const labs = safeResources(labsR).map(observationSummary);
      const encounters = safeResources(encountersR).map(encounterSummary);

      const alerts: Dict[] = [];
      if (allergies.length) {
        alerts.push({
          type: "allergy_warning",
          severity: "high",
          message: `Patient has ${allergies.length} documented allergies`,
          details: allergies.map((a) => a.allergen).filter(Boolean),
        });
      }
      const abnormal = labs.filter((l) => Boolean(l.abnormal));
      if (abnormal.length) {
        alerts.push({
          type: "abnormal_labs",
          severity: "medium",
          message: `${abnormal.length} abnormal lab results in look-back window`,
          details: abnormal.slice(0, 5).map((l) => `${l.test}: ${l.value} ${l.unit ?? ""}`.trim()),
        });
      }
      if (medications.length >= 10) {
        alerts.push({
          type: "polypharmacy",
          severity: "medium",
          message: `Patient on ${medications.length} active medications — review for interactions`,
        });
      }

      const context: Dict = {
        retrieved_at: now.toISOString(),
        patient_id: pid,
        demographics,
        allergies,
        active_medications: medications,
        active_problems: problems,
        immunizations,
        recent_labs: labs,
        recent_encounters: encounters,
        alerts,
      };

      let body = buildClinicalContextDisplay(context);

      if (include_charts) {
        const chartBlocks: string[] = [];

        const labGroups = new Map<string, { date: string; value: unknown; unit: string }[]>();
        for (const lab of labs) {
          if (typeof lab.value !== "number") continue;
          const key = (lab.test as string) || "Unknown";
          const list = labGroups.get(key) ?? [];
          list.push({
            date: ((lab.date as string) ?? "").slice(0, 10),
            value: lab.value,
            unit: ((lab.unit as string) ?? "") || "",
          });
          labGroups.set(key, list);
        }
        let i = 0;
        for (const [test, series] of labGroups) {
          if (i++ >= 3) break;
          if (series.length >= 2) chartBlocks.push(buildLabTrendChart(test, series));
        }

        if (encounters.length) {
          chartBlocks.push(
            buildVisitFrequencyChart(
              encounters.map((e) => ({ date: (e.start as string) ?? "", reason: e.reason })),
            ),
          );
        }
        if (problems.length) chartBlocks.push(buildProblemDistributionChart(problems));
        if (medications.length) chartBlocks.push(buildMedicationTimeline(medications));

        const filtered = chartBlocks.filter(Boolean);
        if (filtered.length) {
          const chartsHtml = filtered
            .map((c) => `<div style="margin-bottom: 1rem;">${c}</div>`)
            .join("");
          body += `
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:1rem;margin-bottom:1rem;">
            <h3 style="margin:0 0 1rem 0;color:#1e293b;">📈 Clinical Trends</h3>
            ${chartsHtml}
          </div>`;
        }
      }

      const uri = `ui://featherless/dashboard/${pid}/${Math.floor(Date.now() / 1000)}`;
      return {
        content: [uiResource(uri, body)],
        patient_id: pid,
        patient_name: demographics.name ?? null,
        alerts_count: alerts.length,
        data_summary: {
          allergies: allergies.length,
          medications: medications.length,
          problems: problems.length,
          immunizations: immunizations.length,
          labs: labs.length,
          encounters: encounters.length,
        },
      };
    },
  );
}
