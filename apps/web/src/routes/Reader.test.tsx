import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DialogueLine, Paragraph } from "@bp/schema";

import { renderWithSpeakers } from "./Reader";

/**
 * Dialogue spans are stored as absolute offsets into the whole manuscript,
 * while each paragraph is rendered from its own slice. Every case here is about
 * that translation: get it wrong and the highlight lands on the wrong words,
 * which is worse than no highlight at all because it misreports who spoke.
 */

const paragraph = (text: string, start: number): Paragraph => ({
  start,
  end: start + text.length,
  text,
  isEditorialArtifact: false,
  sceneIndex: 0,
});

const line = (
  start: number,
  end: number,
  speaker: string | null,
  raw: string | null = null,
): DialogueLine =>
  ({
    id: `l${start}`,
    startOffset: start,
    endOffset: end,
    segments: [{ start, end }],
    text: "",
    wordCount: 0,
    speakerRaw: raw,
    speakerKind: raw ? "name" : null,
    method: speaker ? "tag" : null,
    confidence: speaker ? 1 : null,
    character: speaker ? { id: speaker, name: speaker } : null,
  }) as unknown as DialogueLine;

/** Renders the result and returns the visible text. */
function textOf(node: React.ReactNode): string {
  const { container } = render(<div>{node}</div>);
  return container.textContent ?? "";
}

describe("renderWithSpeakers", () => {
  it("returns the paragraph untouched when it holds no dialogue", () => {
    const p = paragraph("He said nothing at all.", 100);
    expect(renderWithSpeakers(p, [])).toBe(p.text);
  });

  it("highlights the quoted span and names the speaker", () => {
    // Paragraph starts at 1000; the quote occupies its first eight characters.
    const p = paragraph("“Go away,” she said.", 1000);
    render(<div>{renderWithSpeakers(p, [line(1000, 1011, "Ada")])}</div>);

    expect(screen.getByTitle("Ada").textContent).toContain("“Go away,”");
  });

  it("keeps every character of the paragraph, marked or not", () => {
    // The reader must never silently drop prose while highlighting.
    const p = paragraph("“Go away,” she said, and turned.", 1000);
    expect(textOf(renderWithSpeakers(p, [line(1000, 1011, "Ada")]))).toContain("and turned.");
  });

  it("translates absolute offsets into the paragraph's own coordinates", () => {
    // A span at 5040 in a paragraph starting at 5000 is at index 40 locally.
    const prose = `${"x".repeat(40)}“Here I am,” said Bram.`;
    const p = paragraph(prose, 5000);
    render(<div>{renderWithSpeakers(p, [line(5040, 5052, "Bram")])}</div>);
    expect(screen.getByTitle("Bram").textContent).toContain("“Here I am,”");
  });

  it("ignores a span belonging to a different paragraph", () => {
    const p = paragraph("Nothing is spoken here.", 200);
    // The span sits well beyond this paragraph's range.
    expect(renderWithSpeakers(p, [line(9000, 9010, "Ada")])).toBe(p.text);
  });

  it("marks an unattributed quote without claiming a speaker", () => {
    const p = paragraph("“Who is there?”", 300);
    render(<div>{renderWithSpeakers(p, [line(300, 315, null)])}</div>);
    expect(screen.getByTitle("Speaker unknown")).toBeTruthy();
  });

  it("says a tagged name is unresolved rather than showing it as the speaker", () => {
    // The prose named somebody who never made it into the cast.
    const p = paragraph("“Who is there?”", 300);
    render(<div>{renderWithSpeakers(p, [line(300, 315, null, "Lane")])}</div>);
    expect(screen.getByTitle(/Lane/)).toBeTruthy();
  });

  it("renders two speakers in one paragraph in reading order", () => {
    const prose = "“Yes,” said Ada. “No,” said Bram.";
    const p = paragraph(prose, 0);
    render(
      <div>
        {renderWithSpeakers(p, [line(16, 21, "Bram"), line(0, 6, "Ada")])}
      </div>,
    );

    const ada = screen.getByTitle("Ada");
    const bram = screen.getByTitle("Bram");
    // Ada's span precedes Bram's in the document, whatever order they arrived.
    expect(ada.compareDocumentPosition(bram) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("drops a span that overlaps one already rendered", () => {
    // Overlapping slices would duplicate text; the second is skipped.
    const p = paragraph("“Yes, quite so,” she said.", 0);
    const rendered = textOf(renderWithSpeakers(p, [line(0, 16, "Ada"), line(5, 12, "Bram")]));
    expect(rendered).toContain("she said.");
    expect(rendered.match(/quite so/g)).toHaveLength(1);
  });

  it("clamps a span that runs past the end of the paragraph", () => {
    // Speech continuing into the next paragraph must not slice beyond this one.
    const p = paragraph("“It goes on", 0);
    expect(() => textOf(renderWithSpeakers(p, [line(0, 400, "Ada")]))).not.toThrow();
    expect(textOf(renderWithSpeakers(p, [line(0, 400, "Ada")]))).toContain("“It goes on");
  });
});
