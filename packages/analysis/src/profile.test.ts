import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { normalizeText, stripGutenbergBoilerplate } from "./normalize.js";
import { detectChapters } from "./structure.js";
import { extractDialogue } from "./dialogue.js";
import { buildCast } from "./characters.js";
import { buildProfiles, findSignatureWords, voiceSimilarity } from "./profile.js";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name: string) =>
  normalizeText(stripGutenbergBoilerplate(readFileSync(join(here, "../../../fixtures", name), "utf8")));

/** Speech long enough to clear the reliability floor. */
const bulk = (phrase: string, times: number) => Array.from({ length: times }, () => phrase);

describe("findSignatureWords", () => {
  it("finds a word one speaker uses far more than the others", () => {
    const own = bulk("Obviously the matter is settled.", 20);
    const others = bulk("The matter is settled.", 40);
    const words = findSignatureWords(own, others);
    expect(words[0]!.word).toBe("obviously");
    expect(words[0]!.distinctiveness).toBeGreaterThan(2);
  });

  it("ignores words everybody uses equally", () => {
    const own = bulk("The matter is settled.", 20);
    const others = bulk("The matter is settled.", 40);
    expect(findSignatureWords(own, others)).toEqual([]);
  });

  it("ignores a word said only once or twice", () => {
    const own = ["Obviously.", "The matter is settled and done with entirely."];
    const others = bulk("The matter is settled.", 20);
    expect(findSignatureWords(own, others).map((w) => w.word)).not.toContain("obviously");
  });

  it("does not rank a word nobody else uses above a genuinely characteristic one", () => {
    // Without smoothing, dividing by a zero rate makes every one-off infinite.
    const own = [...bulk("Obviously it is so.", 30), ...bulk("Antidisestablishmentarianism.", 3)];
    const others = bulk("It is so.", 60);
    const words = findSignatureWords(own, others);
    expect(words.every((w) => Number.isFinite(w.distinctiveness))).toBe(true);
  });

  it("returns nothing for a character who says nothing", () => {
    expect(findSignatureWords([], bulk("Words here.", 10))).toEqual([]);
  });
});

describe("buildProfiles", () => {
  // One contraction, so both speakers register on the metric — a measure only
  // one character scores on at all is suppressed, by design.
  const formal = bulk(
    "I am aware of the hour, and I'd appreciate it if you refrained from the observation entirely.",
    40,
  );
  // 120 repetitions, not 60: at 5 words each the shorter version sat below the
  // 500-word reliability floor, so the cast average was being computed from
  // every character including the bit parts and the test proved nothing.
  const clipped = bulk("You're late. Save it. Don't.", 120);

  it("scores a metric against the rest of the cast", () => {
    const profiles = buildProfiles([
      { name: "Formal", passages: formal },
      { name: "Clipped", passages: clipped },
    ]);

    const f = profiles.find((p) => p.name === "Formal")!;
    const c = profiles.find((p) => p.name === "Clipped")!;

    // Opposite sides of the cast mean, whatever the raw units.
    expect(f.z.meanSentenceLength!).toBeGreaterThan(0);
    expect(c.z.meanSentenceLength!).toBeLessThan(0);
    expect(f.z.contractionRate!).toBeLessThan(c.z.contractionRate!);
  });

  it("marks a character with too little speech as unreliable", () => {
    const profiles = buildProfiles([
      { name: "Talkative", passages: formal },
      { name: "Quiet", passages: ["Only a handful of words here."] },
    ]);
    expect(profiles.find((p) => p.name === "Talkative")!.isReliable).toBe(true);
    expect(profiles.find((p) => p.name === "Quiet")!.isReliable).toBe(false);
  });

  it("does not let a bit-part character drag the cast average", () => {
    const withoutExtra = buildProfiles([
      { name: "Formal", passages: formal },
      { name: "Clipped", passages: clipped },
    ]);
    const withExtra = buildProfiles([
      { name: "Formal", passages: formal },
      { name: "Clipped", passages: clipped },
      { name: "Bit part", passages: ["Yes."] },
    ]);

    const before = withoutExtra.find((p) => p.name === "Formal")!.z.meanSentenceLength!;
    const after = withExtra.find((p) => p.name === "Formal")!.z.meanSentenceLength!;
    expect(after).toBeCloseTo(before, 5);
  });

  it("skips a metric the whole cast shares, rather than magnifying rounding error", () => {
    const profiles = buildProfiles([
      { name: "A", passages: bulk("The matter is settled and done.", 40) },
      { name: "B", passages: bulk("The matter is settled and done.", 40) },
    ]);
    // Nobody swears, so profanity has no spread and no z-score.
    expect(profiles[0]!.z.profanityRate).toBeUndefined();
  });

  it("does not score a metric only one character registers on", () => {
    // Three speakers who never swear and one who says "damn" once: the spread
    // is real but meaningless, and scoring it invents a headline finding out
    // of a single word.
    const plain = bulk("The matter is settled and done with entirely today.", 60);
    const profiles = buildProfiles([
      { name: "A", passages: plain },
      { name: "B", passages: plain },
      { name: "C", passages: plain },
      { name: "D", passages: [...plain, "Damn."] },
    ]);
    expect(profiles.find((p) => p.name === "D")!.z.profanityRate).toBeUndefined();
  });
});

describe("voiceSimilarity", () => {
  it("scores identical voices as identical", () => {
    const passages = bulk("The matter is settled and done with entirely.", 40);
    const [a, b] = buildProfiles([
      { name: "A", passages },
      { name: "B", passages },
    ]);
    expect(voiceSimilarity(a!, b!)).toBe(100);
  });

  it("scores deliberately different voices as distinct", () => {
    const profiles = buildProfiles([
      {
        name: "Formal",
        passages: bulk("I would appreciate it if you refrained from the observation entirely.", 40),
      },
      { name: "Clipped", passages: bulk("You're late. Save it. Don't.", 60) },
    ]);
    expect(voiceSimilarity(profiles[0]!, profiles[1]!)).toBeLessThan(50);
  });
});

describe("profiles — Pride and Prejudice", () => {
  const text = load("pride-and-prejudice.txt");
  const chapters = detectChapters(text);
  const lines = chapters.flatMap((c) => extractDialogue(text.slice(c.start, c.end), { offset: c.start }));
  const cast = buildCast(lines);

  const alias = new Map<string, string>();
  for (const member of cast.members) for (const a of member.aliases) alias.set(a, member.name);

  // Speech tags only — the one attribution method measured at 100% accuracy.
  const speech = new Map<string, string[]>();
  for (const line of lines) {
    if (line.tag?.kind !== "name") continue;
    const name = alias.get(line.tag.raw);
    if (!name) continue;
    speech.set(name, [...(speech.get(name) ?? []), line.text]);
  }

  const profiles = buildProfiles(
    [...speech.entries()].map(([name, passages]) => ({ name, passages })),
  );
  const find = (name: string) => profiles.find((p) => p.name === name);

  it("finds Mr. Collins the most long-winded speaker in the book", () => {
    // He is famously incapable of a short sentence; if the engine cannot see
    // that, it cannot see anything.
    const collins = find("Mr. Collins")!;
    const others = profiles.filter((p) => p.isReliable && p.name !== "Mr. Collins");
    for (const other of others) {
      expect(collins.metrics.meanSentenceLength).toBeGreaterThan(other.metrics.meanSentenceLength);
    }
    expect(collins.z.meanSentenceLength!).toBeGreaterThan(1.5);
  });

  it("finds Mrs. Bennet the plainest speaker", () => {
    const mrsBennet = find("Mrs. Bennet")!;
    expect(mrsBennet.z.latinateRate!).toBeLessThan(0);
    expect(mrsBennet.z.readingGrade!).toBeLessThan(0);
    expect(mrsBennet.z.exclamationRate!).toBeGreaterThan(0);
  });

  it("finds Darcy contracting less than anyone", () => {
    const darcy = find("Darcy")!;
    expect(darcy.z.contractionRate!).toBeLessThan(0);
  });

  it("gives the principals enough speech to be reliable", () => {
    for (const name of ["Elizabeth", "Jane", "Mrs. Bennet", "Darcy"]) {
      expect(find(name)!.isReliable, name).toBe(true);
    }
  });

  it("rates two formal speakers as more alike than a formal and a plain one", () => {
    const collins = find("Mr. Collins")!;
    const darcy = find("Darcy")!;
    const mrsBennet = find("Mrs. Bennet")!;
    expect(voiceSimilarity(collins, darcy)).toBeGreaterThan(voiceSimilarity(collins, mrsBennet));
  });
});
