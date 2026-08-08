import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Chapter } from "@bp/schema";
import { api, RequestError } from "../api";

/**
 * Shows the opening and closing lines of a chapter.
 *
 * Boundary mistakes surface at the edges — a heading swallowed into the chapter
 * above, or front matter clinging to chapter one — so the two ends are what you
 * need to see. The middle is never in question.
 */
function ChapterPreview({ projectId, chapterId }: { projectId: string; chapterId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["chapter", projectId, chapterId],
    queryFn: () => api.getChapter(projectId, chapterId),
  });

  if (isLoading) {
    return <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>Loading…</p>;
  }

  const prose = (data?.paragraphs ?? []).filter((p) => !p.isEditorialArtifact);
  if (prose.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--warn)" }}>
        This chapter has no prose in it — it is probably a heading that should be merged upward.
      </p>
    );
  }

  const opening = prose.slice(0, 3);
  const closing = prose.length > 4 ? prose.slice(-1) : [];

  return (
    <div style={{ fontFamily: "var(--serif)", fontSize: 15, lineHeight: 1.66, color: "var(--ink-2)" }}>
      {opening.map((paragraph) => (
        <p key={paragraph.start} style={{ margin: "0 0 0.7em" }}>
          {paragraph.text.length > 320 ? `${paragraph.text.slice(0, 320)}…` : paragraph.text}
        </p>
      ))}

      {closing.length > 0 && (
        <>
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 10.5,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--muted)",
              margin: "14px 0 8px",
            }}
          >
            ends
          </div>
          {closing.map((paragraph) => (
            <p key={paragraph.start} style={{ margin: 0 }}>
              {paragraph.text.length > 320 ? `…${paragraph.text.slice(-320)}` : paragraph.text}
            </p>
          ))}
        </>
      )}

      <div style={{ fontFamily: "var(--sans)", fontSize: 11.5, color: "var(--muted)", marginTop: 12 }}>
        {prose.length} paragraph{prose.length === 1 ? "" : "s"}
      </div>
    </div>
  );
}

/**
 * The structure-confirmation step. Detection is good but never perfect, and
 * every measurement later depends on these boundaries — so the author gets to
 * see exactly what was found and fix it before anything is built on top.
 */
export function StructureReview({
  projectId,
  chapters,
  wordCount,
}: {
  projectId: string;
  chapters: Chapter[];
  wordCount: number;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftHeading, setDraftHeading] = useState("");
  /** Which chapter is open for inspection. Only one at a time. */
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = () => void queryClient.invalidateQueries();
  const onError = (e: unknown) =>
    setError(e instanceof RequestError ? e.message : "That change didn’t go through.");

  const edit = useMutation({ mutationFn: (v: Parameters<typeof api.editStructure>[1]) => api.editStructure(projectId, v), onSuccess: refresh, onError });
  const redetect = useMutation({ mutationFn: () => api.redetectStructure(projectId), onSuccess: refresh, onError });
  const confirm = useMutation({ mutationFn: () => api.confirmStructure(projectId), onSuccess: refresh, onError });

  const shortest = chapters.reduce((min, c) => Math.min(min, c.wordCount), Infinity);
  const suspicious = chapters.filter((c) => c.wordCount < 300);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <span className="eyebrow">Step 2 · check the split</span>
        <h2 style={{ fontFamily: "var(--serif)", fontSize: 22 }}>
          Found {chapters.length} chapter{chapters.length === 1 ? "" : "s"} in{" "}
          <span className="num">{wordCount.toLocaleString()}</span> words
        </h2>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5, maxWidth: "64ch", lineHeight: 1.6 }}>
          Everything measured later hangs off these boundaries, so it’s worth a look now. Merge a
          heading that isn’t really a chapter, or rename one that came through oddly.
        </p>
      </div>

      {suspicious.length > 0 && (
        <p
          style={{
            margin: 0,
            padding: "10px 12px",
            borderRadius: "var(--radius-sm)",
            background: "var(--warn-bg)",
            color: "var(--warn)",
            fontSize: 12.5,
          }}
        >
          {suspicious.length} chapter{suspicious.length === 1 ? " is" : "s are"} unusually short
          (under 300 words). {suspicious.length === 1 ? "It" : "They"} may be front matter that
          should be merged.
        </p>
      )}

      {error && <p className="banner">{error}</p>}

      <div className="card" style={{ overflow: "hidden" }}>
        {chapters.map((chapter, i) => {
          const isShort = chapter.wordCount < 300;
          const isOpen = expandedId === chapter.id;
          return (
            <div key={chapter.id}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "34px 1fr auto",
                gap: 12,
                alignItems: "center",
                padding: "11px 16px",
                borderTop: i === 0 ? "none" : "1px solid var(--rule)",
                background: isOpen ? "var(--accent-sub)" : isShort ? "var(--warn-bg)" : undefined,
              }}
            >
              <span className="num" style={{ color: "var(--muted)", fontSize: 12 }}>
                {chapter.index + 1}
              </span>

              <div style={{ minWidth: 0 }}>
                {renaming === chapter.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      edit.mutate({ op: "rename", chapterId: chapter.id, heading: draftHeading });
                      setRenaming(null);
                    }}
                    style={{ display: "flex", gap: 8 }}
                  >
                    <input
                      autoFocus
                      value={draftHeading}
                      onChange={(e) => setDraftHeading(e.target.value)}
                      onBlur={() => setRenaming(null)}
                      style={{
                        font: "inherit",
                        flex: 1,
                        padding: "5px 8px",
                        borderRadius: 5,
                        border: "1px solid var(--accent)",
                        background: "var(--panel)",
                        color: "var(--ink)",
                      }}
                    />
                  </form>
                ) : (
                  <button
                    onClick={() => setExpandedId(isOpen ? null : chapter.id)}
                    aria-expanded={isOpen}
                    title={isOpen ? "Hide the text" : "Show the start and end of this chapter"}
                    style={{
                      background: "none",
                      border: 0,
                      padding: 0,
                      textAlign: "left",
                      fontFamily: "var(--serif)",
                      fontSize: 15.5,
                      color: isOpen ? "var(--accent)" : "var(--ink)",
                      display: "flex",
                      alignItems: "baseline",
                      gap: 7,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        fontFamily: "var(--sans)",
                        fontSize: 9,
                        color: "var(--muted)",
                        transform: isOpen ? "rotate(90deg)" : "none",
                        display: "inline-block",
                        transition: "transform .12s",
                      }}
                    >
                      ▶
                    </span>
                    {chapter.heading}
                  </button>
                )}
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                  <span className="num">{chapter.wordCount.toLocaleString()}</span> words ·{" "}
                  {chapter.scenes.length} scene{chapter.scenes.length === 1 ? "" : "s"}
                </div>
              </div>

              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="btn"
                  style={{ padding: "4px 9px", fontSize: 11.5 }}
                  onClick={() => {
                    setRenaming(chapter.id);
                    setDraftHeading(chapter.heading);
                  }}
                >
                  Rename
                </button>
                <button
                  className="btn"
                  style={{ padding: "4px 9px", fontSize: 11.5 }}
                  disabled={chapter.index === 0 || edit.isPending}
                  title={chapter.index === 0 ? "Nothing before it to merge into" : "Fold into the chapter above"}
                  onClick={() => edit.mutate({ op: "mergeWithPrevious", chapterId: chapter.id })}
                >
                  Merge up
                </button>
              </div>
            </div>

            {isOpen && (
              <div
                style={{
                  padding: "4px 16px 18px 62px",
                  background: "var(--accent-sub)",
                  borderBottom: "1px solid var(--rule)",
                }}
              >
                <ChapterPreview projectId={projectId} chapterId={chapter.id} />
              </div>
            )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          className="btn btn-primary"
          onClick={() => confirm.mutate()}
          disabled={confirm.isPending || chapters.length === 0}
        >
          {confirm.isPending ? "Saving…" : "Looks right — continue"}
        </button>
        <button className="btn" onClick={() => redetect.mutate()} disabled={redetect.isPending}>
          {redetect.isPending ? "Re-reading…" : "Start over from the file"}
        </button>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
          Shortest chapter: <span className="num">{Number.isFinite(shortest) ? shortest.toLocaleString() : 0}</span> words
        </span>
      </div>
    </div>
  );
}
