import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { normalizeText, stripGutenbergBoilerplate } from "./normalize.js";
import { detectChapters, detectScenes, findChapterCandidates, splitParagraphs } from "./structure.js";
import { parseOrdinal, romanToInt, wordsToInt } from "./roman.js";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name: string) =>
  normalizeText(stripGutenbergBoilerplate(readFileSync(join(here, "../../../fixtures", name), "utf8")));

describe("roman numerals", () => {
  it("parses well-formed numerals", () => {
    expect(romanToInt("I")).toBe(1);
    expect(romanToInt("IV")).toBe(4);
    expect(romanToInt("XLIII")).toBe(43);
    expect(romanToInt("lxi")).toBe(61);
  });

  it("rejects malformed numerals rather than guessing", () => {
    expect(romanToInt("IIII")).toBeNull(); // four I's; should be IV
    expect(romanToInt("IC")).toBeNull(); // I may only precede V and X
    expect(romanToInt("IL")).toBeNull();
    expect(romanToInt("VX")).toBeNull(); // V is never a subtractive prefix
    expect(romanToInt("")).toBeNull();
    expect(romanToInt("banana")).toBeNull();
  });

  it("accepts numerals that merely look odd", () => {
    // MIX is M + IX. Worth pinning down, because it reads like a word.
    expect(romanToInt("MIX")).toBe(1009);
    expect(romanToInt("DI")).toBe(501);
  });
});

describe("spelled-out numbers", () => {
  it("parses ones, teens and compounds", () => {
    expect(wordsToInt("One")).toBe(1);
    expect(wordsToInt("nineteen")).toBe(19);
    expect(wordsToInt("Twenty-Three")).toBe(23);
    expect(wordsToInt("forty two")).toBe(42);
  });

  it("rejects nonsense", () => {
    expect(wordsToInt("twenty-thirty")).toBeNull();
    expect(wordsToInt("elephant")).toBeNull();
  });
});

describe("parseOrdinal", () => {
  it("accepts all three notations", () => {
    expect(parseOrdinal("12")).toBe(12);
    expect(parseOrdinal("XII")).toBe(12);
    expect(parseOrdinal("twelve")).toBe(12);
  });
});

describe("detectChapters — synthetic cases", () => {
  const prose = (n: number) => Array.from({ length: n }, (_, i) => `Word${i}`).join(" ");

  it("returns one chapter when the text has no headings", () => {
    const chapters = detectChapters(`${prose(400)}`);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.heading).toBe("Untitled");
  });

  it("returns nothing for empty text", () => {
    expect(detectChapters("   \n  ")).toHaveLength(0);
  });

  it("splits on numbered headings", () => {
    const text = `Chapter 1\n\n${prose(400)}\n\nChapter 2\n\n${prose(400)}`;
    const chapters = detectChapters(text);
    expect(chapters).toHaveLength(2);
    expect(chapters.map((c) => c.ordinal)).toEqual([1, 2]);
  });

  it("does not mistake prose beginning with a heading word for a heading", () => {
    const text = `Chapter 1\n\n${prose(400)}\n\nPart of her wanted to leave.\n\n${prose(400)}`;
    expect(detectChapters(text)).toHaveLength(1);
  });

  it("keeps a genuine multi-part book whose numbering restarts", () => {
    // Part One ch 1–2, Part Two ch 1–2 — both runs are substantial, so both stay.
    const text = [
      `Chapter 1\n\n${prose(500)}`,
      `Chapter 2\n\n${prose(500)}`,
      `Chapter 1\n\n${prose(500)}`,
      `Chapter 2\n\n${prose(500)}`,
    ].join("\n\n");
    expect(detectChapters(text)).toHaveLength(4);
  });

  it("does not read a numeral out of the middle of a word", () => {
    // "ACT DROP" once yielded ordinal 500, because the numeral alternative
    // matched the leading "D" and the leftover "ROP" fell into the title group.
    const text = `ACT DROP\n\n${prose(600)}\n\nChapter Divide\n\n${prose(600)}`;
    const chapters = detectChapters(text);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.heading).toBe("Untitled");
  });

  it("ignores a bare number that is not alone between blank lines", () => {
    const text = `Chapter 1\n\n${prose(400)}\nsee footnote\n149.\nand so on\n\n${prose(400)}`;
    const chapters = detectChapters(text);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.ordinal).toBe(1);
  });

  it("strips Markdown syntax from the heading it shows the reader", () => {
    const text = `# Chapter One\n\n${prose(500)}\n\n## Chapter Two\n\n${prose(500)}`;
    expect(detectChapters(text).map((c) => c.heading)).toEqual(["Chapter One", "Chapter Two"]);
  });

  it("accepts a bare numeral that does stand alone", () => {
    const text = `1\n\n${prose(500)}\n\n2\n\n${prose(500)}`;
    expect(detectChapters(text).map((c) => c.ordinal)).toEqual([1, 2]);
  });

  it("drops a contents block whose entries carry almost no text", () => {
    const contents = ["Chapter 1", "Chapter 2", "Chapter 3"].join("\n\n");
    const body = [1, 2, 3].map((n) => `Chapter ${n}\n\n${prose(600)}`).join("\n\n");
    const chapters = detectChapters(`CONTENTS\n\n${contents}\n\n${body}`);
    expect(chapters).toHaveLength(3);
    expect(chapters.every((c) => c.wordCount > 500)).toBe(true);
  });
});

describe("detectChapters — real manuscripts", () => {
  it("finds exactly the 61 chapters of Pride and Prejudice", () => {
    const chapters = detectChapters(load("pride-and-prejudice.txt"));
    expect(chapters).toHaveLength(61);
    expect(chapters.map((c) => c.ordinal)).toEqual(Array.from({ length: 61 }, (_, i) => i + 1));
  });

  it("handles the inconsistent casing and stray bracket of P&P's first heading", () => {
    const chapters = detectChapters(load("pride-and-prejudice.txt"));
    expect(chapters[0]!.heading).toMatch(/^Chapter I\./i);
    expect(chapters[1]!.heading).toBe("CHAPTER II.");
  });

  it("rejects Huckleberry Finn's table of contents", () => {
    const text = load("huckleberry-finn.txt");

    // The raw candidate list is roughly double, because the contents block
    // repeats every heading in the book.
    const candidates = findChapterCandidates(text);
    const chapters = detectChapters(text);

    expect(candidates.length).toBeGreaterThan(chapters.length * 1.8);
    expect(chapters.length).toBeGreaterThanOrEqual(42);
    expect(chapters.length).toBeLessThanOrEqual(43);

    // No survivor may be a contents entry: every chapter has real prose.
    expect(chapters.every((c) => c.wordCount >= 250)).toBe(true);
  });

  it("covers the whole manuscript with no gaps or overlaps", () => {
    for (const name of ["pride-and-prejudice.txt", "huckleberry-finn.txt"]) {
      const text = load(name);
      const chapters = detectChapters(text);
      for (let i = 0; i < chapters.length - 1; i++) {
        expect(chapters[i]!.end).toBe(chapters[i + 1]!.start);
      }
      expect(chapters[chapters.length - 1]!.end).toBe(text.length);
    }
  });

  it("accounts for most of the book's words", () => {
    const text = load("pride-and-prejudice.txt");
    const chapters = detectChapters(text);
    const inChapters = chapters.reduce((sum, c) => sum + c.wordCount, 0);
    // The remainder is front matter above chapter one.
    expect(inChapters).toBeGreaterThan(115_000);
  });
});

describe("detectScenes", () => {
  /** Scenes below ~50 words are merged away, so test passages must clear that. */
  const passage = (label: string) =>
    `${label} ` + Array.from({ length: 70 }, (_, i) => `word${i}`).join(" ") + ".";

  it("returns a single scene when the chapter has no breaks", () => {
    const scenes = detectScenes(`${passage("A")}\n\n${passage("B")}`);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]!.breakKind).toBe("chapter-start");
  });

  it("splits on a glyph separator", () => {
    const scenes = detectScenes(`${passage("A")}\n\n* * *\n\n${passage("B")}`);
    expect(scenes).toHaveLength(2);
    expect(scenes[1]!.breakKind).toBe("separator");
  });

  it("accepts several separator styles", () => {
    for (const sep of ["***", "* * *", "---", "###", "⁂", "· · ·"]) {
      const scenes = detectScenes(`${passage("A")}\n\n${sep}\n\n${passage("B")}`);
      expect(scenes, `separator ${sep}`).toHaveLength(2);
    }
  });

  it("does not treat a lone hyphen as a break", () => {
    expect(detectScenes(`${passage("A")}\n\n-\n\n${passage("B")}`)).toHaveLength(1);
  });

  it("ignores blank-line runs by default", () => {
    // Blank runs appear around inset letters and other block quotes, where no
    // scene break was intended. Opt-in only.
    expect(detectScenes(`${passage("A")}\n\n\n${passage("B")}`)).toHaveLength(1);
  });

  it("uses blank-line runs when asked, and only without a glyph present", () => {
    const withRun = detectScenes(`${passage("A")}\n\n\n${passage("B")}`, 0, undefined, {
      useBlankRuns: true,
    });
    expect(withRun).toHaveLength(2);
    expect(withRun[1]!.breakKind).toBe("blank-run");

    // A chapter that uses glyphs ignores its blank runs, which are usually just
    // spacing around the glyph itself.
    const withBoth = detectScenes(
      `${passage("A")}\n\n\n${passage("B")}\n\n* * *\n\n${passage("C")}`,
      0,
      undefined,
      { useBlankRuns: true },
    );
    expect(withBoth).toHaveLength(2);
  });

  it("does not invent a scene break around an inset letter", () => {
    // The exact shape that broke this: a block-quoted letter, extra spacing,
    // then the narrative resuming. One continuous scene.
    const text = [
      passage("Elizabeth read on"),
      "     Good-bye. Give my love to Colonel Forster.",
      "“Your affectionate friend,",
      "“LYDIA BENNET.”",
      "",
      passage("Oh, thoughtless Lydia, cried Elizabeth"),
    ].join("\n\n");
    expect(detectScenes(text)).toHaveLength(1);
  });

  it("merges fragments too small to be a scene", () => {
    // A heading and an illustration line sit between blank lines and look
    // exactly like breaks. They must not become scenes of their own.
    const text = `Chapter I.]\n\n\n[Illustration]\n\n\n${passage("Real prose")}`;
    const scenes = detectScenes(text);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]!.start).toBe(0);
    expect(scenes[0]!.end).toBe(text.length);
  });

  it("covers the range with no gaps", () => {
    const text = `${passage("A")}\n\n* * *\n\n${passage("B")}\n\n***\n\n${passage("C")}`;
    const scenes = detectScenes(text);
    expect(scenes[0]!.start).toBe(0);
    expect(scenes[scenes.length - 1]!.end).toBe(text.length);
    for (let i = 0; i < scenes.length - 1; i++) {
      expect(scenes[i]!.end).toBe(scenes[i + 1]!.start);
    }
  });

  it("gives Pride and Prejudice one scene per chapter — it has no scene breaks", () => {
    const text = load("pride-and-prejudice.txt");
    const chapters = detectChapters(text);
    const sceneCounts = chapters.map((c) => detectScenes(text, c.start, c.end).length);
    expect(Math.max(...sceneCounts)).toBe(1);
  });
});

describe("splitParagraphs", () => {
  it("joins wrapped lines into one paragraph", () => {
    const paragraphs = splitParagraphs("This sentence is\nwrapped across lines.\n\nSecond.");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]!.text).toBe("This sentence is wrapped across lines.");
  });

  it("flags Gutenberg editorial inserts so they can be excluded later", () => {
    const paragraphs = splitParagraphs("[Illustration: A drawing]\n\nReal prose here.");
    expect(paragraphs[0]!.isEditorialArtifact).toBe(true);
    expect(paragraphs[1]!.isEditorialArtifact).toBe(false);
  });

  it("finds the opening line of Pride and Prejudice in chapter one", () => {
    const text = load("pride-and-prejudice.txt");
    const first = detectChapters(text)[0]!;
    const paragraphs = splitParagraphs(text, first.start, first.end).filter((p) => !p.isEditorialArtifact);
    expect(paragraphs.some((p) => p.text.startsWith("It is a truth universally acknowledged"))).toBe(true);
  });
});
