import { computeMetrics, METRIC_LABELS, COMPARABLE_METRICS, type ComparableMetric, type Metrics } from "./metrics.js";
import { MINIMUM_EFFECT } from "./flags.js";
import type { Baseline } from "./baseline.js";

/**
 * Who a line is spoken to, and whether a character sounds different depending
 * on the answer.
 *
 * This is the part of voice that most resists a single profile. People are not
 * one voice; they are a voice per relationship. A character who is curt with
 * her husband and expansive with her sister has no inconsistency to fix, and a
 * tool that averaged the two would report a wide, mushy "spread" and miss the
 * only interesting fact available.
 *
 * The hard part is not the measurement, it is knowing who was being addressed.
 * Prose almost never says. So this module refuses to guess in most cases: it
 * claims an addressee only where the text constrains the answer, and leaves
 * every other line unassigned. A wrong addressee is worse than an absent one
 * for the same reason a wrong speaker is — it moves words from one
 * relationship's pile to another's, which is precisely the difference being
 * measured.
 */

export interface ContextLine {
  sceneId: string;
  /**
   * Null for a line whose speaker is unknown.
   *
   * These must be passed in, not filtered out. A scene with two named speakers
   * and nine unattributed lines is not a two-hander, and treating it as one
   * would hand every one of those lines to the wrong relationship. An unknown
   * speaker is evidence about the room even though it is not evidence about
   * the line.
   */
  characterId: string | null;
  text: string;
  /** Position in the manuscript, used only for ordering within a scene. */
  offset: number;
  /**
   * Whether this line's own speaker is trustworthy enough to measure. Defaults
   * to true.
   *
   * Speaker identity is doing two different jobs here and they need different
   * standards of proof. Deciding *whose voice this is* demands a near-certain
   * attribution, because a wrong line moves words between the two piles being
   * compared. Deciding *who else is in the room* does not: a line attributed by
   * alternation is nearly always attributed to someone who really is present,
   * and even when the speaker is wrong the room is right. Alternation's
   * characteristic error — handing a line to the other person in the
   * conversation — is almost harmless for that second job, because that person
   * was in the room either way.
   *
   * So inferred lines are admitted as evidence about the scene and excluded
   * from the measurement.
   */
  isReliable?: boolean;
}

/** How confident the addressee is, and why. */
export type AddresseeBasis = "two-hander" | "exchange";

export interface AddressedLine extends ContextLine {
  characterId: string;
  addresseeId: string;
  basis: AddresseeBasis;
}

/**
 * Works out who each line is spoken to, and says nothing where it cannot tell.
 *
 * Two situations are safe. A scene with exactly two speakers leaves no room for
 * doubt. And in a crowded scene, a line sandwiched between two lines from the
 * same other character is part of a back-and-forth with that character — the
 * pattern a reader uses, and the only one available without understanding the
 * words.
 *
 * Everything else — a line after a speech by one person and before a speech by
 * another, a monologue in a full room — is left unassigned. In Pride and
 * Prejudice that discards a large minority of the dialogue. Discarding it is
 * the point: what remains is worth measuring.
 */
export function inferAddressees(lines: ReadonlyArray<ContextLine>): AddressedLine[] {
  const byScene = new Map<string, ContextLine[]>();
  for (const line of lines) {
    byScene.set(line.sceneId, [...(byScene.get(line.sceneId) ?? []), line]);
  }

  const addressed: AddressedLine[] = [];

  for (const [, unsorted] of byScene) {
    const scene = [...unsorted].sort((a, b) => a.offset - b.offset);
    const speakers = new Set(
      scene.map((l) => l.characterId).filter((id): id is string => id !== null),
    );
    const hasUnknown = scene.some((l) => l.characterId === null);

    // Only a scene where every line is accounted for can be called a
    // two-hander. One unattributed line and the room might hold anyone.
    if (speakers.size === 2 && !hasUnknown) {
      const [first, second] = [...speakers];
      for (const line of scene) {
        addressed.push({
          ...line,
          characterId: line.characterId!,
          addresseeId: line.characterId === first ? second! : first!,
          basis: "two-hander",
        });
      }
      continue;
    }

    if (speakers.size < 2) continue;

    for (let i = 0; i < scene.length; i++) {
      const line = scene[i]!;
      if (line.characterId === null) continue;

      // Walk outward past the character's own consecutive lines: a speech
      // broken into three paragraphs is still one turn in the exchange.
      let before = i - 1;
      while (before >= 0 && scene[before]!.characterId === line.characterId) before--;
      let after = i + 1;
      while (after < scene.length && scene[after]!.characterId === line.characterId) after++;

      const previous = scene[before]?.characterId;
      const next = scene[after]?.characterId;

      // Both neighbours must be the same, known, other person. One-sided
      // evidence is not enough: in a crowd, being answered by someone does not
      // mean you were speaking to them. And a neighbour whose speaker is
      // unknown is not evidence of anything.
      if (previous && previous === next) {
        addressed.push({ ...line, characterId: line.characterId, addresseeId: previous, basis: "exchange" });
      }
    }
  }

  return addressed.sort((a, b) => a.offset - b.offset);
}

export interface ContextSceneMeasurement {
  sceneId: string;
  wordCount: number;
  metrics: Metrics;
}

export interface ContextMeasurement {
  speakerId: string;
  addresseeId: string;
  wordCount: number;
  lineCount: number;
  metrics: Metrics;
  /**
   * The same speech measured scene by scene. This is what makes the comparison
   * testable: it says how much this relationship's register wobbles when the
   * relationship itself is held constant.
   */
  scenes: ContextSceneMeasurement[];
}

export interface ContextOptions {
  /**
   * Words a character must speak to someone before that relationship is
   * measured. Higher than the 60-word scene floor and for a different reason:
   * a scene is one sample among many, but this is the whole of the evidence
   * about a relationship, so it has to stand on its own.
   */
  minWords?: number;
  /** Words in one scene before that scene contributes to the wobble estimate. */
  minSceneWords?: number;
  /**
   * Scenes a relationship needs before it can be judged. Two is the minimum
   * that says anything at all about consistency; one scene cannot distinguish
   * "this is how she speaks to him" from "this is how that afternoon went".
   */
  minScenes?: number;
  threshold?: number;
  ignoredMetrics?: ReadonlyArray<ComparableMetric>;
}

/** Measures each character's speech, split by who they were speaking to. */
export function measureContexts(
  lines: ReadonlyArray<AddressedLine>,
  options: ContextOptions = {},
): ContextMeasurement[] {
  const minWords = options.minWords ?? 300;
  const minSceneWords = options.minSceneWords ?? 40;

  // speaker → addressee → scene → the lines said there.
  const grouped = new Map<string, Map<string, Map<string, string[]>>>();
  for (const line of lines) {
    // Inferred speakers shaped the addressee above; they do not get measured.
    if (line.isReliable === false) continue;
    const perAddressee = grouped.get(line.characterId) ?? new Map<string, Map<string, string[]>>();
    const perScene = perAddressee.get(line.addresseeId) ?? new Map<string, string[]>();
    perScene.set(line.sceneId, [...(perScene.get(line.sceneId) ?? []), line.text]);
    perAddressee.set(line.addresseeId, perScene);
    grouped.set(line.characterId, perAddressee);
  }

  const measurements: ContextMeasurement[] = [];

  for (const [speakerId, perAddressee] of grouped) {
    for (const [addresseeId, perScene] of perAddressee) {
      const all = [...perScene.values()].flat();
      const metrics = computeMetrics(all);
      if (metrics.wordCount < minWords) continue;

      const scenes: ContextSceneMeasurement[] = [];
      for (const [sceneId, passages] of perScene) {
        const sceneMetrics = computeMetrics(passages);
        // A lower floor than the 60 words a scene baseline needs. These are
        // only used to estimate wobble, and demanding 60 would throw away most
        // relationships in a book that cuts between conversations quickly.
        if (sceneMetrics.wordCount < minSceneWords) continue;
        scenes.push({ sceneId, wordCount: sceneMetrics.wordCount, metrics: sceneMetrics });
      }

      measurements.push({
        speakerId,
        addresseeId,
        wordCount: metrics.wordCount,
        lineCount: all.length,
        metrics,
        scenes,
      });
    }
  }

  return measurements;
}

export interface ContextEvidence {
  metric: ComparableMetric;
  label: string;
  /** How the character speaks to everyone else. */
  elsewhere: number;
  /** How they speak to this person. */
  observed: number;
  z: number;
  direction: "higher" | "lower";
}

export interface ContextShift {
  speakerId: string;
  speakerName: string;
  addresseeId: string;
  addresseeName: string;
  peakZ: number;
  evidence: ContextEvidence[];
  wordCount: number;
  elsewhereWordCount: number;
  summary: string;
}

const PHRASING: Record<ComparableMetric, { higher: string; lower: string }> = {
  meanSentenceLength: { higher: "in longer sentences", lower: "in shorter sentences" },
  sentenceLengthVariation: { higher: "in a more uneven rhythm", lower: "in a more even rhythm" },
  contractionRate: { higher: "more loosely", lower: "more stiffly" },
  polysyllabicRate: { higher: "in longer words", lower: "in plainer words" },
  latinateRate: { higher: "more formally", lower: "more plainly" },
  hedgeRate: { higher: "more tentatively", lower: "more bluntly" },
  intensifierRate: { higher: "more emphatically", lower: "more evenly" },
  fillerRate: { higher: "with more hesitation", lower: "with less hesitation" },
  profanityRate: { higher: "more coarsely", lower: "more carefully" },
  questionRate: { higher: "with far more questions", lower: "with far fewer questions" },
  exclamationRate: { higher: "with far more exclamation", lower: "with far less exclamation" },
  trailOffRate: { higher: "trailing off far more", lower: "trailing off far less" },
  interruptionRate: { higher: "getting cut short far more", lower: "getting cut short far less" },
  vocabularyRichness: { higher: "with a wider vocabulary", lower: "with a narrower vocabulary" },
  readingGrade: { higher: "in a more complex register", lower: "in a simpler register" },
};

/**
 * Pooled within-relationship spread: how much a metric wobbles from scene to
 * scene while the relationship is held fixed.
 *
 * This is the yardstick, and choosing it was the whole difficulty. The obvious
 * candidate — the character's own spread across all their scenes — is exactly
 * wrong, because if a character's register really does depend on who they are
 * talking to, then that spread is largely *made of* the effect being tested.
 * Measuring against it hides the finding inside the ruler, the same way a
 * scene hides inside a baseline that contains it.
 *
 * So the variation is pooled from within each relationship separately, which
 * leaves the between-relationship differences to be tested against it.
 */
function pooledWithinSpread(
  groups: ReadonlyArray<ReadonlyArray<number>>,
): { spread: number; degreesOfFreedom: number } {
  let sumSquares = 0;
  let degreesOfFreedom = 0;

  for (const values of groups) {
    if (values.length < 2) continue;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    sumSquares += values.reduce((s, v) => s + (v - mean) ** 2, 0);
    degreesOfFreedom += values.length - 1;
  }

  if (degreesOfFreedom === 0) return { spread: 0, degreesOfFreedom: 0 };
  return { spread: Math.sqrt(sumSquares / degreesOfFreedom), degreesOfFreedom };
}

/**
 * Finds relationships where a character audibly changes register.
 *
 * The comparison is against how that character speaks to *everyone else*, not
 * against the cast and not against their overall average — which would include
 * the very speech being tested and blunt the difference, the same trap the
 * scene flags fall into without leave-one-out.
 *
 * `baselines` is still required, but only to establish that the character has
 * enough speech overall to be worth analysing at all.
 */
export function findContextShifts(
  measurements: ReadonlyArray<ContextMeasurement>,
  baselines: ReadonlyArray<Baseline>,
  names: ReadonlyMap<string, string>,
  options: ContextOptions = {},
): ContextShift[] {
  const threshold = options.threshold ?? 2.5;
  const ignored = new Set(options.ignoredMetrics ?? []);
  const minWords = options.minWords ?? 300;
  const minScenes = options.minScenes ?? 2;

  const baselineFor = new Map(baselines.map((b) => [b.characterId, b]));

  const bySpeaker = new Map<string, ContextMeasurement[]>();
  for (const measurement of measurements) {
    const list = bySpeaker.get(measurement.speakerId) ?? [];
    list.push(measurement);
    bySpeaker.set(measurement.speakerId, list);
  }

  const shifts: ContextShift[] = [];

  for (const [speakerId, contexts] of bySpeaker) {
    // With only one relationship measured there is nothing to compare against.
    if (contexts.length < 2) continue;

    const baseline = baselineFor.get(speakerId);
    if (!baseline?.isUsable) continue;

    for (const context of contexts) {
      if (context.scenes.length < minScenes) continue;

      const others = contexts.filter((c) => c.addresseeId !== context.addresseeId);
      const elsewhereWords = others.reduce((sum, c) => sum + c.wordCount, 0);
      const elsewhereScenes = others.reduce((sum, c) => sum + c.scenes.length, 0);
      if (elsewhereWords < minWords || elsewhereScenes < minScenes) continue;

      const evidence: ContextEvidence[] = [];

      for (const metric of COMPARABLE_METRICS) {
        if (ignored.has(metric)) continue;

        const observed = context.metrics[metric];
        if (typeof observed !== "number" || !Number.isFinite(observed)) continue;

        // Weighted by words, so a long relationship counts for more than a
        // short one when forming the comparison.
        let weighted = 0;
        let total = 0;
        for (const other of others) {
          const value = other.metrics[metric];
          if (typeof value !== "number" || !Number.isFinite(value)) continue;
          weighted += value * other.wordCount;
          total += other.wordCount;
        }
        if (total === 0) continue;

        const elsewhere = weighted / total;
        const difference = observed - elsewhere;
        if (Math.abs(difference) < MINIMUM_EFFECT[metric]) continue;

        const numeric = (values: ReadonlyArray<ContextSceneMeasurement>) =>
          values
            .map((s) => s.metrics[metric])
            .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

        const here = numeric(context.scenes);
        const elsewhereGroups = others.map((o) => numeric(o.scenes));
        const { spread } = pooledWithinSpread([here, ...elsewhereGroups]);

        /**
         * A two-sample statistic rather than a plain z: the uncertainty in the
         * comparison depends on how many scenes sit on each side, and a
         * relationship measured over two scenes deserves a wider error bar
         * than one measured over ten.
         */
        const n = here.length;
        const m = elsewhereGroups.reduce((sum, g) => sum + g.length, 0);
        const standardError = spread * Math.sqrt(1 / Math.max(1, n) + 1 / Math.max(1, m));

        // No wobble at all within either relationship, and a difference
        // already known to be audible. There is no statistical question left,
        // so the practical test decides — as it does for the scene flags.
        const z = standardError > 0 ? difference / standardError : Math.sign(difference) * threshold;
        if (Math.abs(z) < threshold) continue;

        evidence.push({
          metric,
          label: METRIC_LABELS[metric],
          elsewhere,
          observed,
          z,
          direction: difference > 0 ? "higher" : "lower",
        });
      }

      if (evidence.length === 0) continue;

      evidence.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
      const speakerName = names.get(speakerId) ?? speakerId;
      const addresseeName = names.get(context.addresseeId) ?? context.addresseeId;
      const lead = PHRASING[evidence[0]!.metric][evidence[0]!.direction];

      shifts.push({
        speakerId,
        speakerName,
        addresseeId: context.addresseeId,
        addresseeName,
        peakZ: Math.abs(evidence[0]!.z),
        evidence,
        wordCount: context.wordCount,
        elsewhereWordCount: elsewhereWords,
        summary: `${speakerName} speaks to ${addresseeName} ${lead} than to anyone else.`,
      });
    }
  }

  return shifts.sort((a, b) => b.peakZ - a.peakZ);
}
