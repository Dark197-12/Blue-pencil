import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { normalizeText, stripGutenbergBoilerplate } from "./normalize.js";
import { detectQuoteStyle, extractDialogue } from "./dialogue.js";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name: string) =>
  normalizeText(stripGutenbergBoilerplate(readFileSync(join(here, "../../../fixtures", name), "utf8")));

describe("detectQuoteStyle", () => {
  it("recognises curly doubles", () => {
    expect(detectQuoteStyle("“a” ".repeat(20))).toBe("curly-double");
  });

  it("recognises straight doubles", () => {
    expect(detectQuoteStyle('"a" '.repeat(20))).toBe("straight-double");
  });

  it("recognises curly singles used as the outer quote", () => {
    expect(detectQuoteStyle("‘a’ ".repeat(20))).toBe("curly-single");
  });

  it("reads Pride and Prejudice as curly doubles", () => {
    expect(detectQuoteStyle(load("pride-and-prejudice.txt"))).toBe("curly-double");
  });
});

describe("extractDialogue — tags", () => {
  it("reads an inverted tag after the speech", () => {
    const [line] = extractDialogue("“You're late,” said Elena.");
    expect(line!.text).toBe("You're late,");
    expect(line!.tag).toMatchObject({ raw: "Elena", kind: "name", verb: "said", position: "after" });
  });

  it("reads a normal tag after the speech", () => {
    const [line] = extractDialogue("“You're late,” Elena said.");
    expect(line!.tag).toMatchObject({ raw: "Elena", kind: "name" });
  });

  it("reads a tag before the speech", () => {
    const [line] = extractDialogue("Elena said, “You're late.”");
    expect(line!.tag).toMatchObject({ raw: "Elena", kind: "name", position: "before" });
  });

  it("keeps a title attached to the name", () => {
    const [line] = extractDialogue("“Indeed,” replied Mr. Bennet.");
    expect(line!.tag?.raw).toBe("Mr. Bennet");
  });

  it("survives an adverb between tag and name", () => {
    const [line] = extractDialogue("“I am not,” said Lydia, stoutly.");
    expect(line!.tag?.raw).toBe("Lydia");
  });

  it("joins a name split across a hard-wrapped line", () => {
    // Manuscripts are wrapped, so a name straddles the break often. Left alone,
    // "Mr.\nDarcy" becomes a separate speaker from "Darcy".
    const [line] = extractDialogue("“Indeed,” replied Mr.\nDarcy, turning away.");
    expect(line!.tag?.raw).toBe("Mr. Darcy");
  });

  it("classifies pronouns and descriptors rather than dropping them", () => {
    const [pronoun] = extractDialogue("“But it is,” returned she.");
    expect(pronoun!.tag).toMatchObject({ raw: "she", kind: "pronoun" });

    const [descriptor] = extractDialogue("“Do you not want to know?” cried his wife.");
    expect(descriptor!.tag).toMatchObject({ kind: "descriptor" });
    expect(descriptor!.tag?.raw).toContain("wife");
  });

  it("stops a descriptor at the noun rather than swallowing the clause", () => {
    // "said his lady to him one day" must give "his lady", not "his lady to him".
    const [line] = extractDialogue("“My dear,” said his lady to him one day, “have you heard?”");
    expect(line!.tag?.raw).toBe("his lady");
  });

  it("keeps an adjective inside a descriptor", () => {
    const [line] = extractDialogue("“Aye,” said the old man.");
    expect(line!.tag?.raw).toBe("the old man");
  });

  it("leaves untagged dialogue untagged", () => {
    const [line] = extractDialogue("“What is his name?”\n\n“Bingley.”");
    expect(line!.tag).toBeNull();
  });

  it("does not treat 'thought' as speech", () => {
    const [line] = extractDialogue("“It is a fine day,” Elizabeth thought.");
    expect(line!.tag).toBeNull();
  });
});

describe("extractDialogue — split utterances", () => {
  it("joins a speech interrupted by its own tag", () => {
    const text = "“My dear Mr. Bennet,” said his lady, “have you heard the news?”";
    const lines = extractDialogue(text);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.segments).toHaveLength(2);
    expect(lines[0]!.text).toBe("My dear Mr. Bennet, have you heard the news?");
  });

  it("does not join two separate speeches", () => {
    // Second span starts with a capital and there is no tag between them.
    const text = "“What is his name?” “Bingley.”";
    expect(extractDialogue(text)).toHaveLength(2);
  });

  it("does not join across a paragraph break", () => {
    const text = "“First,” said Elena.\n\n“second thoughts,” she added.";
    expect(extractDialogue(text)).toHaveLength(2);
  });
});

describe("extractDialogue — mechanics", () => {
  it("strips Gutenberg emphasis markers from the spoken text", () => {
    const [line] = extractDialogue("“_You_ want to tell me.”");
    expect(line!.text).toBe("You want to tell me.");
  });

  it("reports offsets that map back to the source", () => {
    const text = "Before. “Hello there,” said Elena. After.";
    const [line] = extractDialogue(text);
    expect(text.slice(line!.segments[0]!.start, line!.segments[0]!.end)).toBe("“Hello there,”");
  });

  it("applies the offset option for extraction within a slice", () => {
    const [line] = extractDialogue("“Hi,” said Elena.", { offset: 1000 });
    expect(line!.start).toBe(1000);
  });

  it("handles straight quotes", () => {
    const [line] = extractDialogue('"You\'re late," said Elena.', { quoteStyle: "straight-double" });
    expect(line!.tag?.raw).toBe("Elena");
  });

  it("closes an unterminated quote at the paragraph end rather than losing it", () => {
    const lines = extractDialogue("“This never closes.\n\nNarration resumes.");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toContain("This never closes.");
  });

  it("ignores empty quotes", () => {
    expect(extractDialogue("“” said nobody.")).toHaveLength(0);
  });
});

describe("extractDialogue — editorial blocks", () => {
  it("skips a quoted illustration caption", () => {
    const text = '“Real speech,” said Elena.\n\n[Illustration:\n\n“A caption quoting her”\n\n]\n\n“More speech,” said Marcus.';
    const lines = extractDialogue(text);
    expect(lines.map((l) => l.text)).toEqual(["Real speech,", "More speech,"]);
  });

  it("can be told to include them", () => {
    const text = '“Real speech,” said Elena.\n\n[Illustration: “A caption” ]';
    expect(extractDialogue(text, { skipEditorialRegions: false })).toHaveLength(2);
  });

  it("keeps the real line when a caption duplicates it", () => {
    const text = '“She is tolerable,” said Darcy.\n\n[Illustration: “She is tolerable” ]';
    const lines = extractDialogue(text);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.tag?.raw).toBe("Darcy");
  });

  it("does not let an unclosed bracket swallow the rest of the manuscript", () => {
    const text = `[Illustration: never closed\n\n${"“Speech here,” said Elena.\n\n".repeat(60)}`;
    // The region is capped, so dialogue past it is still found.
    expect(extractDialogue(text).length).toBeGreaterThan(20);
  });
});

describe("extractDialogue — Pride and Prejudice", () => {
  const text = load("pride-and-prejudice.txt");
  const lines = extractDialogue(text);

  it("finds a substantial amount of dialogue", () => {
    // The novel is heavily dialogic; anything under a thousand means the
    // extractor is broken rather than merely imperfect.
    expect(lines.length).toBeGreaterThan(1000);
  });

  it("names a speaker on a meaningful share of lines", () => {
    const named = lines.filter((l) => l.tag?.kind === "name");
    expect(named.length / lines.length).toBeGreaterThan(0.15);
  });

  it("finds the opening exchange with its speaker", () => {
    const opening = lines.find((l) => l.text.startsWith("My dear Mr. Bennet"));
    expect(opening).toBeDefined();
    // One utterance, split by "said his lady to him one day".
    expect(opening!.segments).toHaveLength(2);
    expect(opening!.text).toContain("have you heard that Netherfield Park is let at last?");
    expect(opening!.tag?.kind).toBe("descriptor");
  });

  it("attributes named speakers that really are characters", () => {
    const names = new Set(lines.filter((l) => l.tag?.kind === "name").map((l) => l.tag!.raw));
    expect(names.has("Elizabeth")).toBe(true);
    expect(names.has("Mr. Bennet")).toBe(true);
  });

  it("every segment lies inside its line's range and maps to a real quote", () => {
    for (const line of lines.slice(0, 400)) {
      expect(line.segments.length).toBeGreaterThan(0);
      expect(line.segments[0]!.start).toBe(line.start);
      expect(line.segments[line.segments.length - 1]!.end).toBe(line.end);
      expect(text[line.segments[0]!.start]).toBe("“");
    }
  });
});
