import { describe, expect, it } from "vitest";
import { head, tail } from "./StructureReview";

/**
 * Chapter previews are how boundary mistakes get spotted, so the excerpts must
 * not themselves look broken. Cutting mid-word makes a correct boundary look
 * wrong.
 */
describe("head", () => {
  it("returns short text unchanged, with no ellipsis", () => {
    expect(head("A short line.", 40)).toBe("A short line.");
  });

  it("cuts at a word boundary and marks the cut", () => {
    const result = head("The quick brown fox jumps over the lazy dog", 20);
    expect(result.endsWith("…")).toBe(true);
    // Nothing chopped mid-word.
    expect(result.replace("…", "").trimEnd().split(" ").pop()).not.toBe("jum");
    expect("The quick brown fox jumps over the lazy dog").toContain(result.replace("…", "").trimEnd());
  });

  it("cuts at the limit when the last space is too far back to use", () => {
    // One very long token: honouring the word boundary would discard most of
    // the excerpt, so the limit wins.
    const result = head(`short ${"x".repeat(60)}`, 30);
    expect(result.length).toBeLessThanOrEqual(31);
    expect(result.endsWith("…")).toBe(true);
  });

  it("leaves no trailing space before the ellipsis", () => {
    expect(head("alpha beta gamma delta epsilon", 12)).not.toMatch(/ …$/);
  });
});

describe("tail", () => {
  it("returns short text unchanged", () => {
    expect(tail("A short line.", 40)).toBe("A short line.");
  });

  it("starts on a whole word and marks the cut", () => {
    const source = "The quick brown fox jumps over the lazy dog";
    const result = tail(source, 20);
    expect(result.startsWith("…")).toBe(true);
    expect(source).toContain(result.replace("…", "").trimStart());
  });

  it("leaves no leading space after the ellipsis", () => {
    expect(tail("alpha beta gamma delta epsilon", 12)).not.toMatch(/^… /);
  });

  it("keeps the very end of the text", () => {
    // The end is what reveals a chapter that swallowed the next heading.
    expect(tail("alpha beta gamma delta epsilon", 12).endsWith("epsilon")).toBe(true);
  });
});
