import { describe, expect, it } from "vitest";
import { countSyllables, splitSentences, tokenizeWords } from "./tokenize.js";

const texts = (input: string) => splitSentences(input).map((s) => s.text);
const endings = (input: string) => splitSentences(input).map((s) => s.ending);

describe("splitSentences", () => {
  it("splits on full stops", () => {
    expect(texts("One thing. Then another.")).toEqual(["One thing.", "Then another."]);
  });

  it("does not split on an abbreviation", () => {
    // The single most common false split in dialogue about English gentry.
    expect(texts("Mr. Bennet was quiet.")).toEqual(["Mr. Bennet was quiet."]);
    expect(texts("Ask Mrs. Gardiner and Dr. Grant.")).toEqual(["Ask Mrs. Gardiner and Dr. Grant."]);
  });

  it("does not split on initials", () => {
    expect(texts("It was J. R. Hartley.")).toEqual(["It was J. R. Hartley."]);
  });

  it("does not split inside a decimal", () => {
    expect(texts("It cost 3.50 exactly.")).toEqual(["It cost 3.50 exactly."]);
  });

  it("keeps the closing quote with its sentence", () => {
    expect(texts('He said "no." Then he left.')).toEqual(['He said "no."', "Then he left."]);
  });

  it("records questions and exclamations", () => {
    expect(endings("Are you well? Indeed! I am.")).toEqual(["question", "exclamation", "statement"]);
  });

  it("treats a run of marks as one ending", () => {
    const sentences = splitSentences("Really?! Yes!!!");
    expect(sentences).toHaveLength(2);
    expect(sentences[0]!.ending).toBe("question");
    expect(sentences[1]!.ending).toBe("exclamation");
  });

  it("records trailing off", () => {
    expect(endings("I suppose…")).toEqual(["trailed-off"]);
    expect(endings("I suppose... Well.")).toEqual(["trailed-off", "statement"]);
  });

  it("records being cut short", () => {
    expect(endings("I only meant—")).toEqual(["interrupted"]);
  });

  it("does not treat a parenthetical dash as an ending", () => {
    // A dash in the middle is punctuation; only one at the very end is an
    // interruption.
    expect(splitSentences("The thing — whatever it was — moved.")).toHaveLength(1);
  });

  it("marks an unterminated fragment", () => {
    expect(endings("No punctuation here")).toEqual(["unterminated"]);
  });

  it("ignores empty input", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   ")).toEqual([]);
  });

  it("reports offsets that map back to the input", () => {
    const input = "First one. Second one.";
    for (const sentence of splitSentences(input)) {
      expect(input.slice(sentence.start, sentence.end)).toContain(sentence.text);
    }
  });
});

describe("tokenizeWords", () => {
  it("counts a contraction as one word", () => {
    expect(tokenizeWords("I don’t know")).toEqual(["I", "don’t", "know"]);
  });

  it("counts a hyphenated compound as one word", () => {
    expect(tokenizeWords("a well-worn path")).toEqual(["a", "well-worn", "path"]);
  });

  it("drops punctuation", () => {
    expect(tokenizeWords("Yes — no … maybe?")).toEqual(["Yes", "no", "maybe"]);
  });

  it("strips Gutenberg emphasis markers", () => {
    expect(tokenizeWords("_You_ want to tell me")).toEqual(["You", "want", "to", "tell", "me"]);
  });

  it("returns nothing for punctuation alone", () => {
    expect(tokenizeWords("— … !")).toEqual([]);
  });
});

describe("countSyllables", () => {
  // Checked by hand; these are the cases a naive vowel-group count gets wrong.
  const cases: Array<[string, number]> = [
    ["a", 1],
    ["the", 1],
    ["cat", 1],
    ["nine", 1], // silent trailing e
    ["table", 2], // "le" carries a syllable
    ["little", 2],
    ["wanted", 2], // "-ed" pronounced after t
    ["walked", 1], // "-ed" silent
    ["beautiful", 3],
    ["universally", 5],
    ["acknowledged", 3],
    ["fortune", 2],
  ];

  for (const [word, expected] of cases) {
    it(`counts "${word}" as ${expected}`, () => {
      expect(countSyllables(word)).toBe(expected);
    });
  }

  it("never returns zero for a real word", () => {
    for (const word of ["rhythm", "strength", "queue", "eye"]) {
      expect(countSyllables(word)).toBeGreaterThanOrEqual(1);
    }
  });

  it("returns zero for an empty string", () => {
    expect(countSyllables("")).toBe(0);
    expect(countSyllables("—")).toBe(0);
  });
});
