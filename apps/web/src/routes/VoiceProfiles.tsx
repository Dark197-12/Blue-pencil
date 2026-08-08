import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

/**
 * Voice profiles: how each character differs from the rest of the cast.
 *
 * Deviation bars rather than a radar chart. Radar encodes magnitude as area,
 * which distorts, and its axis order is arbitrary — reorder the spokes and the
 * shape changes meaning without the data changing. Bars on a single shared
 * scale of standard deviations answer the actual question: how is this person
 * different, and by how much.
 */
export function VoiceProfiles({ projectId }: { projectId: string }) {
  const [includeInferred, setIncludeInferred] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["voice", projectId, includeInferred],
    queryFn: () => api.getVoiceProfiles(projectId, includeInferred),
  });

  if (isLoading) return <p style={{ color: "var(--muted)", fontSize: 13 }}>Measuring…</p>;

  const profiles = data?.profiles ?? [];
  const reliable = profiles.filter((p) => p.isReliable);
  const current = profiles.find((p) => p.name === selected) ?? reliable[0] ?? profiles[0];

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <span className="eyebrow">Voice profiles</span>
        <h2 style={{ fontFamily: "var(--serif)", fontSize: 22 }}>How your characters sound</h2>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5, maxWidth: "64ch", lineHeight: 1.6 }}>
          Each measure is shown against the rest of the cast, so a bar to the right means more than
          the others and a bar to the left means less. Built from{" "}
          <span className="num">{data?.linesUsed.toLocaleString()}</span> lines.
        </p>
      </div>

      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 9,
          fontSize: 12.5,
          color: "var(--ink-2)",
          background: "var(--panel)",
          border: "1px solid var(--rule)",
          borderRadius: "var(--radius-sm)",
          padding: "10px 12px",
          maxWidth: "72ch",
        }}
      >
        <input
          type="checkbox"
          checked={includeInferred}
          onChange={(e) => setIncludeInferred(e.target.checked)}
          style={{ marginTop: 2 }}
        />
        <span>
          Include worked-out speakers as well as named ones.
          <span style={{ display: "block", color: "var(--muted)", marginTop: 2 }}>
            More lines to measure, but about a quarter of them are wrong — and a wrong line usually
            belongs to the other person in the conversation, which is the character this profile most
            needs to be told apart from.
          </span>
        </span>
      </label>

      {reliable.length < 2 ? (
        <div className="card" style={{ padding: 20 }}>
          <p style={{ margin: 0, fontFamily: "var(--serif)", fontSize: 16 }}>
            Not enough dialogue attributed yet.
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--muted)", maxWidth: "60ch", lineHeight: 1.6 }}>
            A character needs around 500 words before these numbers settle down. Attribute more
            lines in <b>Fix attributions</b> and they’ll appear here.
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {profiles.map((p) => (
              <button
                key={p.name}
                className="btn"
                onClick={() => setSelected(p.name)}
                disabled={!p.isReliable}
                title={p.isReliable ? undefined : "Too little dialogue to measure reliably"}
                style={{
                  fontSize: 12.5,
                  padding: "5px 11px",
                  borderColor: current?.name === p.name ? "var(--accent)" : undefined,
                  color: current?.name === p.name ? "var(--accent)" : undefined,
                  opacity: p.isReliable ? 1 : 0.45,
                }}
              >
                {p.name}
                <span style={{ color: "var(--muted)", marginLeft: 6, fontSize: 11 }}>
                  {(p.metrics.wordCount ?? 0).toLocaleString()}w
                </span>
              </button>
            ))}
          </div>

          {current && (
            <>
              <div className="card" style={{ padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                  <h3 style={{ fontSize: 14 }}>{current.name} against the cast</h3>
                  <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    standard deviations from the cast average
                  </span>
                </div>

                <div style={{ display: "grid", gap: 3 }}>
                  {(data?.metricKeys ?? [])
                    .map((key) => ({ key, z: current.z[key], raw: current.metrics[key] }))
                    .filter((row) => typeof row.z === "number")
                    .sort((a, b) => Math.abs(b.z!) - Math.abs(a.z!))
                    .map(({ key, z, raw }) => (
                      <DeviationRow
                        key={key}
                        label={data?.metricLabels[key] ?? key}
                        z={z!}
                        raw={typeof raw === "number" ? raw : null}
                      />
                    ))}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "150px 1fr 108px",
                    gap: 12,
                    fontSize: 10.5,
                    color: "var(--muted)",
                    marginTop: 8,
                  }}
                >
                  <span />
                  <span style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>−3</span>
                    <span>cast average</span>
                    <span>+3</span>
                  </span>
                  <span />
                </div>
              </div>

              {current.signatureWords.length > 0 && (
                <div className="card" style={{ padding: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                    <h3 style={{ fontSize: 14 }}>Words {current.name} reaches for</h3>
                    <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                      compared with everyone else
                    </span>
                  </div>
                  <div style={{ display: "grid", gap: 7 }}>
                    {current.signatureWords.map((w) => (
                      <div
                        key={w.word}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "130px 1fr 84px",
                          gap: 10,
                          alignItems: "center",
                          fontSize: 12.5,
                        }}
                      >
                        <span style={{ fontFamily: "var(--serif)", fontSize: 15 }}>{w.word}</span>
                        <span style={{ height: 8, background: "var(--panel-2)", borderRadius: 4, overflow: "hidden" }}>
                          <i
                            style={{
                              display: "block",
                              height: "100%",
                              width: `${Math.min(100, (w.distinctiveness / 12) * 100)}%`,
                              background: "var(--accent)",
                              borderRadius: 4,
                            }}
                          />
                        </span>
                        <span className="num" style={{ color: "var(--muted)", textAlign: "right" }}>
                          {w.distinctiveness.toFixed(1)}× · {w.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <SimilarityTable data={data} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function DeviationRow({ label, z, raw }: { label: string; z: number; raw: number | null }) {
  const magnitude = Math.min(Math.abs(z) / 3, 1) * 50;
  const notable = Math.abs(z) >= 1.5;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 108px", gap: 12, alignItems: "center", padding: "4px 0" }}>
      <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{label}</span>

      <span style={{ position: "relative", height: 20 }}>
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: -2,
            bottom: -2,
            width: 1,
            background: "var(--rule-2)",
          }}
        />
        <i
          style={{
            position: "absolute",
            top: 4,
            height: 12,
            width: `${magnitude}%`,
            // Above the cast average and below it are different facts, not
            // degrees of the same one, so they get different hues.
            background: z >= 0 ? "var(--pole-hi)" : "var(--pole-lo)",
            ...(z >= 0
              ? { left: "50%", marginLeft: 1, borderRadius: "0 4px 4px 0" }
              : { right: "50%", marginRight: 1, borderRadius: "4px 0 0 4px" }),
            opacity: notable ? 1 : 0.55,
          }}
        />
      </span>

      <span className="num" style={{ fontSize: 12, color: "var(--muted)", textAlign: "right" }}>
        <b style={{ color: notable ? "var(--ink)" : "var(--ink-2)" }}>
          {z >= 0 ? "+" : ""}
          {z.toFixed(1)}σ
        </b>
        {raw !== null && <span> · {raw.toFixed(raw < 10 ? 2 : 1)}</span>}
      </span>
    </div>
  );
}

function SimilarityTable({ data }: { data: ReturnType<typeof useQuery<Awaited<ReturnType<typeof api.getVoiceProfiles>>>>["data"] }) {
  const similarity = data?.similarity ?? [];
  if (similarity.length < 2) return null;

  const worst = similarity
    .flatMap((row) => row.against.map((a) => ({ a: row.name, b: a.name, score: a.score })))
    .sort((x, y) => y.score - x.score)[0];

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ fontSize: 14 }}>Do your characters sound like each other?</h3>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>higher means harder to tell apart</span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 2, fontSize: 12 }}>
          <thead>
            <tr>
              <th />
              {similarity.map((row) => (
                <th
                  key={row.name}
                  style={{ fontWeight: 500, color: "var(--muted)", fontSize: 11, padding: "0 6px" }}
                >
                  {row.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {similarity.map((row) => (
              <tr key={row.name}>
                <th
                  style={{
                    fontWeight: 500,
                    color: "var(--muted)",
                    fontSize: 11.5,
                    textAlign: "right",
                    padding: "0 8px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.name}
                </th>
                {similarity.map((col) => {
                  if (col.name === row.name) {
                    return (
                      <td
                        key={col.name}
                        style={{
                          background: "var(--panel-2)",
                          color: "var(--muted)",
                          textAlign: "center",
                          borderRadius: 4,
                          height: 34,
                          minWidth: 58,
                        }}
                      >
                        —
                      </td>
                    );
                  }
                  const score = row.against.find((a) => a.name === col.name)?.score ?? 0;
                  // One hue, light to dark: this is a magnitude, and a rainbow
                  // would imply categories that are not there.
                  const step = Math.min(5, Math.floor(score / 18));
                  return (
                    <td
                      key={col.name}
                      title={`${row.name} and ${col.name}: ${score}/100`}
                      className="num"
                      style={{
                        background: `var(--seq-${step + 1})`,
                        color: step >= 3 ? "#fff" : "var(--ink-2)",
                        textAlign: "center",
                        borderRadius: 4,
                        height: 34,
                        minWidth: 58,
                      }}
                    >
                      {score}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {worst && (
        <p style={{ margin: "14px 0 0", fontSize: 12.5, color: "var(--ink-2)", maxWidth: "64ch", lineHeight: 1.55 }}>
          <b>
            {worst.a} and {worst.b}
          </b>{" "}
          are the closest pair at {worst.score}/100.{" "}
          {worst.score >= 70
            ? "That is close enough that readers may struggle to tell them apart without the speech tags."
            : "That is comfortably distinct."}
        </p>
      )}
    </div>
  );
}
