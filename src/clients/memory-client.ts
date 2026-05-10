/**
 * Clinical memory client backed by Cloudflare Vectorize + Workers AI + D1.
 *
 * Replaces mem0 (Python-only) with the Workers-native edge stack:
 *   - Workers AI `@cf/meta/llama-3.1-8b-instruct` for fact extraction
 *     (replaces mem0's OpenAI-driven extraction step)
 *   - Workers AI `@cf/baai/bge-base-en-v1.5` for 768-dim embeddings
 *   - Vectorize for ANN search (namespace-scoped per patient)
 *   - D1 for fact metadata, listing, and deletion bookkeeping
 *
 * Patient scoping: `userId = "patient:" + fhirPatientId` (preserves the
 * Python format for cross-system semantic compatibility).
 */
import { ulid } from "ulid";
import type { Env } from "../env.ts";

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const EXTRACTION_MODEL = "@cf/meta/llama-3.1-8b-instruct";

const EXTRACTION_SYSTEM_PROMPT = `You extract atomic clinical facts from a clinical text and return them as a JSON array of strings.

Rules:
- Each fact must be a single, self-contained sentence.
- Preserve all clinical specifics (numbers, drugs, doses, dates, codes).
- Drop conversational filler.
- Return ONLY a JSON array of strings. No prose, no markdown fences.

Example input:
"Patient seen on 2024-03-12 for follow-up of HTN. BP 142/92 today. Started lisinopril 10mg daily. Reports occasional headaches in the AM."

Example output:
["Patient was seen on 2024-03-12 for follow-up of hypertension.","Blood pressure was 142/92 on 2024-03-12.","Started lisinopril 10mg daily on 2024-03-12.","Patient reports occasional morning headaches."]`;

export interface FactRow {
  id: string;
  user_id: string;
  fact: string;
  fact_type: string;
  source_encounter: string | null;
  metadata_json: string | null;
  created_at: number;
}

export interface FactWithScore extends FactRow {
  score?: number;
}

export class MemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryError";
  }
}

export class MemoryClient {
  private readonly ai: Ai;
  private readonly index: VectorizeIndex;
  private readonly d1: D1Database;

  constructor(opts: { ai: Ai; index: VectorizeIndex; d1: D1Database }) {
    this.ai = opts.ai;
    this.index = opts.index;
    this.d1 = opts.d1;
  }

  static fromEnv(env: Env): MemoryClient | null {
    if (env.MEM0_DISABLED === "1") return null;
    if (!env.AI || !env.MEMORY_INDEX || !env.MEMORY_META) return null;
    return new MemoryClient({ ai: env.AI, index: env.MEMORY_INDEX, d1: env.MEMORY_META });
  }

  private static userId(patientId: string): string {
    return `patient:${patientId}`;
  }

  private async extractFacts(text: string): Promise<string[]> {
    const result = (await this.ai.run(EXTRACTION_MODEL, {
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    } as never)) as unknown as { response?: string };

    const raw = (result?.response ?? "").trim();
    const facts = parseFactList(raw);
    if (!facts.length) {
      // Fallback: store the raw text as one fact rather than losing it.
      return [text.length > 1000 ? text.slice(0, 1000) : text];
    }
    return facts;
  }

  private async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const result = (await this.ai.run(EMBEDDING_MODEL, { text: texts } as never)) as unknown as {
      data: number[][];
    };
    if (!result?.data || !Array.isArray(result.data)) {
      throw new MemoryError("Workers AI embedding returned no data");
    }
    return result.data;
  }

  /**
   * Extract facts from `text`, embed them, write to Vectorize + D1.
   */
  async addFact(
    patientId: string,
    text: string,
    metadata: {
      factType: string;
      sourceEncounter?: string | null;
      extra?: Record<string, unknown>;
    } = {
      factType: "note",
    },
  ): Promise<{ ids: string[]; facts: string[] }> {
    const userId = MemoryClient.userId(patientId);
    const facts = await this.extractFacts(text);
    if (!facts.length) return { ids: [], facts: [] };

    const vectors = await this.embed(facts);
    const ids: string[] = [];
    const now = Date.now();

    const upserts: VectorizeVector[] = [];
    const inserts: { id: string; row: FactRow }[] = [];

    for (let i = 0; i < facts.length; i++) {
      const id = ulid();
      ids.push(id);
      const fact = facts[i] ?? "";
      const values = vectors[i];
      if (!values) continue;
      upserts.push({
        id,
        values,
        namespace: userId,
        metadata: { factType: metadata.factType },
      });
      inserts.push({
        id,
        row: {
          id,
          user_id: userId,
          fact,
          fact_type: metadata.factType,
          source_encounter: metadata.sourceEncounter ?? null,
          metadata_json: metadata.extra ? JSON.stringify(metadata.extra) : null,
          created_at: now,
        },
      });
    }

    if (upserts.length) await this.index.upsert(upserts);

    if (inserts.length) {
      const stmt = this.d1.prepare(
        "INSERT INTO facts (id, user_id, fact, fact_type, source_encounter, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      const batch = inserts.map(({ row }) =>
        stmt.bind(
          row.id,
          row.user_id,
          row.fact,
          row.fact_type,
          row.source_encounter,
          row.metadata_json,
          row.created_at,
        ),
      );
      await this.d1.batch(batch);
    }

    return { ids, facts };
  }

  async search(patientId: string, query: string, limit: number): Promise<FactWithScore[]> {
    const userId = MemoryClient.userId(patientId);
    const [vector] = await this.embed([query]);
    if (!vector) return [];
    const result = await this.index.query(vector, {
      topK: limit,
      namespace: userId,
      returnMetadata: "all" as never,
    });
    const matches = result?.matches ?? [];
    if (!matches.length) return [];

    const ids = matches.map((m) => m.id);
    const placeholders = ids.map(() => "?").join(", ");
    const rows = await this.d1
      .prepare(
        `SELECT id, user_id, fact, fact_type, source_encounter, metadata_json, created_at FROM facts WHERE id IN (${placeholders})`,
      )
      .bind(...ids)
      .all<FactRow>();

    const byId = new Map(rows.results.map((r) => [r.id, r]));
    const out: FactWithScore[] = [];
    for (const m of matches) {
      const row = byId.get(m.id);
      if (row) out.push({ ...row, score: m.score });
    }
    return out;
  }

  async getAll(patientId: string, limit: number): Promise<FactRow[]> {
    const userId = MemoryClient.userId(patientId);
    const rows = await this.d1
      .prepare(
        "SELECT id, user_id, fact, fact_type, source_encounter, metadata_json, created_at FROM facts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .bind(userId, limit)
      .all<FactRow>();
    return rows.results;
  }

  async delete(memoryId: string): Promise<{ deleted: number }> {
    await this.index.deleteByIds([memoryId]);
    const res = await this.d1.prepare("DELETE FROM facts WHERE id = ?").bind(memoryId).run();
    return { deleted: res.meta.changes ?? 0 };
  }

  async deleteAll(patientId: string): Promise<{ deleted: number }> {
    const userId = MemoryClient.userId(patientId);
    const rows = await this.d1
      .prepare("SELECT id FROM facts WHERE user_id = ?")
      .bind(userId)
      .all<{ id: string }>();
    const ids = rows.results.map((r) => r.id);
    if (ids.length) await this.index.deleteByIds(ids);
    const res = await this.d1.prepare("DELETE FROM facts WHERE user_id = ?").bind(userId).run();
    return { deleted: res.meta.changes ?? 0 };
  }
}

function parseFactList(raw: string): string[] {
  if (!raw) return [];
  // Strip code fences if the model added them.
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  // First, try a strict JSON parse.
  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string"))
      return parsed.filter(Boolean);
  } catch {
    // fall through
  }
  // Last resort: extract the first JSON array substring.
  const match = stripped.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string"))
        return parsed.filter(Boolean);
    } catch {
      // give up
    }
  }
  return [];
}
