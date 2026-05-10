import { describe, expect, it, vi } from "vitest";
import { meetsReadingTarget, scoreReadability } from "../../src/tools/readability.ts";

describe("readability metrics", () => {
  it("reports easy English below the grade-6 target", () => {
    const scores = scoreReadability("Take this pill today. Call us if you feel worse.");
    expect(scores.word_count).toBe(10);
    expect(scores.sentence_count).toBe(2);
    expect(scores.flesch_kincaid_grade).toBeLessThan(6.9);
    expect(meetsReadingTarget(scores, "grade-6-en")).toBe(true);
  });

  it("reports plain Spanish with an acceptable INFLESZ score", () => {
    const scores = scoreReadability(
      "Tome esta medicina hoy. Llame si se siente peor. Vuelva para sus estudios.",
    );
    expect(scores.word_count).toBeGreaterThan(10);
    expect(scores.inflesz_score).toBeGreaterThan(55);
    expect(meetsReadingTarget(scores, "grade-6-es")).toBe(true);
  });

  it("treats unknown reading targets as unmet", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const scores = scoreReadability("Take this pill today. Call us if you feel worse.");

    expect(meetsReadingTarget(scores, "plain-language")).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      'Unknown reading_level_target "plain-language" parsed as [plain, language]; treating as unmet.',
    );

    warn.mockRestore();
  });
});
