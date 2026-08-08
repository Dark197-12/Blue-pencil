import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { normalizeText, stripGutenbergBoilerplate } from "./normalize.js";
import { detectChapters } from "./structure.js";
import { extractDialogue } from "./dialogue.js";
import { buildCast } from "./characters.js";
import { genderOfPronoun, inferGenders } from "./gender.js";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name: string) =>
  normalizeText(stripGutenbergBoilerplate(readFileSync(join(here, "../../../fixtures", name), "utf8")));

const member = (name: string, aliases: string[] = [name]) => ({ name, aliases });

describe("genderOfPronoun", () => {
  it("reads the gendered pronouns", () => {
    expect(genderOfPronoun("she")).toBe("female");
    expect(genderOfPronoun("He")).toBe("male");
    expect(genderOfPronoun("her")).toBe("female");
  });

  it("returns null for anything else", () => {
    expect(genderOfPronoun("they")).toBeNull();
    expect(genderOfPronoun("I")).toBeNull();
    expect(genderOfPronoun("Elizabeth")).toBeNull();
  });
});

describe("inferGenders", () => {
  it("takes a gendered title as decisive", () => {
    const result = inferGenders("Mrs. Bennet did nothing at all.", [member("Mrs. Bennet")]);
    expect(result.get("Mrs. Bennet")).toMatchObject({ gender: "female", source: "title" });
  });

  it("finds a title used only in the narration", () => {
    // The speech tag says "Darcy"; the prose says "Mr. Darcy".
    const text = "Mr. Darcy bowed. Mr. Darcy left. Mr. Darcy returned. Darcy said nothing.";
    const result = inferGenders(text, [member("Darcy")]);
    expect(result.get("Darcy")).toMatchObject({ gender: "male", source: "title" });
  });

  it("falls back to the pronoun that follows the name", () => {
    const text = [
      "Elizabeth walked on, and she was glad of it.",
      "Elizabeth turned, and she smiled.",
      "Elizabeth waited, and she said nothing.",
      "Elizabeth left, and she did not look back.",
    ].join(" ");
    expect(inferGenders(text, [member("Elizabeth")])).toMatchObject(
      new Map([["Elizabeth", expect.objectContaining({ gender: "female", source: "narration" })]]),
    );
  });

  it("ignores a pronoun that belongs to someone named in between", () => {
    // "she" is Elizabeth's, not Darcy's — counting it would call Darcy female.
    const text = [
      "Darcy bowed to Elizabeth, and she coloured.",
      "Darcy spoke to Elizabeth, and she turned away.",
      "Darcy watched Elizabeth, and she laughed.",
    ].join(" ");
    const result = inferGenders(text, [member("Darcy"), member("Elizabeth")]);
    // No usable evidence for Darcy at all, so it declines to guess.
    expect(result.get("Darcy")!.gender).toBeNull();
  });

  it("refuses to guess without enough evidence", () => {
    const result = inferGenders("Wickham arrived, and he left.", [member("Wickham")]);
    expect(result.get("Wickham")!.gender).toBeNull();
  });

  it("refuses when the evidence is split", () => {
    const text = [
      "Ash spoke, and he waited.",
      "Ash spoke, and she waited.",
      "Ash spoke, and he waited.",
      "Ash spoke, and she waited.",
    ].join(" ");
    expect(inferGenders(text, [member("Ash")]).get("Ash")!.gender).toBeNull();
  });
});

describe("inferGenders — Pride and Prejudice", () => {
  const text = load("pride-and-prejudice.txt");
  const chapters = detectChapters(text);
  const lines = chapters.flatMap((c) => extractDialogue(text.slice(c.start, c.end), { offset: c.start }));
  const cast = buildCast(lines);
  const genders = inferGenders(text, cast.members);

  /** Checked by hand against the novel. */
  const truth: Record<string, "male" | "female"> = {
    Elizabeth: "female", Jane: "female", "Mrs. Bennet": "female", Darcy: "male",
    "Mr. Collins": "male", Charlotte: "female", Wickham: "male", "Mr. Bennet": "male",
    "Miss Bingley": "female", Mary: "female", Lydia: "female", Kitty: "female",
    "Lady Catherine": "female", "Colonel Fitzwilliam": "male", "Mr. Gardiner": "male",
    "Mrs. Gardiner": "female",
  };

  it("never assigns the wrong gender", () => {
    // Precision is what matters: a wrong gender sends a pronoun line to the
    // wrong character, which is worse than leaving it unresolved.
    const wrong = Object.entries(truth).filter(([name, expected]) => {
      const inferred = genders.get(name)?.gender;
      return inferred !== undefined && inferred !== null && inferred !== expected;
    });
    expect(wrong).toEqual([]);
  });

  it("resolves the great majority of the cast", () => {
    const known = cast.members.filter((m) => genders.get(m.name)?.gender !== null);
    expect(known.length / cast.members.length).toBeGreaterThan(0.85);
  });

  it("leaves an ambiguous shared surname unresolved", () => {
    // Both "Mr. Bingley" and "Miss Bingley" appear, so the bare surname is
    // genuinely undecidable — the same trap that keeps them separate characters.
    expect(genders.get("Bingley")?.gender).toBeNull();
  });
});
