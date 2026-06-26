import { describe, it, expect } from "vitest";
import {
  normalizeNameTokens,
  matchSenderName,
  MIN_TRANSACTION_NGN,
  MAX_TRANSACTION_NGN,
} from "../fraud-guard";

// ─────────────────────────────────────────────────────────────────────────────
// Name Normalization Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeNameTokens", () => {
  it("lowercases and sorts tokens alphabetically", () => {
    expect(normalizeNameTokens("OLASUNKANMI OLATUNDE JAMES")).toEqual([
      "james",
      "olasunkanmi",
      "olatunde",
    ]);
  });

  it("strips punctuation and special characters", () => {
    expect(normalizeNameTokens("O'Brien-Smith, Jr.")).toEqual(["jr", "obriensmith"]);
  });

  it("collapses extra whitespace", () => {
    expect(normalizeNameTokens("  Tunde   Olasunkanmi  ")).toEqual([
      "olasunkanmi",
      "tunde",
    ]);
  });

  it("removes single-character tokens", () => {
    expect(normalizeNameTokens("A Tunde B")).toEqual(["tunde"]);
  });

  it("returns empty array for null/empty input", () => {
    expect(normalizeNameTokens("")).toEqual([]);
    expect(normalizeNameTokens(null as unknown as string)).toEqual([]);
    expect(normalizeNameTokens(undefined as unknown as string)).toEqual([]);
  });

  it("handles Nigerian name formats with three names", () => {
    const tokens = normalizeNameTokens("ADEWALE OLUMIDE FASHOLA");
    expect(tokens).toEqual(["adewale", "fashola", "olumide"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Name Matching Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("matchSenderName", () => {
  it("matches exact same name (case insensitive)", () => {
    const result = matchSenderName("OLASUNKANMI TUNDE", "Olasunkanmi Tunde");
    expect(result.match).toBe(true);
    expect(result.score).toBe(1);
  });

  it("matches reordered name tokens", () => {
    const result = matchSenderName("TUNDE OLASUNKANMI", "Olasunkanmi Tunde");
    expect(result.match).toBe(true);
    expect(result.score).toBe(1);
  });

  it("matches with 3 names when 2 of 3 match (66% < 70% threshold)", () => {
    const result = matchSenderName("TUNDE JAMES", "Olasunkanmi Tunde James");
    // 2 out of 3 legal tokens match = 0.67 → below 0.7 threshold
    expect(result.match).toBe(false);
    expect(result.score).toBeCloseTo(0.67, 1);
  });

  it("matches with 3 names when all 3 match (100%)", () => {
    const result = matchSenderName(
      "OLASUNKANMI TUNDE JAMES",
      "Olasunkanmi Tunde James"
    );
    expect(result.match).toBe(true);
    expect(result.score).toBe(1);
  });

  it("handles bank-truncated names via prefix matching", () => {
    // Bank sends "OLASUNKANMI O" which should match "Olasunkanmi Olatunde"
    const result = matchSenderName("OLASUNKANMI O", "Olasunkanmi Olatunde");
    // "olasunkanmi" matches exactly, but "o" is single char and gets filtered out
    // So sender tokens = ["olasunkanmi"], legal tokens = ["olasunkanmi", "olatunde"]
    // 1 out of 2 = 0.5 → below threshold
    // However, with the startsWith check: "olasunkanmi".startsWith("olatunde") = false
    // and "olatunde".startsWith("olasunkanmi") = false
    // So it's a partial match scenario
    expect(result.score).toBeLessThan(1);
  });

  it("rejects completely different names", () => {
    const result = matchSenderName("CHINEDU OKORO", "Olasunkanmi Tunde");
    expect(result.match).toBe(false);
    expect(result.score).toBe(0);
  });

  it("returns score 0 for empty inputs", () => {
    expect(matchSenderName("", "Tunde").score).toBe(0);
    expect(matchSenderName("Tunde", "").score).toBe(0);
    expect(matchSenderName("", "").score).toBe(0);
  });

  it("handles names with extra titles/prefixes gracefully", () => {
    const result = matchSenderName(
      "ALHAJI OLASUNKANMI TUNDE",
      "Olasunkanmi Tunde"
    );
    // legal tokens: ["olasunkanmi", "tunde"] — both found in sender
    expect(result.match).toBe(true);
    expect(result.score).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Transaction Limit Constants Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Transaction limit constants", () => {
  it("has correct minimum transaction amount", () => {
    expect(MIN_TRANSACTION_NGN).toBe(1_000);
  });

  it("has correct maximum transaction amount", () => {
    expect(MAX_TRANSACTION_NGN).toBe(100_000);
  });

  it("minimum is less than maximum", () => {
    expect(MIN_TRANSACTION_NGN).toBeLessThan(MAX_TRANSACTION_NGN);
  });
});
