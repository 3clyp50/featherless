import type { Env } from "../env.ts";
import type { McpServer } from "../mcp/server.ts";
import { DEFAULT_ALLOWED_CITATION_IDS, validateGrounding } from "./grounding-validator.ts";
import { meetsReadingTarget, scoreReadability } from "./readability.ts";
import {
  type GeneratedPatientPacket,
  type PatientPacketInput,
  type PatientPacketOutput,
  generatedPatientPacketSchema,
  patientPacketInputSchema,
} from "./schemas/patient-packet.ts";
import type { VisitContext } from "./schemas/visit-context.ts";

type Dict = Record<string, unknown>;

interface LlmGenerateRequest {
  system: string;
  user: string;
}

interface LlmGenerateResponse {
  model: string;
  text: string;
}

interface LlmClient {
  generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse>;
}

interface GeneratePatientPacketOpts {
  env?: Env;
  llm?: LlmClient;
  now?: () => Date;
}

const DEFAULT_WORKERS_AI_MODEL = "@cf/moonshotai/kimi-k2.6";

interface PacketLabels {
  titlePrefix: string;
  whatWeDidTodayHeading: string;
  medicationsHeading: string;
  actionHeader: string;
  medicineHeader: string;
  doseHeader: string;
  instructionsHeader: string;
  newLabel: string;
  continueLabel: string;
  newMedicationInstructions: string;
  continueMedicationInstructions: string;
  noMedicationChangeWatch: string;
  watchBeforeUsing: (name: string, dose: string) => string;
  dailyWeight: string;
  medicationQuestion: string;
  timingPrefix: string;
  visitSummary: string;
  watchForHeading: string;
  nextStepsHeading: string;
  whenToCallHeading: string;
  whenToGoToErHeading: string;
  whenToCall: string[];
  whenToGoToEr: string[];
  citationsFooter: string;
}

function isSpanish(language: string): boolean {
  return language.toLowerCase().startsWith("es");
}

function labelsFor(language: string): PacketLabels {
  if (isSpanish(language)) {
    return {
      titlePrefix: "Su plan de visita",
      whatWeDidTodayHeading: "## Lo que hicimos hoy",
      medicationsHeading: "## Sus medicinas ahora",
      actionHeader: "Acción",
      medicineHeader: "Medicina",
      doseHeader: "Dosis",
      instructionsHeader: "Instrucciones",
      newLabel: "NUEVA",
      continueLabel: "Continuar",
      newMedicationInstructions: "Use esta medicina solo como le indicó su equipo.",
      continueMedicationInstructions: "Siga tomándola igual.",
      noMedicationChangeWatch: "Revise si sus síntomas cambian.",
      watchBeforeUsing: (name, dose) =>
        `Revise si sus tobillos se hinchan antes de usar ${name} ${dose}.`,
      dailyWeight: "Pésese cada mañana y anote el número.",
      medicationQuestion: "Llame si falta una medicina o no entiende una instrucción.",
      timingPrefix: " en ",
      visitSummary:
        "Hoy revisamos su corazón, sus medicinas y sus próximos estudios. Su presión y sus análisis recientes están en el plan de cuidado.",
      watchForHeading: "## Qué vigilar",
      nextStepsHeading: "## Próximos pasos",
      whenToCallHeading: "## Cuándo llamarnos",
      whenToGoToErHeading: "## Cuándo ir a emergencias",
      whenToCall: [
        "Llame al equipo de cardiología si sube más de 1 kg en un día.",
        "Llame si sus tobillos se hinchan más o si se siente peor.",
      ],
      whenToGoToEr: [
        "Vaya a emergencias si le falta el aire estando sentada.",
        "Vaya a emergencias si tiene dolor fuerte en el pecho.",
      ],
      citationsFooter:
        "Este resumen usa lenguaje claro y pasos de acción para pacientes [CIT-001, CIT-005, CIT-006].",
    };
  }
  return {
    titlePrefix: "Your visit plan",
    whatWeDidTodayHeading: "## What we did today",
    medicationsHeading: "## Your medicines now",
    actionHeader: "Action",
    medicineHeader: "Medicine",
    doseHeader: "Dose",
    instructionsHeader: "Instructions",
    newLabel: "NEW",
    continueLabel: "Continue",
    newMedicationInstructions: "Use this medicine only as your care team directed.",
    continueMedicationInstructions: "Keep taking it the same way.",
    noMedicationChangeWatch: "Watch for any change in your symptoms.",
    watchBeforeUsing: (name, dose) =>
      `Check whether your ankles are swollen before using ${name} ${dose}.`,
    dailyWeight: "Weigh yourself every morning and write down the number.",
    medicationQuestion: "Call if a medicine is missing or an instruction is unclear.",
    timingPrefix: " in ",
    visitSummary:
      "Today we reviewed your heart, medicines, and next studies. Your blood pressure and recent labs are part of the care plan.",
    watchForHeading: "## What to watch for",
    nextStepsHeading: "## Next steps",
    whenToCallHeading: "## When to call us",
    whenToGoToErHeading: "## When to go to the ER",
    whenToCall: [
      "Call the cardiology team if your weight goes up more than 1 kg in one day.",
      "Call if your ankles swell more or you feel worse.",
    ],
    whenToGoToEr: [
      "Go to the ER if you are short of breath while sitting.",
      "Go to the ER if you have strong chest pain.",
    ],
    citationsFooter:
      "This summary uses plain language and action steps for patients [CIT-001, CIT-005, CIT-006].",
  };
}

function textFromVisitContext(ctx: VisitContext): string {
  return [
    ctx.clinician_summary ?? "",
    ...ctx.active_problems.map((p) => `${p.display} ${p.icd10 ?? ""}`),
    ...ctx.medication_changes.map(
      (m) => `${m.action} ${m.name} ${m.dose} ${m.reason ?? ""} ${m.behavior_rule ?? ""}`,
    ),
    ...ctx.orders.map((o) => `${o.type} ${o.display} ${o.timing ?? ""}`),
  ].join("\n");
}

function languageFromInput(args: PatientPacketInput): string {
  return args.language ?? args.visit_context.patient.preferred_language ?? "es-US";
}

function readingTargetFromInput(args: PatientPacketInput): string {
  return (
    args.reading_level_target ?? args.visit_context.patient.reading_level_target ?? "grade-6-es"
  );
}

function buildSystemPrompt(citationIds: string[]): string {
  return [
    "You are Featherless, a clinical visit workflow tool.",
    "Generate patient-facing education only from the provided visit_context and allowed citation IDs.",
    "Do not diagnose, prescribe, invent doses, invent dates, or add over-the-counter advice.",
    "Use plain language, short sentences, and action-oriented organization.",
    "Return exactly one valid JSON object and no other text.",
    "Use double-quoted keys and strings, comma-separate every array item, and never use comments or trailing commas.",
    "If a clinical value is missing, omit it or say it was not available; never invent data.",
    "Required JSON shape:",
    JSON.stringify(
      {
        language: "es-US",
        reading_level_target: "grade-6-es",
        title: "string",
        sections: {
          what_we_did_today: "string",
          medications: [
            {
              action: "new|continue",
              name: "string",
              dose: "string",
              instructions: "string",
              why: "string",
            },
          ],
          watch_for: ["string"],
          next_steps: ["string"],
          when_to_call: ["string"],
          when_to_go_to_er: ["string"],
          citations_footer: "string",
        },
        citations_used: citationIds,
      },
      null,
      2,
    ),
  ].join("\n");
}

function buildUserPrompt(
  args: PatientPacketInput,
  citationIds: string[],
  retryNote?: string,
): string {
  const language = languageFromInput(args);
  const target = readingTargetFromInput(args);
  return [
    `language: ${language}`,
    `reading_level_target: ${target}`,
    `allowed_citation_ids: ${citationIds.join(", ")}`,
    "draft_packet_json:",
    JSON.stringify(buildTemplatePatientPacket(args, citationIds), null, 2),
    "visit_context:",
    JSON.stringify(args.visit_context, null, 2),
    "chart_text:",
    textFromVisitContext(args.visit_context),
    retryNote ? `previous_generation_feedback: ${retryNote}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildTemplatePatientPacket(
  args: PatientPacketInput,
  citationIds: string[],
): GeneratedPatientPacket {
  const ctx = args.visit_context;
  const language = languageFromInput(args);
  const target = readingTargetFromInput(args);
  const labels = labelsFor(language);
  const newMed =
    ctx.medication_changes.find((m) => m.action === "new") ?? ctx.medication_changes[0];
  const medRows = ctx.medication_changes.map((m) => ({
    action: m.action,
    name: m.name,
    dose: m.dose,
    instructions:
      m.action === "new" && m.behavior_rule
        ? m.behavior_rule
        : m.action === "new"
          ? labels.newMedicationInstructions
          : labels.continueMedicationInstructions,
    why: m.reason ?? undefined,
  }));
  const nextSteps = ctx.orders.map((o) => {
    const timing = o.timing ? `${labels.timingPrefix}${o.timing}` : "";
    return `${o.display}${timing}.`;
  });
  return {
    language,
    reading_level_target: target,
    title: `${labels.titlePrefix}, ${ctx.patient.name}`,
    sections: {
      what_we_did_today: labels.visitSummary,
      medications: medRows,
      watch_for: [
        newMed ? labels.watchBeforeUsing(newMed.name, newMed.dose) : labels.noMedicationChangeWatch,
        labels.dailyWeight,
        labels.medicationQuestion,
      ],
      next_steps: nextSteps,
      when_to_call: labels.whenToCall,
      when_to_go_to_er: labels.whenToGoToEr,
      citations_footer: labels.citationsFooter,
    },
    citations_used: citationIds.filter((id) => ["CIT-001", "CIT-005", "CIT-006"].includes(id)),
  };
}

export function workersAiClientFromEnv(env: Env): LlmClient | null {
  if (!env.AI) return null;
  const model = env.LLM_MODEL ?? DEFAULT_WORKERS_AI_MODEL;
  return {
    async generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
      const result = (await env.AI?.run(model, {
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
      })) as { response?: string } | string | null | undefined;
      const text = typeof result === "string" ? result : result?.response;
      if (!text) throw new Error("workers_ai_error:empty_response");
      return { model, text };
    },
  };
}

async function callLlm(
  request: LlmGenerateRequest,
  opts: GeneratePatientPacketOpts,
): Promise<LlmGenerateResponse> {
  const client = opts.llm ?? (opts.env ? workersAiClientFromEnv(opts.env) : null);
  if (!client) {
    throw new Error("llm_config_required: bind Workers AI as AI or inject an LLM test seam.");
  }
  return client.generate(request);
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("llm_generation_failed:invalid_json");
  }
}

function renderPacketMarkdown(packet: GeneratedPatientPacket): string {
  const labels = labelsFor(packet.language);
  const meds = packet.sections.medications
    .map((m) => {
      const label = m.action === "new" ? labels.newLabel : labels.continueLabel;
      const why = m.why ? ` — ${m.why}` : "";
      const instructions = m.instructions ? ` ${m.instructions}` : "";
      return `| ${label} | ${m.name} | ${m.dose} |${why}${instructions} |`;
    })
    .join("\n");
  return [
    `# ${packet.title}`,
    "",
    labels.whatWeDidTodayHeading,
    packet.sections.what_we_did_today,
    "",
    labels.medicationsHeading,
    `| ${labels.actionHeader} | ${labels.medicineHeader} | ${labels.doseHeader} | ${labels.instructionsHeader} |`,
    "|---|---|---|---|",
    meds,
    "",
    labels.watchForHeading,
    ...packet.sections.watch_for.map((s) => `- ${s}`),
    "",
    labels.nextStepsHeading,
    ...packet.sections.next_steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    labels.whenToCallHeading,
    ...packet.sections.when_to_call.map((s) => `- ${s}`),
    "",
    labels.whenToGoToErHeading,
    ...packet.sections.when_to_go_to_er.map((s) => `- ${s}`),
    "",
    packet.sections.citations_footer,
  ].join("\n");
}

function validationRetryNote(grounding: ReturnType<typeof validateGrounding>): string {
  return JSON.stringify({
    unapproved_citations: grounding.unapproved_citations,
    unsupported_quotes: grounding.unsupported_quotes,
    unknown_doses: grounding.unknown_doses,
  });
}

export async function generatePatientPacket(
  args: PatientPacketInput,
  opts: GeneratePatientPacketOpts = {},
): Promise<PatientPacketOutput | Dict> {
  const citationIds = args.citation_ids ?? [...DEFAULT_ALLOWED_CITATION_IDS];
  const system = buildSystemPrompt(citationIds);
  let retryNote: string | undefined;
  let lastGrounding: ReturnType<typeof validateGrounding> | null = null;
  let lastModel = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const user = buildUserPrompt(args, citationIds, retryNote);
      const llm = await callLlm({ system, user }, opts);
      lastModel = llm.model;
      const generated = generatedPatientPacketSchema.parse(parseJsonObject(llm.text));
      const packet_markdown = renderPacketMarkdown(generated);
      const target = generated.reading_level_target;
      const scores = scoreReadability(packet_markdown);
      const grounding = validateGrounding({
        text: packet_markdown,
        visit_context: args.visit_context,
        allowed_citation_ids: citationIds,
        citations_used: generated.citations_used,
      });
      lastGrounding = grounding;
      if (!grounding.ok) {
        retryNote = validationRetryNote(grounding);
        continue;
      }
      return {
        ...generated,
        packet_markdown,
        readability: {
          flesch_kincaid_grade: scores.flesch_kincaid_grade,
          inflesz_score: scores.inflesz_score,
          word_count: scores.word_count,
          sentence_count: scores.sentence_count,
          target,
          meets_target: meetsReadingTarget(scores, target),
        },
        grounding,
        provider: "workers_ai",
        model: llm.model,
        generated_at: (opts.now?.() ?? new Date()).toISOString(),
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.startsWith("llm_config_required")) {
        return {
          error: "llm_config_required",
          message,
        };
      }
      if (attempt === 0) {
        retryNote = JSON.stringify({
          generation_error: message,
          instruction:
            "Return exactly one valid JSON object matching the required shape. Do not include Markdown or prose.",
        });
        continue;
      }
      return {
        error: "llm_generation_failed",
        message,
      };
    }
  }

  return {
    error: "grounding_validation_failed",
    message: "Generated patient packet did not pass grounding validation after retry.",
    provider: "workers_ai",
    model: lastModel,
    grounding: lastGrounding,
  };
}

export function registerClinicalPatientPacketTools(server: McpServer, env: Env): void {
  server.tool(
    "clinical_generate_patient_packet",
    "Generate a patient-facing visit packet from a typed clinical visit context. " +
      "Uses Workers AI, reports reading-level metrics, " +
      "and validates grounding against the chart and allowed citation IDs.",
    patientPacketInputSchema,
    async (args) => generatePatientPacket(args, { env }),
  );
}
