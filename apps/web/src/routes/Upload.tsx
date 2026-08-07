import { useRef, useState, type DragEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, RequestError } from "../api";

const ACCEPTED = ".txt,.md,.markdown,.docx,.epub";

export function Upload({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadManuscript(projectId, file),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries();
    },
    onError: (e) => setError(e instanceof RequestError ? e.message : "That upload didn’t work."),
  });

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) upload.mutate(file);
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        style={{
          border: `1.5px dashed ${dragging ? "var(--accent)" : "var(--rule-2)"}`,
          background: dragging ? "var(--accent-sub)" : "var(--panel)",
          borderRadius: "var(--radius)",
          padding: "44px 24px",
          textAlign: "center",
          cursor: "pointer",
          transition: "border-color .12s, background .12s",
        }}
      >
        <p style={{ margin: 0, fontFamily: "var(--serif)", fontSize: 18 }}>
          {upload.isPending ? "Reading your manuscript…" : "Drop your manuscript here"}
        </p>
        <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
          .txt · .md · .docx · .epub — up to 25 MB
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = "";
        }}
      />

      {error && <p className="banner">{error}</p>}

      <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, maxWidth: "62ch" }}>
        Your manuscript is stored so it can be analysed, and is only ever visible to you. Blue
        Pencil reads the text — it never edits it.
      </p>
    </div>
  );
}
