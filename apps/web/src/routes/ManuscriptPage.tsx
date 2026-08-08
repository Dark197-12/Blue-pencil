import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { api } from "../api";
import { useAuth } from "../auth";
import { Upload } from "./Upload";
import { StructureReview } from "./StructureReview";
import { CastReview } from "./CastReview";
import { Reader } from "./Reader";

/**
 * One manuscript, in whichever of three states it is in: nothing uploaded yet,
 * uploaded but the chapter split not yet accepted, or ready to read.
 */
export function ManuscriptPage() {
  const { id = "" } = useParams();
  const { user, signOut } = useAuth();
  const [selectedChapterId, setSelectedChapterId] = useState<string>("");
  /** Lets the author reopen the cast screen after confirming it. */
  const [showCast, setShowCast] = useState(false);

  const projectQuery = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.getProject(id),
    enabled: Boolean(id),
  });

  const structureQuery = useQuery({
    queryKey: ["structure", id],
    queryFn: () => api.getStructure(id),
    enabled: Boolean(id),
  });

  const castQuery = useQuery({
    queryKey: ["cast", id],
    queryFn: () => api.getCast(id),
    enabled: Boolean(id),
  });

  const project = projectQuery.data?.project;
  const structure = structureQuery.data;
  const chapters = structure?.chapters ?? [];

  // Keep a valid selection as chapters are merged, split, or re-detected.
  useEffect(() => {
    if (chapters.length === 0) {
      if (selectedChapterId) setSelectedChapterId("");
      return;
    }
    if (!chapters.some((c) => c.id === selectedChapterId)) {
      setSelectedChapterId(chapters[0]!.id);
    }
  }, [chapters, selectedChapterId]);

  if (projectQuery.isError) {
    return (
      <Shell user={user?.email} onSignOut={signOut}>
        <p className="banner">That manuscript doesn’t exist, or isn’t yours.</p>
        <p style={{ marginTop: 14 }}>
          <Link to="/">Back to your manuscripts</Link>
        </p>
      </Shell>
    );
  }

  if (!project || structureQuery.isLoading) {
    return (
      <Shell user={user?.email} onSignOut={signOut}>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</p>
      </Shell>
    );
  }

  const hasManuscript = Boolean(structure?.structureParsedAt);
  const isConfirmed = Boolean(structure?.structureConfirmedAt);
  // The cast step is done once at least one character has been confirmed.
  const castConfirmed =
    !showCast && (castQuery.data?.members.some((m) => m.isConfirmed) ?? false);

  return (
    <Shell user={user?.email} onSignOut={signOut}>
      <div style={{ display: "grid", gap: 8, marginBottom: 24 }}>
        <Link to="/" style={{ fontSize: 12.5, textDecoration: "none" }}>
          ← Your manuscripts
        </Link>
        <h1 style={{ fontFamily: "var(--serif)", fontSize: 26 }}>{project.title}</h1>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
          {project.author ? `${project.author} · ` : ""}
          {project.wordCount > 0 ? (
            <>
              <span className="num">{project.wordCount.toLocaleString()}</span> words ·{" "}
              <span className="num">{chapters.length}</span> chapters
              {project.sourceFilename ? ` · ${project.sourceFilename}` : ""}
            </>
          ) : (
            "No manuscript uploaded yet"
          )}
        </p>
      </div>

      {!hasManuscript ? (
        <Upload projectId={id} />
      ) : !isConfirmed ? (
        <StructureReview
          projectId={id}
          chapters={chapters}
          wordCount={structure?.wordCount ?? 0}
        />
      ) : !castConfirmed ? (
        <CastReview projectId={id} />
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <span className="eyebrow">Manuscript</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Dialogue with a named speaker is highlighted. Working out the untagged lines comes next.
            </span>
            <button
              className="btn"
              style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 11.5 }}
              onClick={() => setShowCast(true)}
            >
              Edit cast
            </button>
          </div>
          {selectedChapterId && (
            <Reader
              projectId={id}
              chapters={chapters}
              selectedChapterId={selectedChapterId}
              onSelectChapter={setSelectedChapterId}
            />
          )}
        </div>
      )}
    </Shell>
  );
}

function Shell({
  children,
  user,
  onSignOut,
}: {
  children: React.ReactNode;
  user?: string;
  onSignOut: () => Promise<void>;
}) {
  return (
    <div style={{ minHeight: "100%" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "0 18px",
          height: 52,
          background: "var(--panel)",
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="brand-mark">Blue Pencil</span>
        </Link>
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--muted)" }}>{user}</span>
        <button className="btn" onClick={() => void onSignOut()} style={{ padding: "5px 10px", fontSize: 12.5 }}>
          Sign out
        </button>
      </header>
      <main style={{ maxWidth: 980, margin: "0 auto", padding: "28px 24px 80px" }}>{children}</main>
    </div>
  );
}
