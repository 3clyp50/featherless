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

const DEFAULT_WORKERS_AI_MODEL = "@cf/openai/gpt-oss-120b";
const PATIENT_PACKET_MAX_READING_GRADE = 6;

function contentPartToText(part: unknown): string {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  const dict = part as Dict;
  return typeof dict.text === "string" ? dict.text : "";
}

function contentToText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content.map(contentPartToText).join("").trim();
    return text.length > 0 ? text : null;
  }
  return null;
}

function workersAiText(result: unknown): string | null {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return null;
  const dict = result as Dict;
  const direct = contentToText(dict.response ?? dict.text ?? dict.output_text ?? dict.output);
  if (direct) return direct;
  if (!Array.isArray(dict.choices)) return null;
  const [choice] = dict.choices;
  if (!choice || typeof choice !== "object") return null;
  const choiceDict = choice as Dict;
  const message = choiceDict.message;
  if (message && typeof message === "object") {
    return contentToText((message as Dict).content);
  }
  return contentToText(choiceDict.text);
}

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

function gradeFromTarget(target: string): number | null {
  const normalized = target.trim().toLowerCase();
  const gradeFirst = /\bgrade[-_\s]*(\d{1,2})\b/.exec(normalized);
  if (gradeFirst?.[1]) return Number.parseInt(gradeFirst[1], 10);
  const gradeLast = /\b(\d{1,2})(?:st|nd|rd|th)?[-_\s]*grade\b/.exec(normalized);
  if (gradeLast?.[1]) return Number.parseInt(gradeLast[1], 10);
  return null;
}

function readingTargetForLanguage(
  language: string,
  grade = PATIENT_PACKET_MAX_READING_GRADE,
): string {
  return `grade-${grade}-${isSpanish(language) ? "es" : "en"}`;
}

export function normalizeReadingLevelTarget(
  target: string | null | undefined,
  language: string,
): string {
  const grade = target ? gradeFromTarget(target) : null;
  const effectiveGrade =
    grade && grade > 0
      ? Math.min(grade, PATIENT_PACKET_MAX_READING_GRADE)
      : PATIENT_PACKET_MAX_READING_GRADE;
  return readingTargetForLanguage(language, effectiveGrade);
}

function readingTargetFromInput(args: PatientPacketInput): string {
  return normalizeReadingLevelTarget(
    args.reading_level_target ?? args.visit_context.patient.reading_level_target,
    languageFromInput(args),
  );
}

function normalizePacketInput(args: PatientPacketInput): PatientPacketInput {
  const language = languageFromInput(args);
  const target = readingTargetFromInput(args);
  return {
    ...args,
    language,
    reading_level_target: target,
    visit_context: {
      ...args.visit_context,
      patient: {
        ...args.visit_context.patient,
        preferred_language: args.visit_context.patient.preferred_language ?? language,
        reading_level_target: target,
      },
    },
  };
}

function buildSystemPrompt(citationIds: string[]): string {
  return [
    "You are Featherless, a clinical visit workflow tool.",
    "Generate patient-facing education only from the provided visit_context and allowed citation IDs.",
    "Do not diagnose, prescribe, invent doses, invent dates, or add over-the-counter advice.",
    "Use plain patient-friendly language at or below the requested reading_level_target.",
    `Never write patient packets above grade ${PATIENT_PACKET_MAX_READING_GRADE}.`,
    "Use short sentences. Avoid medical jargon unless you explain it in simple words.",
    "Write clear action steps that a patient can follow after the visit.",
    "Return exactly one valid JSON object and no other text.",
    "Use double-quoted keys and strings, comma-separate every array item, and never use comments or trailing commas.",
    "If a clinical value is missing, omit it or say it was not available; never invent data.",
    "Required JSON shape:",
    JSON.stringify(
      {
        language: "es-US",
        reading_level_target: readingTargetForLanguage("es-US"),
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
  const normalizedArgs = normalizePacketInput(args);
  const language = languageFromInput(normalizedArgs);
  const target = readingTargetFromInput(normalizedArgs);
  return [
    `language: ${language}`,
    `reading_level_target: ${target}`,
    `readability_policy: Patient-facing language must be at or below ${target}; Featherless never allows patient packets above grade ${PATIENT_PACKET_MAX_READING_GRADE}.`,
    `allowed_citation_ids: ${citationIds.join(", ")}`,
    "draft_packet_json:",
    JSON.stringify(buildTemplatePatientPacket(normalizedArgs, citationIds), null, 2),
    "visit_context:",
    JSON.stringify(normalizedArgs.visit_context, null, 2),
    "chart_text:",
    textFromVisitContext(normalizedArgs.visit_context),
    retryNote ? `previous_generation_feedback: ${retryNote}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildTemplatePatientPacket(
  args: PatientPacketInput,
  citationIds: string[],
): GeneratedPatientPacket {
  const normalizedArgs = normalizePacketInput(args);
  const ctx = normalizedArgs.visit_context;
  const language = languageFromInput(normalizedArgs);
  const target = readingTargetFromInput(normalizedArgs);
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
        response_format: { type: "json_object" },
        chat_template_kwargs: { thinking: false, clear_thinking: true },
        max_completion_tokens: 1800,
        temperature: 0.2,
      })) as unknown;
      const text = workersAiText(result);
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

function readabilityRetryNote(scores: ReturnType<typeof scoreReadability>, target: string): string {
  return JSON.stringify({
    readability_target: target,
    measured_flesch_kincaid_grade: scores.flesch_kincaid_grade,
    measured_inflesz_score: scores.inflesz_score,
    instruction: `Rewrite with shorter sentences and simpler words so patient-facing language is at or below ${target}.`,
  });
}

export async function generatePatientPacket(
  args: PatientPacketInput,
  opts: GeneratePatientPacketOpts = {},
): Promise<PatientPacketOutput | Dict> {
  const normalizedArgs = normalizePacketInput(args);
  const citationIds = args.citation_ids ?? [...DEFAULT_ALLOWED_CITATION_IDS];
  const system = buildSystemPrompt(citationIds);
  let retryNote: string | undefined;
  let lastGrounding: ReturnType<typeof validateGrounding> | null = null;
  let lastReadability: ReturnType<typeof scoreReadability> | null = null;
  let lastModel = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const user = buildUserPrompt(normalizedArgs, citationIds, retryNote);
      const llm = await callLlm({ system, user }, opts);
      lastModel = llm.model;
      const rawGenerated = generatedPatientPacketSchema.parse(parseJsonObject(llm.text));
      const language = languageFromInput(normalizedArgs);
      const target = normalizeReadingLevelTarget(rawGenerated.reading_level_target, language);
      const generated: GeneratedPatientPacket = {
        ...rawGenerated,
        language,
        reading_level_target: target,
      };
      const packet_markdown = renderPacketMarkdown(generated);
      const scores = scoreReadability(packet_markdown);
      lastReadability = scores;
      if (!meetsReadingTarget(scores, target)) {
        retryNote = readabilityRetryNote(scores, target);
        continue;
      }
      const grounding = validateGrounding({
        text: packet_markdown,
        visit_context: normalizedArgs.visit_context,
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
    error: "patient_packet_validation_failed",
    message:
      "Generated patient packet did not pass readability and grounding validation after retry.",
    provider: "workers_ai",
    model: lastModel,
    grounding: lastGrounding,
    readability: lastReadability,
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
