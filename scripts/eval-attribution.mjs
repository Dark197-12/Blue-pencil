/**
 * Measuring attribution accuracy against known answers.
 *
 * Every number in the attribution pipeline until now has been coverage — how
 * many lines got *a* speaker. Coverage without accuracy is worthless: a tier
 * that attributes everything at random scores 100% coverage and destroys the
 * data. This measures whether the speakers are right.
 *
 * The corpus is synthesised from The Importance of Being Earnest, which labels
 * every speech with its speaker. Those labels are the ground truth. The play is
 * rewritten as novel prose — speeches become quoted dialogue, and a chosen
 * fraction get an explicit speech tag — so the extractor sees something shaped
 * like a novel while we retain the answer for every line.
 *
 * It is synthetic, and that is a real limitation: a play is almost entirely
 * two-hander dialogue with little narration, which flatters alternation. Treat
 * the numbers as an upper bound, and as a regression guard when changing the
 * tiers, rather than as what a novel would score.
 *
 *   node scripts/eval-attribution.mjs [tagRate]
 */

import { readFileSync } from "node:fs";
import {
  buildCast,
  closeTwoHanders,
  detectScenes,
  extractDialogue,
  inferByAlternation,
  inferGenders,
  normalizeText,
  resolveByConstraints,
  stripGutenbergBoilerplate,
} from "../packages/analysis/dist/index.js";

const TAG_RATE = Number(process.argv[2] ?? 0.2);
/** Anchors each speaker needs before a scene counts as a two-hander. */
const MIN_ANCHORS = Number(process.argv[3] ?? 2);

// ---------------------------------------------------------------- corpus ----

/** Pulls (speaker, speech) pairs out of the play's script format. */
function parsePlay(text) {
  const lines = text.split("\n");
  const speeches = [];
  let speaker = null;
  let buffer = [];

  const flush = () => {
    const body = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (speaker && body) speeches.push({ speaker, text: body });
    buffer = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    // A speaker label: all caps, on its own line, ending in a full stop.
    const label = /^([A-Z][A-Z.'’ ]{1,24})\.$/.exec(line);
    if (label) {
      flush();
      speaker = label[1].replace(/\.$/, "").trim();
      continue;
    }
    if (!line) continue;
    if (/^(ACT|SCENE|CURTAIN|TIME|PLACE|PERSONS|THE END)/i.test(line)) continue;
    buffer.push(line);
  }
  flush();

  return speeches;
}

/** Title-cases a shouted label so it reads like a name in prose. */
const properName = (label) =>
  label
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

/**
 * Rewrites the play as prose. Every `tagRate`-th speech gets an explicit tag,
 * the rest are bare quotations — which is roughly how a novel behaves.
 */
function synthesise(speeches, tagRate) {
  const parts = [];
  const truth = [];
  const verbs = ["said", "replied", "asked", "answered", "remarked"];

  /**
   * Narration beats every so often. Without them the whole play is one
   * unbroken exchange, and alternation — which deliberately refuses to carry
   * parity across a break in the conversation — never fires at all, leaving
   * the tier that actually writes attributions unmeasured.
   */
  const beats = [
    "The fire had burned low, and nobody moved to see to it. A long while passed in which neither of them found anything to say, and the room grew colder than either would admit. Somewhere below stairs a door was opened and shut again, and then there was nothing.",
    "Outside, a carriage went by and did not stop. The sound of it faded along the street until the quiet came back, heavier than before, and settled over the furniture and the cold tea and the two of them sitting there with nothing resolved between them at all.",
    "There was a pause that neither of them cared to fill. The afternoon light moved slowly across the carpet and reached the edge of the writing desk, where it stopped, and for some minutes the only sound in the room was the clock and the occasional turning of a page.",
    "The clock on the mantel struck, and went on ticking. Nobody counted the hours. A servant passed the doorway, saw how matters stood, and went away again without being asked to, which was the most sensible thing anyone had done in that house all week.",
  ];

  speeches.forEach((speech, i) => {
    const name = properName(speech.speaker);
    // Strip stage directions; they are not speech.
    const body = speech.text.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
    if (!body) return;

    const tagged = i % Math.round(1 / tagRate) === 0;
    const quoted = `“${body}”`;

    parts.push(tagged ? `${quoted} ${verbs[i % verbs.length]} ${name}.` : quoted);
    truth.push({ name, tagged, text: body });

    // A beat roughly every eight speeches, which is about how often a novel
    // breaks a conversation for action or description. Two sentences, because
    // one paragraph of narration has to clear the 300-character gap that
    // separates one exchange from the next — at 259 characters the first
    // attempt at this sat just under it and produced a single 877-line
    // "exchange", which is why alternation never fired.
    if (i > 0 && i % 8 === 0) {
      const b = (i / 8) % beats.length;
      parts.push(`${beats[b]} ${beats[(b + 1) % beats.length]}`);
    }

    /**
     * A scene break every 24 speeches. The cadence is fixed and takes no
     * account of who is speaking — deciding where scenes end by looking at the
     * speaker list would leak the answer into the test and hand the closure
     * tier exactly the two-hander scenes it wants.
     */
    if (i > 0 && i % 24 === 0) parts.push("* * *");
  });

  return { text: `Chapter 1\n\n${parts.join("\n\n")}\n`, truth };
}

// ------------------------------------------------------------- pipeline ----

function run(text) {
  const lines = extractDialogue(text);
  const cast = buildCast(lines);
  const alias = new Map();
  for (const member of cast.members) for (const a of member.aliases) alias.set(a, member.name);

  const genders = inferGenders(text, cast.members);
  const castInfo = cast.members.map((m) => ({
    name: m.name,
    aliases: m.aliases,
    gender: genders.get(m.name)?.gender ?? null,
  }));

  // Scene ranges, so the closure tier can ask who speaks in a whole scene.
  const scenes = detectScenes(text, 0, text.length);
  const sceneOf = (offset) => {
    const found = scenes.findIndex((s) => offset >= s.start && offset < s.end);
    return found === -1 ? null : `s${found}`;
  };

  const anchored = lines.map((line) => ({
    line,
    speaker: line.tag?.kind === "name" ? (alias.get(line.tag.raw) ?? null) : null,
    sceneId: sceneOf(line.start),
  }));

  const method = anchored.map((a) => (a.speaker ? "tag" : null));

  const detail = new Map();
  for (const r of inferByAlternation(anchored)) {
    if (!anchored[r.index].speaker) {
      anchored[r.index].speaker = r.speaker;
      method[r.index] = "alternation";
      detail.set(r.index, { confidence: r.confidence, reasons: [`alternation`] });
    }
  }
  /**
   * Tier 2.2 runs after alternation, so it only sees what alternation could not
   * reach, and its measured accuracy is for that harder remainder rather than
   * for the easy lines tier 2 already took.
   */
  for (const r of closeTwoHanders(anchored, { minAnchorsPerSpeaker: MIN_ANCHORS })) {
    if (!anchored[r.index].speaker) {
      anchored[r.index].speaker = r.speaker;
      method[r.index] = "closure";
      detail.set(r.index, { confidence: r.confidence, reasons: ["closure"] });
    }
  }
  for (const r of resolveByConstraints(anchored, castInfo)) {
    if (!anchored[r.index].speaker) {
      anchored[r.index].speaker = r.speaker;
      method[r.index] = "constraints";
      detail.set(r.index, r);
    }
  }

  return { lines, anchored, method, cast, detail, sceneCount: scenes.length };
}

// ---------------------------------------------------------------- report ----

const raw = normalizeText(stripGutenbergBoilerplate(readFileSync("fixtures/importance-of-being-earnest.txt", "utf8")));
const speeches = parsePlay(raw);
const { text, truth } = synthesise(speeches, TAG_RATE);
const { lines, anchored, method, detail, sceneCount } = run(text);

console.log(`corpus: ${speeches.length} labelled speeches -> ${lines.length} extracted lines`);
console.log(`tag rate: ${(TAG_RATE * 100).toFixed(0)}%  (a novel is around 19%)\n`);

if (lines.length !== truth.length) {
  console.log(`NOTE: extracted ${lines.length} lines from ${truth.length} speeches — comparing by position on the overlap.`);
}

const stats = {};
const bump = (m, key) => {
  stats[m] ??= { right: 0, wrong: 0 };
  stats[m][key]++;
};

const wrongSamples = [];
const n = Math.min(lines.length, truth.length);
for (let i = 0; i < n; i++) {
  const predicted = anchored[i].speaker;
  const actual = truth[i].name;
  const m = method[i] ?? "none";
  if (!predicted) {
    bump("unattributed", "wrong");
    continue;
  }
  if (predicted === actual) bump(m, "right");
  else {
    bump(m, "wrong");
    if (wrongSamples.length < 8) wrongSamples.push({ m, predicted, actual, text: truth[i].text.slice(0, 54) });
  }
}

console.log("method          correct   wrong   accuracy");
console.log("-".repeat(48));
let totalRight = 0;
let totalPredicted = 0;
for (const [m, s] of Object.entries(stats)) {
  if (m === "unattributed") continue;
  const total = s.right + s.wrong;
  totalRight += s.right;
  totalPredicted += total;
  console.log(
    `${m.padEnd(15)} ${String(s.right).padStart(7)} ${String(s.wrong).padStart(7)}   ${((100 * s.right) / total).toFixed(1)}%`,
  );
}
console.log("-".repeat(48));
const unattributed = stats.unattributed?.wrong ?? 0;
console.log(`attributed      ${String(totalRight).padStart(7)} ${String(totalPredicted - totalRight).padStart(7)}   ${((100 * totalRight) / totalPredicted).toFixed(1)}%  <- precision`);
console.log(`unattributed    ${String(unattributed).padStart(15)}`);
console.log(`coverage        ${((100 * totalPredicted) / n).toFixed(1)}%   of ${n} lines`);
console.log(`end-to-end      ${((100 * totalRight) / n).toFixed(1)}%   right out of every line`);

// How well does the confidence score actually separate right from wrong? If it
// does not, the score is decoration and the tier cannot be trusted at any
// threshold.
const buckets = new Map();
for (let i = 0; i < n; i++) {
  const r = detail.get(i);
  if (!r) continue;
  const key = `${(method[i] ?? "?").padEnd(12)} @ ${r.confidence.toFixed(2)}`;
  const bucket = buckets.get(key) ?? { right: 0, wrong: 0 };
  if (anchored[i].speaker === truth[i].name) bucket.right++;
  else bucket.wrong++;
  buckets.set(key, bucket);
}

if (buckets.size > 0) {
  console.log("\ninferred answers, by the confidence we assigned:");
  for (const [key, b] of [...buckets.entries()].sort()) {
    const total = b.right + b.wrong;
    console.log(`  ${key.padEnd(26)} ${String(b.right).padStart(4)} right ${String(b.wrong).padStart(4)} wrong   ${((100 * b.right) / total).toFixed(1)}%`);
  }
}

if (wrongSamples.length) {
  console.log("\nwrong answers:");
  for (const w of wrongSamples) {
    console.log(`  [${w.m}] said ${w.predicted}, actually ${w.actual}`);
    console.log(`     ${JSON.stringify(w.text)}`);
  }
}
