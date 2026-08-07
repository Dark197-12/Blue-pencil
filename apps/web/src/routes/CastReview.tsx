import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, RequestError } from "../api";

/**
 * The cast-confirmation step.
 *
 * Detection proposes; the author decides. That split matters most here, because
 * the two mistakes a name-matcher can make are not symmetrical: leaving one
 * character split in two is a nuisance, while fusing two people into one makes
 * every voice measurement built on them meaningless. So anything unprovable —
 * "Mr. Bennet" against "Bennet" — is offered rather than assumed.
 */
export function CastReview({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mergeFrom, setMergeFrom] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["cast", projectId],
    queryFn: () => api.getCast(projectId),
  });

  const refresh = () => void queryClient.invalidateQueries();
  const onError = (e: unknown) =>
    setError(e instanceof RequestError ? e.message : "That change didn’t go through.");

  const extract = useMutation({ mutationFn: () => api.extractDialogue(projectId), onSuccess: refresh, onError });
  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) => api.renameCharacter(projectId, v.id, v.name),
    onSuccess: refresh,
    onError,
  });
  const merge = useMutation({
    mutationFn: (v: { fromId: string; intoId: string }) => api.mergeCharacters(projectId, v.fromId, v.intoId),
    onSuccess: () => {
      setMergeFrom(null);
      refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (characterId: string) => api.deleteCharacter(projectId, characterId),
    onSuccess: refresh,
    onError,
  });
  const confirm = useMutation({ mutationFn: () => api.confirmCast(projectId), onSuccess: refresh, onError });

  if (isLoading) return <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</p>;

  const cast = data;
  const members = cast?.members ?? [];
  const coverage = cast && cast.totalLines > 0 ? cast.attributedLines / cast.totalLines : 0;

  if (members.length === 0) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <span className="eyebrow">Step 3 · the cast</span>
          <h2 style={{ fontFamily: "var(--serif)", fontSize: 22 }}>Find who’s speaking</h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5, maxWidth: "62ch", lineHeight: 1.6 }}>
            Blue Pencil reads every speech tag in the manuscript and proposes a cast from the names
            it finds. You confirm it before anything is measured.
          </p>
        </div>
        {error && <p className="banner">{error}</p>}
        <div>
          <button className="btn btn-primary" onClick={() => extract.mutate()} disabled={extract.isPending}>
            {extract.isPending ? "Reading the dialogue…" : "Find the cast"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <span className="eyebrow">Step 3 · the cast</span>
        <h2 style={{ fontFamily: "var(--serif)", fontSize: 22 }}>
          {members.length} character{members.length === 1 ? "" : "s"} found
        </h2>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5, maxWidth: "64ch", lineHeight: 1.6 }}>
          These come from explicit speech tags — the only place the text says outright who spoke.
          Most dialogue carries no tag at all; working out the rest comes next.
        </p>
      </div>

      <div className="card" style={{ padding: 14, display: "flex", gap: 22, flexWrap: "wrap" }}>
        <Stat label="Dialogue lines" value={cast!.totalLines.toLocaleString()} />
        <Stat label="Speaker named" value={`${cast!.attributedLines.toLocaleString()} (${Math.round(coverage * 100)}%)`} />
        <Stat label="Still unknown" value={cast!.unattributedLines.toLocaleString()} muted />
      </div>

      {error && <p className="banner">{error}</p>}

      {mergeFrom && (
        <p
          style={{
            margin: 0,
            padding: "10px 12px",
            borderRadius: "var(--radius-sm)",
            background: "var(--accent-sub)",
            color: "var(--accent)",
            fontSize: 12.5,
          }}
        >
          Merging <b>{members.find((m) => m.id === mergeFrom)?.name}</b> — now choose who they are
          the same person as.{" "}
          <button
            onClick={() => setMergeFrom(null)}
            style={{ background: "none", border: 0, textDecoration: "underline", color: "inherit" }}
          >
            Cancel
          </button>
        </p>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        {members.map((member, i) => (
          <div
            key={member.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 130px 120px auto",
              gap: 14,
              alignItems: "center",
              padding: "12px 16px",
              borderTop: i === 0 ? "none" : "1px solid var(--rule)",
              background: mergeFrom === member.id ? "var(--accent-sub)" : undefined,
            }}
          >
            <div style={{ minWidth: 0 }}>
              {renaming === member.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename.mutate({ id: member.id, name: draft });
                    setRenaming(null);
                  }}
                >
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => setRenaming(null)}
                    style={{
                      font: "inherit",
                      width: "100%",
                      padding: "5px 8px",
                      borderRadius: 5,
                      border: "1px solid var(--accent)",
                      background: "var(--panel)",
                      color: "var(--ink)",
                    }}
                  />
                </form>
              ) : (
                <div style={{ fontFamily: "var(--serif)", fontSize: 16 }}>{member.name}</div>
              )}
              {member.aliases.length > 1 && (
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                  also: {member.aliases.filter((a) => a !== member.name).join(" · ")}
                </div>
              )}
            </div>

            <div className="num" style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {member.lineCount} line{member.lineCount === 1 ? "" : "s"}
              <br />
              {member.wordCount.toLocaleString()} words
            </div>

            <div style={{ fontSize: 11.5 }}>
              {member.hasEnoughForBaseline ? (
                <span style={{ color: "var(--ok)" }}>● enough to analyse</span>
              ) : (
                <span style={{ color: "var(--muted)" }} title="Needs about 500 words for a stable baseline">
                  ○ too little yet
                </span>
              )}
            </div>

            <div style={{ display: "flex", gap: 6 }}>
              {mergeFrom && mergeFrom !== member.id ? (
                <button
                  className="btn btn-primary"
                  style={{ padding: "4px 9px", fontSize: 11.5 }}
                  onClick={() => merge.mutate({ fromId: mergeFrom, intoId: member.id })}
                >
                  Same as this
                </button>
              ) : (
                <>
                  <button
                    className="btn"
                    style={{ padding: "4px 9px", fontSize: 11.5 }}
                    onClick={() => {
                      setRenaming(member.id);
                      setDraft(member.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className="btn"
                    style={{ padding: "4px 9px", fontSize: 11.5 }}
                    onClick={() => setMergeFrom(member.id)}
                    disabled={Boolean(mergeFrom)}
                  >
                    Merge
                  </button>
                  <button
                    className="btn"
                    style={{ padding: "4px 9px", fontSize: 11.5 }}
                    title="Not a character — remove from the cast"
                    onClick={() => remove.mutate(member.id)}
                  >
                    Not a person
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={() => confirm.mutate()} disabled={confirm.isPending}>
          {confirm.isPending ? "Saving…" : "Cast looks right — continue"}
        </button>
        <button className="btn" onClick={() => extract.mutate()} disabled={extract.isPending}>
          {extract.isPending ? "Re-reading…" : "Read the dialogue again"}
        </button>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
          Re-reading discards any edits you’ve made here.
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <span className="eyebrow">{label}</span>
      <span
        className="num"
        style={{ fontSize: 18, color: muted ? "var(--muted)" : "var(--ink)" }}
      >
        {value}
      </span>
    </div>
  );
}
