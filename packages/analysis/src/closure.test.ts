import { describe, expect, it } from "vitest";
import { closeTwoHanders, type SceneAnchored } from "./closure.js";

/**
 * Builds anchored lines from a compact spec. `speaker` is null for a line the
 * prose left unattributed. Offsets advance by 50 characters, so lines sit in
 * one exchange unless a gap is asked for.
 */
function build(
  spec: Array<{ speaker: string | null; sceneId?: string; gapBefore?: boolean }>,
): SceneAnchored[] {
  let offset = 0;
  return spec.map((entry) => {
    // 400 characters clears the 300-character gap that ends an exchange.
    if (entry.gapBefore) offset += 400;
    const start = offset;
    offset += 50;
    return {
      line: { start, end: start + 20, text: "…", segments: [], tag: null } as SceneAnchored["line"],
      speaker: entry.speaker,
      sceneId: entry.sceneId ?? "s1",
    };
  });
}

const speakersAt = (results: ReturnType<typeof closeTwoHanders>) =>
  new Map(results.map((r) => [r.index, r.speaker]));

describe("closeTwoHanders", () => {
  it("fills a two-hander from a single anchor, which tier 2 cannot", () => {
    // Only one name in the whole exchange. Alternation has nothing to
    // alternate with; scene scope supplies the other party.
    const lines = build([
      { speaker: "Anna" },
      { speaker: null },
      { speaker: null },
      { speaker: "Bram" },
    ]);
    const found = speakersAt(closeTwoHanders(lines, { minAnchorsPerSpeaker: 1 }));

    expect(found.get(1)).toBe("Bram");
    expect(found.get(2)).toBe("Anna");
  });

  it("leaves a scene with three named speakers alone", () => {
    const lines = build([
      { speaker: "Anna" },
      { speaker: null },
      { speaker: "Bram" },
      { speaker: null },
      { speaker: "Cato" },
    ]);
    expect(closeTwoHanders(lines, { minAnchorsPerSpeaker: 1 })).toEqual([]);
  });

  it("wants both parties named more than once", () => {
    // Bram speaks one named line and is never named again — the shape of a
    // servant announcing a visitor, not of a conversation.
    const lines = build([
      { speaker: "Anna" },
      { speaker: "Bram" },
      { speaker: null },
      { speaker: null },
      { speaker: "Anna" },
    ]);
    expect(closeTwoHanders(lines, { minAnchorsPerSpeaker: 2 })).toEqual([]);
    expect(closeTwoHanders(lines, { minAnchorsPerSpeaker: 1 }).length).toBeGreaterThan(0);
  });

  it("skips an exchange whose anchors disagree about parity", () => {
    // Anna at 0 and Anna at 1: somebody spoke twice in a row, so the parity is
    // broken and carrying it through would misattribute the rest.
    const lines = build([
      { speaker: "Anna" },
      { speaker: "Anna" },
      { speaker: null },
      { speaker: "Bram" },
      { speaker: null },
      { speaker: "Bram" },
    ]);
    expect(closeTwoHanders(lines, { minAnchorsPerSpeaker: 1 })).toEqual([]);
  });

  it("takes parity from the exchange, not from the scene", () => {
    // Two exchanges either side of narration. The second starts with Bram
    // rather than continuing the first's parity — which is exactly why parity
    // is not carried across a break.
    const lines = build([
      { speaker: "Anna" },
      { speaker: null },
      { speaker: "Bram", gapBefore: true },
      { speaker: null },
      { speaker: "Bram" },
    ]);
    const found = speakersAt(closeTwoHanders(lines, { minAnchorsPerSpeaker: 1 }));
    expect(found.get(1)).toBe("Bram");
    expect(found.get(3)).toBe("Anna");
  });

  it("says nothing about an exchange with no anchor at all", () => {
    const lines = build([
      { speaker: "Anna" },
      { speaker: "Bram" },
      { speaker: null, gapBefore: true },
      { speaker: null },
    ]);
    const found = speakersAt(closeTwoHanders(lines, { minAnchorsPerSpeaker: 1 }));
    // The scene names two people, but nothing says which of them speaks first
    // after the break, and a coin flip is wrong half the time.
    expect(found.has(2)).toBe(false);
    expect(found.has(3)).toBe(false);
  });

  it("keeps scenes apart", () => {
    const lines = build([
      { speaker: "Anna", sceneId: "s1" },
      { speaker: "Bram", sceneId: "s1" },
      { speaker: null, sceneId: "s1" },
      // A different scene, with a different pair.
      { speaker: "Cato", sceneId: "s2" },
      { speaker: "Dora", sceneId: "s2" },
      { speaker: null, sceneId: "s2" },
    ]);
    const found = speakersAt(closeTwoHanders(lines, { minAnchorsPerSpeaker: 1 }));
    expect(found.get(2)).toBe("Anna");
    expect(found.get(5)).toBe("Cato");
  });

  it("ignores lines with no scene", () => {
    const lines = build([{ speaker: "Anna" }, { speaker: "Bram" }, { speaker: null }]);
    for (const line of lines) line.sceneId = null;
    expect(closeTwoHanders(lines, { minAnchorsPerSpeaker: 1 })).toEqual([]);
  });

  it("never overwrites a line that already has a speaker", () => {
    const lines = build([
      { speaker: "Anna" },
      { speaker: "Bram" },
      { speaker: null },
      { speaker: "Bram" },
    ]);
    const results = closeTwoHanders(lines, { minAnchorsPerSpeaker: 1 });
    for (const result of results) expect(lines[result.index]!.speaker).toBeNull();
  });
});
