import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { normalizeText, stripGutenbergBoilerplate } from "./normalize.js";
import { extractDialogue } from "./dialogue.js";
import { buildCast, compareNames } from "./characters.js";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name: string) =>
  normalizeText(stripGutenbergBoilerplate(readFileSync(join(here, "../../../fixtures", name), "utf8")));

describe("compareNames", () => {
  it("matches identical names regardless of trailing punctuation", () => {
    expect(compareNames("Elizabeth", "Elizabeth")).toBe("same");
    expect(compareNames("Mr. Bennet", "Mr Bennet")).toBe("same");
  });

  it("matches a given name against its fuller form", () => {
    expect(compareNames("Elizabeth", "Elizabeth Bennet")).toBe("same");
  });

  it("keeps the Bennets apart", () => {
    // The trap: a surname-keyed rule fuses a whole family into one character
    // and every voice measurement built on it becomes meaningless.
    expect(compareNames("Mr. Bennet", "Mrs. Bennet")).toBe("different");
    expect(compareNames("Miss Bennet", "Mrs. Bennet")).toBe("different");
    expect(compareNames("Mr. Bennet", "Miss Bennet")).toBe("different");
  });

  it("does not merge a titled name with a bare surname on its own", () => {
    // "Miss Bingley" is Caroline; "Bingley" is her brother Charles.
    expect(compareNames("Miss Bingley", "Bingley")).not.toBe("same");
  });

  it("offers a surname-only overlap as a suggestion rather than a merge", () => {
    expect(compareNames("Mr. Bennet", "Bennet")).toBe("maybe");
    expect(compareNames("Elizabeth Bennet", "Bennet")).toBe("maybe");
  });

  it("treats unrelated names as different", () => {
    expect(compareNames("Elizabeth", "Darcy")).toBe("different");
  });
});

describe("buildCast", () => {
  const line = (text: string, raw: string) => ({
    segments: [{ start: 0, end: text.length }],
    start: 0,
    end: text.length,
    text,
    tag: { raw, kind: "name" as const, verb: "said", position: "after" as const },
  });

  it("rejects speakers tagged only once", () => {
    const cast = buildCast([line("Hello there friend", "Elizabeth"), line("Hi", "By-and-by")]);
    expect(cast.members).toHaveLength(0);
    expect(cast.rejected.map((r) => r.name)).toContain("By-and-by");
  });

  it("rejects indefinite pronouns however often they appear", () => {
    const lines = Array.from({ length: 8 }, () => line("Something was said", "Everybody"));
    const cast = buildCast(lines);
    expect(cast.members).toHaveLength(0);
    expect(cast.rejected[0]).toMatchObject({ name: "Everybody", reason: "not a name" });
  });

  it("groups a given name with its fuller form and counts both", () => {
    const cast = buildCast([
      line("One two three", "Elizabeth"),
      line("Four five six", "Elizabeth"),
      line("Seven eight nine", "Elizabeth Bennet"),
      line("Ten eleven twelve", "Elizabeth Bennet"),
    ]);
    expect(cast.members).toHaveLength(1);
    expect(cast.members[0]!.lineCount).toBe(4);
    expect(cast.members[0]!.wordCount).toBe(12);
    expect(cast.members[0]!.aliases).toEqual(expect.arrayContaining(["Elizabeth", "Elizabeth Bennet"]));
  });

  it("keeps Mr. and Mrs. Bennet as two members", () => {
    const cast = buildCast([
      line("A a a", "Mr. Bennet"),
      line("B b b", "Mr. Bennet"),
      line("C c c", "Mrs. Bennet"),
      line("D d d", "Mrs. Bennet"),
    ]);
    expect(cast.members).toHaveLength(2);
  });

  it("raises a suggestion instead of guessing on a shared surname", () => {
    const cast = buildCast([
      line("A a a", "Mr. Bennet"),
      line("B b b", "Mr. Bennet"),
      line("C c c", "Bennet"),
      line("D d d", "Bennet"),
    ]);
    expect(cast.members).toHaveLength(2);
    expect(cast.suggestions).toHaveLength(1);
    expect(cast.suggestions[0]!.names).toEqual(expect.arrayContaining(["Mr. Bennet", "Bennet"]));
  });

  it("orders members by how much they speak", () => {
    const cast = buildCast([
      line("one", "Quiet"),
      line("two", "Quiet"),
      line("a much longer speech with many words in it", "Loud"),
      line("another long speech with plenty of words here", "Loud"),
    ]);
    expect(cast.members[0]!.name).toBe("Loud");
  });
});

describe("buildCast — Pride and Prejudice", () => {
  const cast = buildCast(extractDialogue(load("pride-and-prejudice.txt")));
  const names = cast.members.map((m) => m.name);

  it("proposes the principal characters", () => {
    expect(names).toContain("Elizabeth");
    expect(names).toContain("Jane");
    expect(names).toContain("Darcy");
  });

  it("puts Elizabeth first — she speaks the most", () => {
    expect(cast.members[0]!.name).toBe("Elizabeth");
  });

  it("does not fuse the Bennet family into one character", () => {
    const bennets = names.filter((n) => /bennet/i.test(n));
    expect(bennets.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps Miss Bingley separate from Bingley", () => {
    const bingleys = cast.members.filter((m) =>
      m.aliases.some((a) => /bingley/i.test(a)),
    );
    expect(bingleys.length).toBeGreaterThanOrEqual(2);
  });

  it("filters the sentence-initial false positives out of the cast", () => {
    expect(names).not.toContain("By-and-by");
    expect(names).not.toContain("Everybody");
  });

  it("proposes a plausible cast size rather than hundreds of fragments", () => {
    expect(cast.members.length).toBeGreaterThan(5);
    expect(cast.members.length).toBeLessThan(40);
  });
});
