import { Fragment, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Chapter, DialogueLine, Paragraph } from "@bp/schema";
import { api } from "../api";

/**
 * Marks the quoted spans inside a paragraph, tagging each with its speaker when
 * one is known. Offsets are absolute into the manuscript, so a span is sliced
 * relative to the paragraph it falls in.
 */
function renderWithSpeakers(paragraph: Paragraph, dialogue: DialogueLine[]): ReactNode {
  const spans = dialogue
    .flatMap((line) =>
      line.segments.map((segment) => ({
        start: segment.start,
        end: segment.end,
        speaker: line.character?.name ?? null,
        raw: line.speakerRaw,
        kind: line.speakerKind,
      })),
    )
    .filter((span) => span.start >= paragraph.start && span.start < paragraph.end)
    .sort((a, b) => a.start - b.start);

  if (spans.length === 0) return paragraph.text;

  // paragraph.text has had its newlines collapsed to spaces, so it stays the
  // same length as the source slice and offsets still line up.
  const offset = paragraph.start;
  const pieces: ReactNode[] = [];
  let cursor = 0;

  spans.forEach((span, i) => {
    const from = Math.max(0, span.start - offset);
    const to = Math.min(paragraph.text.length, span.end - offset);
    if (from < cursor || to <= from) return;

    if (from > cursor) pieces.push(<Fragment key={`t${i}`}>{paragraph.text.slice(cursor, from)}</Fragment>);

    pieces.push(
      <span
        key={`d${i}`}
        title={span.speaker ?? (span.raw ? `Tagged “${span.raw}” — not yet resolved` : "Speaker unknown")}
        style={{
          background: span.speaker ? "var(--accent-sub)" : "transparent",
          borderBottom: span.speaker ? "none" : "1px dotted var(--rule-2)",
          borderRadius: 2,
          padding: span.speaker ? "0 1px" : undefined,
        }}
      >
        {paragraph.text.slice(from, to)}
        {span.speaker && (
          <span
            style={{
              fontFamily: "var(--sans)",
              fontSize: 9.5,
              letterSpacing: "0.04em",
              color: "var(--accent)",
              verticalAlign: "2px",
              marginLeft: 4,
              whiteSpace: "nowrap",
            }}
          >
            {span.speaker}
          </span>
        )}
      </span>,
    );
    cursor = to;
  });

  if (cursor < paragraph.text.length) pieces.push(<Fragment key="tail">{paragraph.text.slice(cursor)}</Fragment>);
  return pieces;
}

/**
 * The manuscript reader — the surface Phase 6 hangs flags off. It is
 * deliberately a book, not a data view: serif, a comfortable measure, indented
 * paragraphs. If this pane reads like a code editor, writers won't stay in it.
 */
export function Reader({
  projectId,
  chapters,
  selectedChapterId,
  onSelectChapter,
}: {
  projectId: string;
  chapters: Chapter[];
  selectedChapterId: string;
  onSelectChapter: (id: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["chapter", projectId, selectedChapterId],
    queryFn: () => api.getChapter(projectId, selectedChapterId),
    enabled: Boolean(selectedChapterId),
  });

  const dialogueQuery = useQuery({
    queryKey: ["chapter-dialogue", projectId, selectedChapterId],
    queryFn: () => api.getChapterDialogue(projectId, selectedChapterId),
    enabled: Boolean(selectedChapterId),
  });

  const paragraphs = data?.paragraphs ?? [];
  const dialogue = dialogueQuery.data?.lines ?? [];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "232px minmax(0, 1fr)",
        border: "1px solid var(--rule)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
        background: "var(--panel)",
        minHeight: 520,
      }}
    >
      <nav
        style={{
          borderRight: "1px solid var(--rule)",
          padding: "14px 8px",
          maxHeight: "72vh",
          overflowY: "auto",
        }}
      >
        <div style={{ padding: "0 8px 8px" }}>
          <span className="eyebrow">Chapters</span>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {chapters.map((chapter) => {
            const active = chapter.id === selectedChapterId;
            return (
              <li key={chapter.id}>
                <button
                  onClick={() => onSelectChapter(chapter.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    background: active ? "var(--accent-sub)" : "none",
                    color: active ? "var(--accent)" : "var(--ink-2)",
                    fontWeight: active ? 600 : 400,
                    border: 0,
                    borderRadius: 5,
                    padding: "6px 8px",
                    fontSize: 13,
                    display: "flex",
                    gap: 8,
                    alignItems: "baseline",
                  }}
                >
                  <span className="num" style={{ fontSize: 11, opacity: 0.7, flex: "none" }}>
                    {chapter.index + 1}
                  </span>
                  <span
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {chapter.heading}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div style={{ padding: "36px 0 72px", maxHeight: "72vh", overflowY: "auto", background: "var(--paper)" }}>
        <article style={{ maxWidth: 620, margin: "0 auto", padding: "0 32px" }}>
          {isLoading ? (
            <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</p>
          ) : (
            <>
              <h2
                style={{
                  fontFamily: "var(--serif)",
                  fontSize: 15,
                  fontWeight: 500,
                  fontStyle: "italic",
                  color: "var(--muted)",
                  marginBottom: 26,
                  letterSpacing: 0,
                }}
              >
                {data?.chapter.heading}
              </h2>

              <div style={{ fontFamily: "var(--serif)", fontSize: 17.5, lineHeight: 1.72, color: "var(--ink)" }}>
                {paragraphs.map((paragraph, i) => {
                  const previous = paragraphs[i - 1];
                  const startsScene = previous !== undefined && paragraph.sceneIndex !== previous.sceneIndex;

                  return (
                    <div key={paragraph.start}>
                      {startsScene && (
                        <div
                          aria-label="Scene break"
                          style={{
                            textAlign: "center",
                            color: "var(--muted)",
                            letterSpacing: "0.5em",
                            margin: "1.4em 0",
                            fontSize: 13,
                          }}
                        >
                          ***
                        </div>
                      )}
                      <p
                        style={{
                          margin: "0 0 0.85em",
                          textIndent: i === 0 || startsScene ? 0 : "1.4em",
                          // Gutenberg editorial inserts are not the author's prose;
                          // shown, but visibly set apart from it.
                          color: paragraph.isEditorialArtifact ? "var(--muted)" : undefined,
                          fontStyle: paragraph.isEditorialArtifact ? "italic" : undefined,
                          fontSize: paragraph.isEditorialArtifact ? "0.85em" : undefined,
                        }}
                      >
                        {renderWithSpeakers(paragraph, dialogue)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </article>
      </div>
    </div>
  );
}
