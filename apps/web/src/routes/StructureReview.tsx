import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Chapter } from "@bp/schema";
import { api, RequestError } from "../api";

/**
 * The structure-confirmation step. Detection is good but never perfect, and
 * every measurement later depends on these boundaries — so the author gets to
 * see exactly what was found and fix it before anything is built on top.
 */
export function StructureReview({
  projectId,
  chapters,
  wordCount,
  onOpenChapter,
}: {
  projectId: string;
  chapters: Chapter[];
  wordCount: number;
  onOpenChapter: (chapterId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftHeading, setDraftHeading] = useState("");

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
          return (
            <div
              key={chapter.id}
              style={{
                display: "grid",
                gridTemplateColumns: "34px 1fr auto",
                gap: 12,
                alignItems: "center",
                padding: "11px 16px",
                borderTop: i === 0 ? "none" : "1px solid var(--rule)",
                background: isShort ? "var(--warn-bg)" : undefined,
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
                    onClick={() => onOpenChapter(chapter.id)}
                    style={{
                      background: "none",
                      border: 0,
                      padding: 0,
                      textAlign: "left",
                      fontFamily: "var(--serif)",
                      fontSize: 15.5,
                      color: "var(--ink)",
                    }}
                  >
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
