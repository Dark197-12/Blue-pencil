import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, RequestError, type QueueItem } from "../api";

type Filter = "unattributed" | "uncertain";

/**
 * The attribution review queue.
 *
 * There can be a thousand lines to get through, so the whole screen is built
 * for the keyboard: number keys pick a speaker, Enter confirms and advances, J
 * and K move. Anyone reaching for the mouse on line 200 will abandon this.
 *
 * Candidates are ordered by who spoke nearby, so the number keys mean something
 * consistent within a conversation rather than shuffling on every line.
 */
export function AttributionQueue({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("unattributed");
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Lines resolved this session, so they can be greyed out without a refetch. */
  const [done, setDone] = useState<Record<string, string>>({});

  const statsQuery = useQuery({
    queryKey: ["attribution-stats", projectId],
    queryFn: () => api.getAttributionStats(projectId),
  });

  const queueQuery = useQuery({
    queryKey: ["attribution-queue", projectId, filter],
    queryFn: () => api.getAttributionQueue(projectId, filter, 20),
  });

  const items = useMemo(() => queueQuery.data?.items ?? [], [queueQuery.data]);
  const current = items[cursor];

  /**
   * Re-runs the automatic tiers. Offered because a manuscript ingested before a
   * tier existed is otherwise stuck at whatever coverage it had — and the only
   * alternative, re-extracting, throws away the author's own corrections.
   */
  const reinfer = useMutation({
    mutationFn: () => api.reinferSpeakers(projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attribution-stats", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["attribution-queue", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["arcs", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["flags", projectId] });
      setCursor(0);
    },
  });

  const assign = useMutation({
    mutationFn: (v: { lineId: string; characterId: string | null }) =>
      api.assignSpeaker(projectId, v.lineId, v.characterId),
    onError: (e) => setError(e instanceof RequestError ? e.message : "That didn’t save."),
  });

  const advance = useCallback(() => {
    setCursor((c) => {
      if (c + 1 < items.length) return c + 1;
      // Reached the end of this batch — pull the next one.
      void queryClient.invalidateQueries({ queryKey: ["attribution-queue", projectId, filter] });
      void queryClient.invalidateQueries({ queryKey: ["attribution-stats", projectId] });
      setDone({});
      return 0;
    });
  }, [items.length, queryClient, projectId, filter]);

  const choose = useCallback(
    (item: QueueItem, characterId: string | null, name: string | null) => {
      setError(null);
      setDone((d) => ({ ...d, [item.id]: name ?? "—" }));
      assign.mutate({ lineId: item.id, characterId });
      advance();
    },
    [assign, advance],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!current) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      if (event.key >= "1" && event.key <= "9") {
        const candidate = current.candidates[Number(event.key) - 1];
        if (candidate) {
          event.preventDefault();
          choose(current, candidate.id, candidate.name);
        }
        return;
      }

      switch (event.key.toLowerCase()) {
        case "j":
          event.preventDefault();
          advance();
          break;
        case "k":
          event.preventDefault();
          setCursor((c) => Math.max(0, c - 1));
          break;
        case "u":
          event.preventDefault();
          choose(current, null, null);
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, choose, advance]);

  const stats = statsQuery.data;
  const resolved = stats ? stats.total - stats.unattributed : 0;
  const percent = stats && stats.total > 0 ? Math.round((resolved / stats.total) * 100) : 0;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <span className="eyebrow">Step 4 · who said this</span>
        <h2 style={{ fontFamily: "var(--serif)", fontSize: 22 }}>
          {stats ? `${stats.unattributed.toLocaleString()} lines still unattributed` : "Loading…"}
        </h2>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5, maxWidth: "64ch", lineHeight: 1.6 }}>
          Speech tags and back-and-forth get most of the easy ones. These are the lines where the
          prose never says who spoke — pick a speaker, or skip anything genuinely ambiguous.
        </p>
      </div>

      {stats && (
        <div className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--panel-2)" }}>
            <Bar value={stats.tag} total={stats.total} color="var(--ok)" />
            <Bar value={stats.alternation} total={stats.total} color="var(--accent)" />
            <Bar value={stats.closure} total={stats.total} color="var(--seq-3)" />
            <Bar value={stats.constraints} total={stats.total} color="var(--pole-hi)" />
            <Bar value={stats.llm} total={stats.total} color="var(--warn)" />
            <Bar value={stats.manual} total={stats.total} color="var(--ink-2)" />
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11.5, color: "var(--muted)" }}>
            <Key color="var(--ok)" label="named in the text" value={stats.tag} />
            <Key color="var(--accent)" label="from the back-and-forth" value={stats.alternation} />
            {stats.closure > 0 && (
              <Key color="var(--seq-3)" label="two-person conversation" value={stats.closure} />
            )}
            {stats.constraints > 0 && (
              <Key color="var(--pole-hi)" label="narrowed down" value={stats.constraints} />
            )}
            {stats.llm > 0 && <Key color="var(--warn)" label="worked out by Claude" value={stats.llm} />}
            <Key color="var(--ink-2)" label="you decided" value={stats.manual} />
            <span style={{ marginLeft: "auto" }}>
              <span className="num" style={{ color: "var(--ink)", fontSize: 13 }}>{percent}%</span> attributed
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11.5 }}>
            <button
              className="btn"
              onClick={() => reinfer.mutate()}
              disabled={reinfer.isPending}
              style={{ fontSize: 11.5, padding: "4px 10px" }}
            >
              {reinfer.isPending ? "Working…" : "Run the automatic tiers again"}
            </button>
            <span style={{ color: "var(--muted)" }}>
              {reinfer.data
                ? `Changed ${reinfer.data.changed.toLocaleString()} lines. Your own answers were kept.`
                : "Keeps your corrections and the cast — only the guesses are redone."}
            </span>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {(["unattributed", "uncertain"] as const).map((f) => (
          <button
            key={f}
            className="btn"
            onClick={() => {
              setFilter(f);
              setCursor(0);
              setDone({});
            }}
            style={{
              padding: "4px 10px",
              fontSize: 11.5,
              borderColor: filter === f ? "var(--accent)" : undefined,
              color: filter === f ? "var(--accent)" : undefined,
            }}
          >
            {f === "unattributed" ? "No speaker" : "Low confidence"}
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--muted)" }}>
          {queueQuery.data ? `${queueQuery.data.total.toLocaleString()} in this queue` : ""}
        </span>
      </div>

      {error && <p className="banner">{error}</p>}

      {queueQuery.isLoading ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</p>
      ) : !current ? (
        <div className="card" style={{ padding: 24, textAlign: "center" }}>
          <p style={{ margin: 0, fontFamily: "var(--serif)", fontSize: 17 }}>Nothing left in this queue.</p>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
            Every line here has a speaker.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 20, display: "grid", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span className="num" style={{ fontSize: 11.5, color: "var(--muted)" }}>
              {cursor + 1} of {items.length} in this batch
            </span>
            {current.speakerRaw && (
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                the text says “{current.speakerRaw}” — {current.speakerKind}
              </span>
            )}
            {current.confidence !== null && (
              <span style={{ fontSize: 11.5, color: "var(--warn)" }}>
                current guess: {current.character?.name ?? "none"} ({Math.round(current.confidence * 100)}%)
              </span>
            )}
          </div>

          <div style={{ fontFamily: "var(--serif)", fontSize: 16.5, lineHeight: 1.7, color: "var(--muted)" }}>
            {current.context.before && <span>…{current.context.before.slice(-260)} </span>}
            <mark
              style={{
                background: "var(--accent-sub)",
                color: "var(--ink)",
                padding: "1px 3px",
                borderRadius: 2,
              }}
            >
              “{current.text}”
            </mark>
            {current.context.after && <span> {current.context.after.slice(0, 200)}…</span>}
          </div>

          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {current.candidates.map((candidate, i) => (
              <button
                key={candidate.id}
                className="btn"
                onClick={() => choose(current, candidate.id, candidate.name)}
                style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5 }}
              >
                <kbd
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    background: "var(--panel-2)",
                    borderRadius: 3,
                    padding: "1px 4px",
                    color: "var(--muted)",
                  }}
                >
                  {i + 1}
                </kbd>
                {candidate.name}
                {candidate.nearbyCount > 0 && (
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>· nearby</span>
                )}
              </button>
            ))}
            <button
              className="btn"
              onClick={() => choose(current, null, null)}
              style={{ fontSize: 12.5 }}
              title="Leave this line unattributed"
            >
              <kbd
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  background: "var(--panel-2)",
                  borderRadius: 3,
                  padding: "1px 4px",
                  color: "var(--muted)",
                  marginRight: 6,
                }}
              >
                U
              </kbd>
              Unknown
            </button>
          </div>

          <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--muted)", flexWrap: "wrap" }}>
            <span><Kbd>1</Kbd>–<Kbd>9</Kbd> pick speaker</span>
            <span><Kbd>U</Kbd> unknown</span>
            <span><Kbd>J</Kbd> skip</span>
            <span><Kbd>K</Kbd> back</span>
            {Object.keys(done).length > 0 && (
              <span style={{ marginLeft: "auto" }}>{Object.keys(done).length} decided in this batch</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Bar({ value, total, color }: { value: number; total: number; color: string }) {
  if (value === 0 || total === 0) return null;
  return <div style={{ width: `${(value / total) * 100}%`, background: color }} />;
}

function Key({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <i style={{ width: 8, height: 8, borderRadius: 2, background: color, display: "inline-block" }} />
      {label} <span className="num">{value.toLocaleString()}</span>
    </span>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        fontFamily: "var(--mono)",
        background: "var(--panel-2)",
        borderRadius: 3,
        padding: "1px 5px",
      }}
    >
      {children}
    </kbd>
  );
}
