# Blue Pencil

Measure how each character in a manuscript speaks, and catch the moments they stop
sounding like themselves.

Upload a novel; Blue Pencil works out who says what, builds a statistical fingerprint
of every character's voice, and flags passages where someone drifts away from their
own baseline — while telling you exactly which baseline it used and how much dialogue
backs it.

> **Status: Phase 0 of 8.** The skeleton — auth, projects, deployment — is in place.
> Manuscript ingestion is next. See [Roadmap](#roadmap).

## Why it's interesting

Most of the work isn't CRUD:

- **Dialogue attribution** — deciding who spoke an unattributed line. Three tiers:
  explicit speech tags, alternation inference inside two-speaker runs, and an LLM
  pass for the rest (action beats, pronouns, crowded scenes). Every attribution
  carries a method and a confidence, so weak attributions can be excluded from the
  statistics rather than quietly poisoning them.
- **Partial-pooled baselines** — a character has a global voice baseline, and
  optionally per-arc and per-interlocutor refinements. Those segments are often
  small, so estimates from thin data are shrunk toward the character's global mean
  instead of being trusted at face value. Every flag names the baseline it used and
  the word count behind it.
- **Changepoint detection** — a character's voice legitimately changes across a
  book. Blue Pencil detects the shift, asks whether it was intentional, and splits
  the baseline rather than flagging the whole back half as inconsistent.

## Stack

TypeScript throughout, pnpm workspace.

| Path                | What it is                                                    |
| ------------------- | ------------------------------------------------------------- |
| `packages/analysis` | Pure functions — metrics, baselines, flagging. No I/O, heavily tested. |
| `packages/schema`   | Zod contracts shared by the API and the web app.               |
| `apps/api`          | Fastify + Prisma + Postgres. Session auth, background jobs.    |
| `apps/web`          | Vite + React + TanStack Query.                                 |
| `fixtures/`         | Public-domain Gutenberg texts used by the tests.               |

## Running it

**Requires:** Node 20+, pnpm 11 (`corepack enable`), and a Postgres 14+ database.

No local Postgres? [Neon](https://neon.tech) has a free tier that needs no card and
works with the connection string as-is.

```bash
pnpm install

cp .env.example .env         # then fill in DATABASE_URL and SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # SESSION_SECRET

pnpm db:generate             # Prisma client
pnpm db:migrate              # create the tables
pnpm dev                     # api on :3001, web on :5173
```

Other commands:

```bash
pnpm test         # all tests
pnpm typecheck    # all packages
pnpm build        # production build
pnpm db:studio    # browse the database
```

## Test fixtures

`fixtures/` holds three public-domain novels, committed so the suite runs offline
with deterministic input:

| File                              | Role                                                         |
| --------------------------------- | ------------------------------------------------------------ |
| `pride-and-prejudice.txt`         | Primary. Dialogue-dense, clean speech tags, famously distinct voices. |
| `importance-of-being-earnest.txt` | A play — every line is pre-labelled with its speaker, which makes it **ground truth for measuring attribution accuracy**. |
| `huckleberry-finn.txt`            | Stress test. Heavy dialect and nonstandard spelling.          |

## Roadmap

| Phase | Scope                                                       | Status |
| ----- | ----------------------------------------------------------- | ------ |
| 0     | Monorepo, database, auth, deployment                        | ✅     |
| 1     | Ingest `.txt` / `.md` / `.docx` / `.epub`; chapter + scene structure | next   |
| 2     | Dialogue extraction, speech-tag attribution, cast + aliases  |        |
| 3     | Alternation inference, LLM attribution pass, review queue    |        |
| 4     | Metrics engine                                              |        |
| 5     | Baselines, partial pooling, flag generation                 |        |
| 6     | Arc changepoint detection, per-interlocutor baselines        |        |
| 7     | Voice profile and cast comparison views                      |        |
| 8     | Public demo, performance pass, polish                       |        |

## Notes

- Passwords are hashed with Node's built-in `scrypt`, avoiding a native build step.
- Sessions are stored server-side; the cookie carries an opaque id, so signing out
  actually ends the session.
- English only. Contraction and formality heuristics don't port to other languages.
