import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, RequestError } from "../api";
import { useAuth } from "../auth";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function Projects() {
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });

  const create = useMutation({
    mutationFn: api.createProject,
    onSuccess: () => {
      setTitle("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e) => setError(e instanceof RequestError ? e.message : "Couldn’t create that manuscript."),
  });

  const remove = useMutation({
    mutationFn: api.deleteProject,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Give the manuscript a title.");
      return;
    }
    create.mutate({ title: trimmed });
  }

  const projects = data?.projects ?? [];

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
        <span className="brand-mark">Blue Pencil</span>
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--muted)" }}>{user?.email}</span>
        <button className="btn" onClick={() => void signOut()} style={{ padding: "5px 10px", fontSize: 12.5 }}>
          Sign out
        </button>
      </header>

      <main style={{ maxWidth: 780, margin: "0 auto", padding: "34px 24px 80px", display: "grid", gap: 24 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <span className="eyebrow">Your manuscripts</span>
          <h1 style={{ fontFamily: "var(--serif)", fontSize: 25 }}>
            {projects.length === 0 ? "Nothing here yet" : `${projects.length} manuscript${projects.length === 1 ? "" : "s"}`}
          </h1>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5, maxWidth: "62ch" }}>
            Create a manuscript to hold a draft. Uploading the text itself comes next — for now this is the shell
            everything else hangs from.
          </p>
        </div>

        <form className="card" onSubmit={onSubmit} style={{ padding: 16, display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="title">New manuscript</label>
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="The Quiet Hour"
              maxLength={200}
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create"}
          </button>
        </form>

        {error && <p className="banner">{error}</p>}

        {isLoading ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</p>
        ) : projects.length === 0 ? null : (
          <ul className="card" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {projects.map((project, index) => (
              <li
                key={project.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 16px",
                  borderTop: index === 0 ? "none" : "1px solid var(--rule)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--serif)", fontSize: 16.5 }}>{project.title}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                    {project.wordCount > 0 ? (
                      <span className="num">{project.wordCount.toLocaleString()} words</span>
                    ) : (
                      "no text yet"
                    )}
                    {" · created "}
                    {formatDate(project.createdAt)}
                  </div>
                </div>
                <button
                  className="btn btn-danger"
                  style={{ padding: "5px 10px", fontSize: 12.5 }}
                  onClick={() => {
                    if (confirm(`Delete “${project.title}”? This cannot be undone.`)) remove.mutate(project.id);
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
