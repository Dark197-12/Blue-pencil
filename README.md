# Blue Pencil

Measure how each character in a manuscript speaks, and catch the moments they stop
sounding like themselves.

Upload a novel; Blue Pencil works out who says what, builds a statistical fingerprint
of every character's voice, and flags passages where someone drifts away from their
own baseline — while telling you exactly which baseline it used and how much dialogue
backs it.

```bash
pnpm install && pnpm db:migrate && pnpm seed:demo && pnpm dev
```

That seeds *Pride and Prejudice*, fully processed, so there is something to look at
immediately. Sign in as `demo@bluepencil.local` / `demo-pencil-2026`.

## What it actually does

**Ingest** `.txt`, `.md`, `.docx` and `.epub`, then find chapters and scenes. The
whole manuscript is stored once and everything else indexes into it by character
offset, so structure can be re-detected or hand-corrected without ever touching the
author's words.

**Attribute** every line of dialogue to a speaker, through four tiers of decreasing
certainty — and record which tier answered, because that determines what the line is
allowed to be used for.

**Measure** fifteen aspects of a voice: sentence length and its variation,
contractions, Latinate vocabulary, hedges, intensifiers, questions, exclamations,
interruptions, reading grade, and vocabulary richness corrected for sample size.

**Compare** each character against the cast, against their own scene-to-scene range,
across the book, and across the people they speak to.

## The interesting parts

### Attribution is measured, not assumed

Every tier's accuracy is measured against known answers by
[`scripts/eval-attribution.mjs`](scripts/eval-attribution.mjs), which synthesises a
novel-shaped corpus from *The Importance of Being Earnest* — a play, so every speech
is already labelled with its speaker.

| Tier                   | How it works                                        | Accuracy  |
| ---------------------- | --------------------------------------------------- | --------- |
| 1 · speech tags        | The prose names the speaker outright                | **100%**  |
| 2 · alternation        | Two named speakers in one exchange; fill by parity  | **75.2%** |
| 2.2 · two-hander close | Identity from the conversation, parity from the exchange | **78.4%** |
| 2.5 · constraints      | Eliminate candidates by gender, mentions, who just spoke | **59.3%** |

End to end that is 83.4% coverage at 81.4% precision on the eval corpus, and 39% on
*Pride and Prejudice*, which is far harder: crowded rooms and few speech tags.

An earlier version scored each line's confidence individually. The eval showed that
score was not merely useless but **inverted** — the 0.72 band was right 71% of the
time while the 0.68 band was right 80%. Per-line confidence was deleted and replaced
with measured per-method accuracy. Invented precision is worse than none, because
everything downstream believes it.

### A wrong speaker is worse than an absent one

This governs the whole codebase. When inference is wrong, the line almost always
belongs to *the other person in the conversation* — precisely the character a voice
comparison most needs kept separate. So voice profiles, baselines, flags and arcs are
built from speech tags and hand corrections only.

But speaker identity does two different jobs, and only one needs that standard of
proof. Deciding *whose voice this is* demands near-certainty. Deciding *who else is
in the room* does not — misattributing a line within a two-hander still names someone
who was there. So inferred lines establish scene composition and are excluded from
measurement.

### Things that hide inside their own yardstick

Two bugs of the same shape, found by measurement rather than by reading the code.

**A scene concealed itself in its own baseline.** Judging a scene against a
distribution that includes it pulls the mean toward the outlier and inflates the
spread — enough to drop a *doubling* of sentence length to 2.48 deviations, under a
2.5 threshold. The more extreme the scene, the better it hid. Baselines are now
leave-one-out.

**Per-interlocutor voice concealed itself in the character's spread.** If someone's
register really does depend on who they're addressing, their scene-to-scene spread is
largely *made of* that effect. Measuring against it hides the finding inside the
ruler. The comparison is now against variation *within* each relationship, pooled
across relationships.

### Statistical significance is not enough

Every flag must pass two tests. A z-threshold, and a minimum effect size per metric.
A metronomically consistent character has a tiny spread, so a trivial change lands
three deviations out — statistically real, inaudible on the page. A tool that reports
those gets switched off, and then it catches nothing at all.

The default threshold of 2.5 rather than 2.0 is deliberate: fifteen metrics per scene
means a threshold of 2 raises roughly one false flag per scene from noise alone. On
*Pride and Prejudice* the result is eight flags in the whole novel, among them Darcy
and Elizabeth in chapter 34 — the first proposal — each detected independently.

### Every number is answerable

A measurement a writer cannot check is worth very little. Each measure in a voice
profile expands to the passages that most exemplify it, at both ends. Both ends,
because the top shows what the number is made of and the bottom shows whether it is a
habit or one outlier dragging an average. Mr. Collins's *least* long-winded speech
still runs to 26 words per sentence — above every other character's average.

### Small-sample statistics, honestly

- **Partial pooling.** A character's own spread, estimated from six scenes, is wildly
  uncertain and occasionally near zero by luck. Each is blended toward the cast median
  by how much evidence backs it.
- **Exact critical values.** Arc detection uses a table of Spearman critical values
  rather than the large-sample approximation, which is badly wrong at novel-sized
  samples — at eight scenes the real bar is 0.738 where the approximation waves
  through 0.71.
- **Length-corrected richness.** Unique-words-over-total falls as a sample grows,
  purely arithmetically, so every minor character would look richer than the
  protagonist. MATTR instead.

## What it does not do

Stated plainly, because "found nothing" and "couldn't look" are different answers and
only one means your book is fine.

- **Arc and relationship analysis needs far more attributed dialogue than the profiles
  do.** On *Pride and Prejudice*, 0 of 59 scenes have every speaker identified, so
  relationship coverage is thin and no arcs are reported. The app says so on the page
  rather than showing an empty panel. The fix is queue work, not a threshold change.
- **No LLM tier.** Tier 3 was designed and deliberately left unbuilt — the goal was to
  see how far free, deterministic signals go. The schema and UI already reserve
  `method: "llm"`.
- **English only.** Contraction and formality heuristics don't port.

## Stack

TypeScript throughout, pnpm workspace.

| Path                | What it is                                                            |
| ------------------- | --------------------------------------------------------------------- |
| `packages/analysis` | Pure functions — structure, dialogue, metrics, baselines, flags, arcs. No I/O, 265 tests. |
| `packages/schema`   | Zod contracts shared by the API and the web app.                      |
| `apps/api`          | Fastify 5 + Prisma 6 + Postgres. Session auth, rate limiting. 41 route tests against a real database. |
| `apps/web`          | Vite 6 + React + TanStack Query.                                      |
| `fixtures/`         | Public-domain Gutenberg texts, committed so tests run offline.         |

Passwords use Node's built-in `scrypt`, avoiding a native build step. Sessions are
stored server-side; the cookie carries an opaque id, so signing out actually ends the
session.

## Running it

**Requires:** Node 20+, pnpm 11 (`corepack enable`), and Postgres 14+.

No local Postgres? [Neon](https://neon.tech) has a free tier that needs no card and
works with the connection string as-is.

```bash
pnpm install

# Environment lives per app, not at the repo root: the Prisma CLI reads .env
# from beside its schema, so keeping it there means migrations and the server
# can never disagree about which database they point at.
cp apps/api/.env.example apps/api/.env    # DATABASE_URL + SESSION_SECRET
cp apps/web/.env.example apps/web/.env    # VITE_API_URL

# Generate a SESSION_SECRET:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

createdb bluepencil          # or CREATE DATABASE bluepencil; in psql
pnpm db:migrate
pnpm seed:demo               # optional: a fully processed Pride and Prejudice
pnpm dev                     # api on :3001, web on :5173
```

Other commands:

```bash
pnpm test                              # 306 tests
pnpm typecheck
pnpm build
pnpm db:studio                         # browse the database
node scripts/eval-attribution.mjs      # measure attribution against ground truth
```

The API route tests need Postgres too. They create and migrate their own
`bluepencil_test` database on first run, truncate it between tests, and refuse to
start against a database whose name does not end in `_test`.

## Deploying

Live on [Render](https://render.com) free tier with Postgres on
[Neon](https://neon.tech). Neither needs a payment method.

One service: Fastify serves the built browser app alongside the API, so both sit
on the same origin. That keeps the session cookie a plain `SameSite=Lax` one — a
split deployment would need `SameSite=None`, which Safari and Brave restrict,
producing sign-outs that only reproduce on someone else’s machine — and it means
CORS never applies and there is one deployable rather than two kept in step.

The database is on Neon rather than Render because Render’s own free Postgres
expires after 30 days, and a portfolio link that dies after a month is worse than
no link.

**1. Database.** Create a project at neon.tech and copy the connection string.

**2. Migrate it from here.** Free Render instances have no shell, but Neon is
reachable from anywhere, so migrations run from your machine:

```powershell
$env:DATABASE_URL = "postgresql://...?sslmode=require"
pnpm --filter @bp/api exec prisma migrate deploy
pnpm seed:demo          # optional: the worked Pride and Prejudice example
Remove-Item Env:\DATABASE_URL
```

`prisma migrate deploy` only applies migrations that already exist — it can
never invent one or prompt. Note that `.env` does not override a variable
already set in the shell, so the line above genuinely points at Neon.

**3. Service.** In Render, *New → Blueprint*, point it at this repository. It
reads `render.yaml` and asks for the two values that are deliberately not
committed:

| Variable        | Value                                             |
| --------------- | ------------------------------------------------- |
| `DATABASE_URL` | the Neon connection string                        |
| `WEB_ORIGIN`   | the hostname Render assigns, e.g. `https://blue-pencil.onrender.com` |

`SESSION_SECRET` is generated by Render once and kept across deploys.

Redeploy after setting `WEB_ORIGIN`, since the first build happens before the
hostname exists.

**Free-tier behaviour worth knowing:** the instance sleeps after 15 minutes of
inactivity and takes the better part of a minute to wake, so a reviewer opening
a cold link waits. Every later request is normal speed.

## Test fixtures

| File                              | Role                                                         |
| --------------------------------- | ------------------------------------------------------------ |
| `pride-and-prejudice.txt`         | Primary. Dialogue-dense, famously distinct voices, genuinely hard to attribute. |
| `importance-of-being-earnest.txt` | A play — every line pre-labelled with its speaker, which makes it **ground truth for measuring attribution accuracy**. |
| `huckleberry-finn.txt`            | Stress test. Heavy dialect and nonstandard spelling.          |

The eval corpus is synthetic, and that is a real limitation: a play is almost entirely
two-hander dialogue with little narration, which flatters alternation. Treat the
numbers as an upper bound and as a regression guard, not as what a novel scores.

## Build log

| Phase | Scope                                                            |
| ----- | ---------------------------------------------------------------- |
| 0     | Monorepo, database, auth                                         |
| 1     | Ingest four formats; chapter and scene structure                 |
| 2     | Dialogue extraction, speech-tag attribution, cast and aliases     |
| 3     | Alternation and constraint inference, review queue, eval harness  |
| 4     | Metrics engine                                                   |
| 5     | Leave-one-out baselines, partial pooling, flag generation        |
| 6     | Voice arcs across the book, voice by interlocutor                |
| 6.5   | Re-runnable inference, two-hander closure tier                   |
| 7     | Evidence: the lines behind every number                          |
| 8     | Rate limiting, demo seed, performance pass                       |
