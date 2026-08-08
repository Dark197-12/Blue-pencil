import { useQuery } from "@tanstack/react-query";
import { api, type Arc, type ArcsResponse, type ContextShift } from "../api";
import {
  SPARKLINE_HEIGHT,
  SPARKLINE_WIDTH,
  sparklinePath,
  sparklinePoints,
} from "./sparkline";

/**
 * How a voice moves: across the book, and across the people it speaks to.
 *
 * Both analyses need far more attributed dialogue than a profile does, and on
 * a lightly-tagged manuscript both will find nothing. That is reported up
 * front rather than left as an empty page, because "nothing found" and "not
 * enough evidence to look" are completely different answers and only one of
 * them means the author's book is fine.
 */
export function VoiceOverTime({
  projectId,
  onFixAttributions,
}: {
  projectId: string;
  onFixAttributions: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["arcs", projectId],
    queryFn: () => api.getArcs(projectId),
  });

  if (isLoading) return <p style={{ color: "var(--muted)", fontSize: 13 }}>Measuring…</p>;
  if (!data) return null;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <span className="eyebrow">Over time</span>
        <h2 style={{ fontFamily: "var(--serif)", fontSize: 22 }}>How voices move</h2>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5, maxWidth: "66ch", lineHeight: 1.6 }}>
          Two questions a single profile can’t answer: does a character change across the book, and
          do they sound different depending on who they’re talking to?
        </p>
      </div>

      <Coverage coverage={data.coverage} onFixAttributions={onFixAttributions} />

      <section style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h3 style={{ fontSize: 14 }}>Change across the book</h3>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
            {data.coverage.arcEligible} of {data.characters.length} characters have enough scenes
          </span>
        </div>

        {data.arcs.length === 0 ? (
          <div className="card" style={{ padding: 18 }}>
            <p style={{ margin: 0, fontFamily: "var(--serif)", fontSize: 15 }}>
              {data.coverage.arcEligible === 0
                ? "No character has enough scenes to test for a trend yet."
                : "No character drifts steadily in one direction."}
            </p>
            <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--muted)", maxWidth: "62ch", lineHeight: 1.6 }}>
              {data.coverage.arcEligible === 0 ? (
                <>
                  A character needs to speak in at least six scenes before a trend can be told from
                  noise. Below that, “consistently rising” happens by chance too often to mean
                  anything.
                </>
              ) : (
                <>
                  This looks for sustained drift in one direction — a voice loosening or hardening
                  over the whole book. A character who changes for a few chapters and changes back
                  won’t appear here; that shows up under <b>Consistency</b> instead.
                </>
              )}
            </p>
          </div>
        ) : (
          data.arcs.map((arc) => <ArcCard key={`${arc.characterId}-${arc.metric}`} arc={arc} />)
        )}

        {data.characters.length > 0 && (
          <p style={{ margin: 0, fontSize: 11.5, color: "var(--muted)", lineHeight: 1.6 }}>
            Scenes measured per character:{" "}
            {data.characters.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ", "}
                <span style={{ color: c.isArcEligible ? "var(--ink-2)" : undefined }}>
                  {c.name} <span className="num">{c.sceneCount}</span>
                </span>
              </span>
            ))}
          </p>
        )}
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h3 style={{ fontSize: 14 }}>Who they’re talking to</h3>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
            <span className="num">{data.coverage.relationships}</span> relationships measurable
          </span>
        </div>

        {data.shifts.length === 0 ? (
          <div className="card" style={{ padding: 18 }}>
            <p style={{ margin: 0, fontFamily: "var(--serif)", fontSize: 15 }}>
              {data.coverage.relationships < 2
                ? "Not enough conversations can be pinned down yet."
                : "No character changes register for a particular person."}
            </p>
            <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--muted)", maxWidth: "64ch", lineHeight: 1.6 }}>
              Knowing who a line is spoken <i>to</i> is harder than knowing who spoke it — prose
              rarely says. A scene only counts when every line in it has a speaker, because one
              unidentified line means the room might hold anyone.
            </p>
          </div>
        ) : (
          data.shifts.map((shift) => (
            <ShiftCard key={`${shift.speakerId}-${shift.addresseeId}`} shift={shift} />
          ))
        )}

        {data.relationships.length > 0 && (
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>
              Conversations with enough speech to measure
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              {data.relationships.map((r) => (
                <div
                  key={`${r.speakerId}-${r.addresseeId}`}
                  style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}
                >
                  <span style={{ color: "var(--ink-2)" }}>
                    {r.speakerName} <span style={{ color: "var(--muted)" }}>to</span>{" "}
                    {r.addresseeName}
                  </span>
                  <span className="num" style={{ color: "var(--muted)" }}>
                    {r.wordCount.toLocaleString()}w · {r.sceneCount} sc
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * The evidence budget, stated plainly.
 *
 * Without this the page is indistinguishable from a clean bill of health on a
 * manuscript nobody has finished attributing.
 */
function Coverage({
  coverage,
  onFixAttributions,
}: {
  coverage: ArcsResponse["coverage"];
  onFixAttributions: () => void;
}) {
  const attributed = coverage.linesTotal > 0 ? coverage.linesMeasurable / coverage.linesTotal : 0;
  const scenesComplete =
    coverage.scenesWithDialogue > 0
      ? coverage.scenesFullyAttributed / coverage.scenesWithDialogue
      : 0;
  const thin = scenesComplete < 0.25;

  return (
    <div className="card" style={{ padding: 16, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 12.5 }}>
        <Stat
          label="Lines safe to measure"
          value={`${coverage.linesMeasurable.toLocaleString()} of ${coverage.linesTotal.toLocaleString()}`}
          detail={`${Math.round(attributed * 100)}%`}
        />
        <Stat
          label="Scenes with every speaker known"
          value={`${coverage.scenesFullyAttributed} of ${coverage.scenesWithDialogue}`}
          detail={`${Math.round(scenesComplete * 100)}%`}
        />
        <Stat label="Lines with a known listener" value={coverage.linesAddressed.toLocaleString()} />
      </div>

      {thin && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", maxWidth: "70ch", lineHeight: 1.6 }}>
          Both analyses on this page are limited by attribution, not by your writing. Named speech
          tags alone rarely go far enough — the rest has to be confirmed by hand.{" "}
          <button
            className="btn"
            onClick={onFixAttributions}
            style={{ fontSize: 11.5, padding: "3px 9px", marginLeft: 4 }}
          >
            Fix attributions
          </button>
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>{label}</span>
      <span className="num" style={{ fontSize: 14, color: "var(--ink)" }}>
        {value}
        {detail && <span style={{ color: "var(--muted)", fontSize: 11.5, marginLeft: 6 }}>{detail}</span>}
      </span>
    </div>
  );
}

function ArcCard({ arc }: { arc: Arc }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--serif)", fontSize: 16 }}>{arc.summary}</span>
        <span className="num" style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--muted)" }}>
          {arc.label}
        </span>
      </div>

      <Sparkline points={arc.points} rising={arc.direction === "rising"} />

      <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.55 }}>
        From <span className="num">{arc.startLevel.toFixed(1)}</span> in their first scenes to{" "}
        <span className="num">{arc.endLevel.toFixed(1)}</span> in their last, across{" "}
        <span className="num">{arc.sceneCount}</span> scenes and{" "}
        <span className="num">{arc.wordCount.toLocaleString()}</span> words. Consistency of
        direction <span className="num">{arc.rho.toFixed(2)}</span> — 1.00 would mean every scene
        moved the same way.
      </p>
    </div>
  );
}

/**
 * The whole series, drawn.
 *
 * A card that only reported "rises from 12 to 19" would hide whether that was
 * a steady climb or one late spike, and those call for completely different
 * revisions. The dots are the scenes; the line between them is the claim.
 */
function Sparkline({ points, rising }: { points: Arc["points"]; rising: boolean }) {
  const plotted = sparklinePoints(points.map((p) => p.value));
  const path = sparklinePath(plotted);
  const colour = rising ? "var(--pole-hi)" : "var(--pole-lo)";

  return (
    <svg
      viewBox={`-3 -3 ${SPARKLINE_WIDTH + 6} ${SPARKLINE_HEIGHT + 6}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${points.length} scenes, ${rising ? "rising" : "falling"}`}
      style={{ width: "100%", height: 56, marginTop: 12, overflow: "visible" }}
    >
      <path d={path} fill="none" stroke={colour} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => {
        const { x, y } = plotted[i]!;
        return (
          <circle
            key={p.sceneId}
            cx={x}
            cy={y}
            r={1.6}
            fill={colour}
            vectorEffect="non-scaling-stroke"
          >
            <title>
              Chapter {p.chapterIndex + 1}: {p.value.toFixed(1)} ({p.wordCount} words)
            </title>
          </circle>
        );
      })}
    </svg>
  );
}

function ShiftCard({ shift }: { shift: ContextShift }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <p style={{ margin: 0, fontFamily: "var(--serif)", fontSize: 16 }}>{shift.summary}</p>

      <div style={{ display: "grid", gap: 4, margin: "14px 0 0" }}>
        {shift.evidence.map((e) => (
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
              to {shift.addresseeName} <b style={{ color: "var(--ink)" }}>{e.observed.toFixed(1)}</b>
              , to others <b style={{ color: "var(--ink-2)" }}>{e.elsewhere.toFixed(1)}</b>
              <span style={{ marginLeft: 8, color: e.z >= 0 ? "var(--pole-hi)" : "var(--pole-lo)" }}>
                {e.z >= 0 ? "+" : ""}
                {e.z.toFixed(1)}
              </span>
            </span>
          </div>
        ))}
      </div>

      <p style={{ margin: "14px 0 0", fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
        Based on <span className="num">{shift.wordCount.toLocaleString()}</span> words to{" "}
        {shift.addresseeName}, against{" "}
        <span className="num">{shift.elsewhereWordCount.toLocaleString()}</span> to everyone else.
        Measured against how much this character’s register wanders <i>within</i> a single
        relationship — not against the cast, and not against their own overall average, which would
        already contain the difference being tested.
      </p>
    </div>
  );
}
