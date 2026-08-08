import { describe, expect, it } from "vitest";
import { buildBaselines, measureScenes, type CharacterScenes } from "./baseline.js";
import {
  findContextShifts,
  inferAddressees,
  measureContexts,
  type AddressedLine,
  type ContextLine,
} from "./context.js";

/** Builds a scene's worth of lines from [speaker, text] pairs. */
function scene(sceneId: string, turns: Array<[string, string]>, from = 0): ContextLine[] {
  return turns.map(([characterId, text], i) => ({
    sceneId,
    characterId,
    text,
    offset: from + i * 100,
  }));
}

describe("inferAddressees", () => {
  it("is certain when only two people are in the room", () => {
    const lines = scene("s1", [
      ["A", "Good morning."],
      ["B", "It is."],
      ["A", "Shall we walk?"],
    ]);
    const addressed = inferAddressees(lines);
    expect(addressed).toHaveLength(3);
    expect(addressed.map((l) => l.addresseeId)).toEqual(["B", "A", "B"]);
    expect(addressed.every((l) => l.basis === "two-hander")).toBe(true);
  });

  it("claims an addressee in a crowd only for a genuine back-and-forth", () => {
    const lines = scene("s1", [
      ["A", "One."],
      ["B", "Two."],
      ["A", "Three."],
      ["C", "Four."],
    ]);
    const addressed = inferAddressees(lines);
    // B sits between two A lines, so B is answering A. A's first line has no
    // line before it and A's second is followed by C, so neither is claimed.
    expect(addressed).toHaveLength(1);
    expect(addressed[0]!.characterId).toBe("B");
    expect(addressed[0]!.addresseeId).toBe("A");
    expect(addressed[0]!.basis).toBe("exchange");
  });

  it("says nothing when the neighbours disagree", () => {
    // Answered by one person, preceded by another: being answered is not
    // evidence of who you were speaking to.
    const lines = scene("s1", [
      ["A", "One."],
      ["B", "Two."],
      ["C", "Three."],
      ["D", "Four."],
    ]);
    expect(inferAddressees(lines)).toEqual([]);
  });

  it("treats a speech broken across paragraphs as one turn", () => {
    const lines = scene("s1", [
      ["A", "One."],
      ["B", "Two."],
      ["B", "Still me."],
      ["A", "Three."],
      ["C", "Four."],
    ]);
    const addressed = inferAddressees(lines);
    // Both of B's paragraphs are part of the same exchange with A.
    const bLines = addressed.filter((l) => l.characterId === "B");
    expect(bLines).toHaveLength(2);
    expect(bLines.every((l) => l.addresseeId === "A")).toBe(true);
  });

  it("does not carry an exchange across a scene break", () => {
    const lines = [
      ...scene("s1", [["A", "One."], ["B", "Two."]], 0),
      ...scene("s2", [["A", "Elsewhere."], ["C", "Indeed."]], 1000),
    ];
    const addressed = inferAddressees(lines);
    expect(addressed.filter((l) => l.sceneId === "s1").every((l) => ["A", "B"].includes(l.addresseeId))).toBe(true);
    expect(addressed.filter((l) => l.sceneId === "s2").every((l) => ["A", "C"].includes(l.addresseeId))).toBe(true);
  });

  it("refuses to call a scene a two-hander when a line is unattributed", () => {
    // Two named speakers and one unknown. The unknown might be a third person
    // in the room, which would make every "obvious" addressee here wrong.
    const lines: ContextLine[] = [
      { sceneId: "s1", characterId: "A", text: "One.", offset: 100 },
      { sceneId: "s1", characterId: null, text: "Who said that?", offset: 200 },
      { sceneId: "s1", characterId: "B", text: "Three.", offset: 300 },
    ];
    expect(inferAddressees(lines)).toEqual([]);
  });

  it("still finds an exchange around an unattributed line", () => {
    const lines: ContextLine[] = [
      { sceneId: "s1", characterId: "A", text: "One.", offset: 100 },
      { sceneId: "s1", characterId: "B", text: "Two.", offset: 200 },
      { sceneId: "s1", characterId: "A", text: "Three.", offset: 300 },
      { sceneId: "s1", characterId: null, text: "Unknown.", offset: 400 },
    ];
    const addressed = inferAddressees(lines);
    expect(addressed).toHaveLength(1);
    expect(addressed[0]!.characterId).toBe("B");
    expect(addressed[0]!.addresseeId).toBe("A");
  });

  it("says nothing about a monologue", () => {
    expect(inferAddressees(scene("s1", [["A", "Alone."], ["A", "Still alone."]]))).toEqual([]);
  });

  it("orders lines by position, not by the order they arrived", () => {
    const jumbled: ContextLine[] = [
      { sceneId: "s1", characterId: "A", text: "Third.", offset: 300 },
      { sceneId: "s1", characterId: "B", text: "Second.", offset: 200 },
      { sceneId: "s1", characterId: "A", text: "First.", offset: 100 },
    ];
    expect(inferAddressees(jumbled).map((l) => l.text)).toEqual(["First.", "Second.", "Third."]);
  });
});

/** Long, formal speech and clipped speech, for building measurable piles. */
const formal = (n: number) =>
  Array.from(
    { length: n },
    () => "I am aware of the circumstances, and I would be grateful if you would refrain from the observation entirely.",
  );
const clipped = (n: number) => Array.from({ length: n }, () => "You're late. Save it. Don't.");

/**
 * Lines spread across several scenes. A relationship measured in a single
 * scene can't be told apart from a single bad afternoon, so the code demands
 * at least two and these fixtures have to supply them.
 */
function said(
  characterId: string,
  addresseeId: string,
  texts: string[],
  scenes: number,
  from: number,
): AddressedLine[] {
  return texts.map((text, i) => ({
    sceneId: `${characterId}-${addresseeId}-${i % scenes}`,
    characterId,
    addresseeId,
    basis: "two-hander" as const,
    text,
    offset: from + i,
  }));
}

describe("measureContexts", () => {
  it("keeps a character's speech to each person separate", () => {
    const lines = [
      ...said("A", "B", formal(30), 3, 0),
      ...said("A", "C", clipped(60), 3, 1000),
    ];
    const measured = measureContexts(lines);
    const toB = measured.find((m) => m.addresseeId === "B")!;
    const toC = measured.find((m) => m.addresseeId === "C")!;
    expect(toB.metrics.meanSentenceLength).toBeGreaterThan(toC.metrics.meanSentenceLength);
  });

  it("lets an inferred line establish the room without being measured", () => {
    // Ida's lines are attributed by inference, so they place her in the scene
    // and make it a two-hander — but her voice is not measured from them.
    const lines: AddressedLine[] = [
      ...said("A", "I", formal(30), 3, 0),
      ...said("I", "A", clipped(60), 3, 500).map((l) => ({ ...l, isReliable: false })),
    ];
    const measured = measureContexts(lines);
    expect(measured.map((m) => m.speakerId)).toEqual(["A"]);
  });

  it("ignores a relationship with too little speech in it", () => {
    const lines = [
      ...said("A", "B", formal(30), 3, 0),
      ...said("A", "C", ["Hello."], 1, 999),
    ];
    expect(measureContexts(lines).map((m) => m.addresseeId)).toEqual(["B"]);
  });
});

/** A character measured across enough scenes to have a usable baseline. */
function baselineFor(characterId: string, scenes: string[][]): CharacterScenes {
  return {
    characterId,
    name: characterId,
    scenes: scenes.map((passages, i) => ({ sceneId: `${characterId}-${i}`, chapterIndex: i, sceneIndex: 0, passages })),
  };
}

describe("findContextShifts", () => {
  const names = new Map([["A", "Anna"], ["B", "Bram"], ["C", "Cato"]]);

  /** Anna is formal with Bram and clipped with Cato, across many scenes. */
  const build = () => {
    const scenes = [
      ...Array.from({ length: 4 }, () => formal(12)),
      ...Array.from({ length: 4 }, () => clipped(24)),
    ];
    const characters = [baselineFor("A", scenes)];
    const measurements = measureScenes(characters);
    const baselines = buildBaselines(characters, measurements);

    const lines = [
      ...said("A", "B", formal(40), 4, 0),
      ...said("A", "C", clipped(80), 4, 5000),
    ];
    return { baselines, contexts: measureContexts(lines) };
  };

  it("finds a character who changes register with one person", () => {
    const { baselines, contexts } = build();
    const shifts = findContextShifts(contexts, baselines, names);

    expect(shifts.length).toBeGreaterThan(0);
    const toBram = shifts.find((s) => s.addresseeName === "Bram")!;
    expect(toBram).toBeDefined();
    expect(toBram.summary).toContain("Anna");
    expect(toBram.summary).toContain("Bram");
  });

  it("is not blinded by a character whose overall spread is huge", () => {
    // Anna's scene-to-scene spread is enormous — but only because half her
    // scenes are with Bram and half with Cato. Measuring the difference
    // against that spread would hide the finding inside the ruler. Measuring
    // it against the wobble *within* each relationship, which is nil, finds it.
    const { baselines, contexts } = build();
    const ownSpread = baselines[0]!.metrics.meanSentenceLength!.spread;
    expect(ownSpread).toBeGreaterThan(3);

    const toBram = findContextShifts(contexts, baselines, names).find((s) => s.addresseeName === "Bram")!;
    const sentenceLength = toBram.evidence.find((e) => e.metric === "meanSentenceLength")!;
    expect(Math.abs(sentenceLength.z)).toBeGreaterThan(
      Math.abs(sentenceLength.observed - sentenceLength.elsewhere) / ownSpread,
    );
  });

  it("reports how much speech sits on each side of the comparison", () => {
    const { baselines, contexts } = build();
    const shift = findContextShifts(contexts, baselines, names)[0]!;
    expect(shift.wordCount).toBeGreaterThan(300);
    expect(shift.elsewhereWordCount).toBeGreaterThan(300);
  });

  it("compares against everyone else, not against the character's own average", () => {
    const { baselines, contexts } = build();
    const toBram = findContextShifts(contexts, baselines, names).find((s) => s.addresseeName === "Bram")!;
    const sentenceLength = toBram.evidence.find((e) => e.metric === "meanSentenceLength")!;
    // "Elsewhere" must be the clipped speech alone. Including the formal
    // speech in it would drag the comparison toward what is being tested.
    const toCato = contexts.find((c) => c.addresseeId === "C")!;
    expect(sentenceLength.elsewhere).toBeCloseTo(toCato.metrics.meanSentenceLength, 6);
  });

  it("says nothing about a character with only one relationship measured", () => {
    const { baselines, contexts } = build();
    const only = contexts.filter((c) => c.addresseeId === "B");
    expect(findContextShifts(only, baselines, names)).toEqual([]);
  });

  it("says nothing about a character with no usable baseline", () => {
    const { contexts } = build();
    expect(findContextShifts(contexts, [], names)).toEqual([]);
  });

  it("says nothing when a character speaks the same way to everyone", () => {
    const scenes = Array.from({ length: 8 }, () => formal(12));
    const characters = [baselineFor("A", scenes)];
    const baselines = buildBaselines(characters, measureScenes(characters));
    const lines = [
      ...said("A", "B", formal(40), 4, 0),
      ...said("A", "C", formal(40), 4, 5000),
    ];
    expect(findContextShifts(measureContexts(lines), baselines, names)).toEqual([]);
  });
});
