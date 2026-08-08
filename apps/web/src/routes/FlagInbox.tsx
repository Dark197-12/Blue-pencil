import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type VoiceFlag } from "../api";

/**
 * The flag inbox: scenes where a character sounds unlike themselves.
 *
 * The interface is built around the assumption that the machine is probably
 * wrong. Every flag shows what it measured, what it compared against, and how
 * much speech sat on each side of the comparison — because the author is being
 * asked to overrule a statistic, and cannot do that on a verdict alone. The
 * primary action is "that's deliberate", not "fix it": most differences a novel
 * contains are on purpose, and a tool that assumes otherwise is an irritation.
 */
export function FlagInbox({
  projectId,
  onOpenScene,
}: {
  projectId: string;
  onOpenScene: (chapterId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"open" | "dismissed">("open");
  const [showSettings, setShowSettings] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["flags", projectId, status],
    queryFn: () => api.getFlags(projectId, status),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["flags", projectId] });

  const dismiss = useMutation({
    mutationFn: ({ flagId, dismissed }: { flagId: string; dismissed: boolean }) =>
      api.dismissFlag(projectId, flagId, dismissed),
    onSuccess: invalidate,
  });

  const recompute = useMutation({
    mutationFn: () => api.recomputeFlags(projectId),
    onSuccess: invalidate,
  });

  const updateSettings = useMutation({
    mutationFn: (settings: { flagThreshold?: number; ignoredMetrics?: string[] }) =>
      api.updateFlagSettings(projectId, settings),
    onSuccess: invalidate,
  });

  if (isLoading) return <p style={{ color: "var(--muted)", fontSize: 13 }}>Looking…</p>;

  const flags = data?.flags ?? [];
  const threshold = data?.settings.flagThreshold ?? 2.5;
  const ignored = data?.settings.ignoredMetrics ?? [];

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <span className="eyebrow">Consistency</span>
        <h2 style={{ fontFamily: "var(--serif)", fontSize: 22 }}>Where a voice slips</h2>
        <p
          style={{
            margin: 0,
            color: "var(--muted)",
            fontSize: 13.5,
            maxWidth: "66ch",
            lineHeight: 1.6,
          }}
        >
          Each scene is measured against the character’s <i>other</i> scenes — never against the
          cast, and never against the scene itself. Only named and hand-corrected speakers are
          counted, so a wrong guess can’t masquerade as a slip.
        </p>
      </div>

      <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
        <button
          className="btn"
          onClick={() => setStatus("open")}
          style={{
            fontSize: 12.5,
            padding: "5px 11px",
            borderColor: status === "open" ? "var(--accent)" : undefined,
            color: status === "open" ? "var(--accent)" : undefined,
          }}
        >
          Open
        </button>
        <button
          className="btn"
          onClick={() => setStatus("dismissed")}
          style={{
            fontSize: 12.5,
            padding: "5px 11px",
            borderColor: status === "dismissed" ? "var(--accent)" : undefined,
            color: status === "dismissed" ? "var(--accent)" : undefined,
          }}
        >
          Deliberate
          {data && data.dismissedCount > 0 && (
            <span className="num" style={{ color: "var(--muted)", marginLeft: 6, fontSize: 11 }}>
              {data.dismissedCount}
            </span>
          )}
        </button>

        <button
          className="btn"
          onClick={() => setShowSettings(!showSettings)}
          style={{ fontSize: 12.5, padding: "5px 11px", marginLeft: "auto" }}
        >
          Sensitivity
        </button>
        <button
          className="btn"
          onClick={() => recompute.mutate()}
          disabled={recompute.isPending}
          style={{ fontSize: 12.5, padding: "5px 11px" }}
        >
          {recompute.isPending ? "Measuring…" : "Re-check"}
        </button>
      </div>

      {showSettings && (
        <Settings
          threshold={threshold}
          ignored={ignored}
          metricKeys={data?.metricKeys ?? []}
          metricLabels={data?.metricLabels ?? {}}
          isSaving={updateSettings.isPending}
          onChange={(settings) => updateSettings.mutate(settings)}
        />
      )}

      {flags.length === 0 ? (
        <div className="card" style={{ padding: 20 }}>
          <p style={{ margin: 0, fontFamily: "var(--serif)", fontSize: 16 }}>
            {status === "dismissed"
              ? "Nothing marked deliberate yet."
              : "Nothing stands out."}
          </p>
          {status === "open" && (
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 12.5,
                color: "var(--muted)",
                maxWidth: "62ch",
                lineHeight: 1.6,
              }}
            >
              That may mean your voices hold steady — or that there isn’t enough attributed
              dialogue yet to tell. A character needs three scenes and around 500 words before
              they can be measured against themselves at all. This tool would rather say nothing
              than invent a problem.
            </p>
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {flags.map((flag) => (
            <FlagCard
              key={flag.id}
              flag={flag}
              onOpenScene={() => onOpenScene(flag.scene.chapter.id)}
              onDismiss={(dismissed) => dismiss.mutate({ flagId: flag.id, dismissed })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FlagCard({
  flag,
  onOpenScene,
  onDismiss,
}: {
  flag: VoiceFlag;
  onOpenScene: () => void;
  onDismiss: (dismissed: boolean) => void;
}) {
  const dismissed = flag.dismissedAt !== null;
  // Thin evidence is not hidden, it is labelled. The author decides what a
  // hundred words is worth.
  const thin = flag.sceneWordCount < 120 || flag.baselineSceneCount < 4;

  return (
    <div className="card" style={{ padding: 18, opacity: dismissed ? 0.6 : 1 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: flag.severity === "strong" ? "var(--pole-hi)" : "var(--muted)",
            border: "1px solid currentColor",
            borderRadius: 3,
            padding: "1px 5px",
          }}
        >
          {flag.severity}
        </span>
        <span style={{ fontFamily: "var(--serif)", fontSize: 16 }}>{flag.summary}</span>
        <button
          className="btn"
          onClick={onOpenScene}
          style={{ marginLeft: "auto", fontSize: 11.5, padding: "4px 10px" }}
        >
          Read the scene
        </button>
      </div>

      <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)" }}>
        {flag.scene.chapter.heading}
        {flag.scene.index > 0 ? ` · scene ${flag.scene.index + 1}` : ""}
      </p>

      <div style={{ display: "grid", gap: 4, margin: "14px 0 0" }}>
        {flag.evidence.map((e) => (
          <div
            key={e.metric}
            style={{
              display: "grid",
              gridTemplateColumns: "160px 1fr",
              gap: 12,
              alignItems: "baseline",
              fontSize: 12.5,
            }}
          >
            <span style={{ color: "var(--ink-2)" }}>{e.label}</span>
            <span className="num" style={{ color: "var(--muted)" }}>
              usually <b style={{ color: "var(--ink-2)" }}>{format(e.baseline)}</b>, here{" "}
              <b style={{ color: "var(--ink)" }}>{format(e.observed)}</b>
              <span style={{ marginLeft: 8, color: e.z >= 0 ? "var(--pole-hi)" : "var(--pole-lo)" }}>
                {e.z >= 0 ? "+" : ""}
                {e.z.toFixed(1)}σ
              </span>
            </span>
          </div>
        ))}
      </div>

      <p
        style={{
          margin: "14px 0 0",
          fontSize: 11.5,
          color: "var(--muted)",
          lineHeight: 1.5,
        }}
      >
        Based on <span className="num">{flag.sceneWordCount.toLocaleString()}</span> words in this
        scene, against <span className="num">{flag.baselineWordCount.toLocaleString()}</span>{" "}
        across their other <span className="num">{flag.baselineSceneCount}</span> scenes.
        {thin && " That’s a thin comparison — treat it as a nudge, not a finding."}
      </p>

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        {dismissed ? (
          <button
            className="btn"
            onClick={() => onDismiss(false)}
            style={{ fontSize: 11.5, padding: "4px 10px" }}
          >
            Put it back
          </button>
        ) : (
          <button
            className="btn"
            onClick={() => onDismiss(true)}
            style={{ fontSize: 11.5, padding: "4px 10px" }}
          >
            That’s deliberate
          </button>
        )}
      </div>
    </div>
  );
}

function Settings({
  threshold,
  ignored,
  metricKeys,
  metricLabels,
  isSaving,
  onChange,
}: {
  threshold: number;
  ignored: string[];
  metricKeys: string[];
  metricLabels: Record<string, string>;
  isSaving: boolean;
  onChange: (settings: { flagThreshold?: number; ignoredMetrics?: string[] }) => void;
}) {
  const toggle = (metric: string) =>
    onChange({
      ignoredMetrics: ignored.includes(metric)
        ? ignored.filter((m) => m !== metric)
        : [...ignored, metric],
    });

  return (
    <div className="card" style={{ padding: 18, display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <label style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
          How much of a difference is worth mentioning
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input
            type="range"
            min={2}
            max={4}
            step={0.1}
            value={threshold}
            disabled={isSaving}
            onChange={(e) => onChange({ flagThreshold: Number(e.target.value) })}
            style={{ flex: 1, maxWidth: 320 }}
          />
          <span className="num" style={{ fontSize: 12.5, minWidth: 60 }}>
            {threshold.toFixed(1)}σ
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 11.5, color: "var(--muted)", maxWidth: "62ch", lineHeight: 1.55 }}>
          Lower finds more and is wrong more often. Fifteen measures are taken per scene, so at 2.0
          chance alone throws up roughly one flag per scene. The default of 2.5 is set to miss
          things rather than to invent them.
        </p>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <label style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
          Measures to ignore
          <span style={{ color: "var(--muted)" }}> — switch off anything your book isn’t doing</span>
        </label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {metricKeys.map((metric) => {
            const off = ignored.includes(metric);
            return (
              <button
                key={metric}
                className="btn"
                onClick={() => toggle(metric)}
                disabled={isSaving}
                style={{
                  fontSize: 11.5,
                  padding: "4px 9px",
                  opacity: off ? 0.4 : 1,
                  textDecoration: off ? "line-through" : undefined,
                }}
              >
                {metricLabels[metric] ?? metric}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Rates run 0–100, richness runs 0–1; one rule can't serve both. */
function format(value: number): string {
  return value < 10 ? value.toFixed(2) : value.toFixed(1);
}
