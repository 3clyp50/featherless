export interface ReadabilityScores {
  flesch_kincaid_grade: number;
  inflesz_score: number;
  word_count: number;
  sentence_count: number;
  syllable_count_en: number;
  syllable_count_es: number;
}

const WORD_RE = /[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu;
const SENTENCE_RE = /[^.!?]+[.!?]+|[^.!?]+$/g;
const EN_VOWELS = /[aeiouy]+/gi;
const ES_VOWELS = /[aeiouáéíóúü]+/gi;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function words(text: string): string[] {
  return text.match(WORD_RE) ?? [];
}

function sentenceCount(text: string): number {
  const matches = text.match(SENTENCE_RE) ?? [];
  return Math.max(1, matches.filter((s) => s.trim().length > 0).length);
}

function englishSyllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!clean) return 0;
  const withoutSilentE = clean.length > 3 && clean.endsWith("e") ? clean.slice(0, -1) : clean;
  const groups = withoutSilentE.match(EN_VOWELS)?.length ?? 0;
  return Math.max(1, groups);
}

function spanishSyllables(word: string): number {
  const clean = word
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}]/gu, "");
  if (!clean) return 0;
  const groups = clean.match(ES_VOWELS)?.length ?? 0;
  return Math.max(1, groups);
}

export function scoreReadability(text: string): ReadabilityScores {
  const ws = words(text);
  const word_count = Math.max(1, ws.length);
  const sentence_count = sentenceCount(text);
  const syllable_count_en = ws.reduce((sum, w) => sum + englishSyllables(w), 0);
  const syllable_count_es = ws.reduce((sum, w) => sum + spanishSyllables(w), 0);

  const flesch_kincaid_grade =
    0.39 * (word_count / sentence_count) + 11.8 * (syllable_count_en / word_count) - 15.59;
  const inflesz_score =
    206.835 - 62.3 * (syllable_count_es / word_count) - word_count / sentence_count;

  return {
    flesch_kincaid_grade: round1(Math.max(0, flesch_kincaid_grade)),
    inflesz_score: round1(Math.max(0, Math.min(100, inflesz_score))),
    word_count,
    sentence_count,
    syllable_count_en,
    syllable_count_es,
  };
}

export function meetsReadingTarget(scores: ReadabilityScores, target: string): boolean {
  const t = target.trim().toLowerCase();
  const parts = t.split(/[-_]/).filter(Boolean);
  if (parts.includes("es")) return scores.inflesz_score >= 55;
  if (t.includes("grade-6") || t.includes("grade 6")) {
    return scores.flesch_kincaid_grade <= 6.9;
  }
  console.warn(
    `Unknown reading_level_target "${target}" parsed as [${parts.join(", ")}]; treating as unmet.`,
  );
  return false;
}
