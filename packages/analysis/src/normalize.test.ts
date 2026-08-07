import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  countWords,
  normalizeText,
  readGutenbergMeta,
  stripGutenbergBoilerplate,
} from "./normalize.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, "../../../fixtures", name), "utf8");

describe("normalizeText", () => {
  it("converts CRLF and lone CR to LF", () => {
    expect(normalizeText("a\r\nb\rc")).toBe("a\nb\nc\n");
  });

  it("strips a byte-order mark", () => {
    expect(normalizeText("﻿Hello")).toBe("Hello\n");
  });

  it("folds non-breaking and exotic spaces to a plain space", () => {
    expect(normalizeText("a b c　d")).toBe("a b c d\n");
  });

  it("keeps curly quotes, em dashes and ellipses — they are measured later", () => {
    const line = "“I don’t — that is…” she said.";
    expect(normalizeText(line)).toBe(line + "\n");
  });

  it("folds guillemets and low quotes onto canonical curly quotes", () => {
    expect(normalizeText("«Bonjour»")).toBe("“Bonjour”\n");
  });

  it("removes trailing spaces so blank-line detection is reliable", () => {
    expect(normalizeText("one   \n   \ntwo")).toBe("one\n\ntwo\n");
  });

  it("collapses runs of four or more newlines to three", () => {
    expect(normalizeText("a\n\n\n\n\n\nb")).toBe("a\n\n\nb\n");
  });

  it("is idempotent", () => {
    const once = normalizeText("“Hi there”\r\n\r\n\r\n\r\nBye  ");
    expect(normalizeText(once)).toBe(once);
  });
});

describe("countWords", () => {
  it("counts hyphenated and apostrophised words as one word each", () => {
    expect(countWords("It’s a well-worn path.")).toBe(4);
  });

  it("ignores standalone punctuation", () => {
    expect(countWords("Yes — no … maybe?")).toBe(3);
  });

  it("counts nothing in an empty string", () => {
    expect(countWords("   \n  ")).toBe(0);
  });
});

describe("Gutenberg fixtures", () => {
  const raw = fixture("pride-and-prejudice.txt");

  it("reads title and author from the header", () => {
    const meta = readGutenbergMeta(raw);
    expect(meta.title).toBe("Pride and Prejudice");
    expect(meta.author).toBe("Jane Austen");
  });

  it("strips the licence header and footer", () => {
    const body = stripGutenbergBoilerplate(raw);
    expect(body).not.toMatch(/PROJECT GUTENBERG EBOOK/i);
    expect(body).not.toMatch(/gutenberg\.org\/license/i);
    // The novel itself survives, opening line intact.
    expect(body).toMatch(/It is a truth universally acknowledged/);
  });

  it("leaves the bulk of the text alone", () => {
    const body = stripGutenbergBoilerplate(raw);
    // Boilerplate is a small fraction; we should keep well over 90%.
    expect(body.length / raw.length).toBeGreaterThan(0.9);
    expect(countWords(body)).toBeGreaterThan(120_000);
  });

  it("handles all three fixtures without throwing", () => {
    for (const name of [
      "pride-and-prejudice.txt",
      "importance-of-being-earnest.txt",
      "huckleberry-finn.txt",
    ]) {
      const body = normalizeText(stripGutenbergBoilerplate(fixture(name)));
      expect(countWords(body)).toBeGreaterThan(10_000);
      expect(body).not.toMatch(/\r/);
    }
  });
});
