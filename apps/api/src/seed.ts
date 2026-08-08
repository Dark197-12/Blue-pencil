import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { countWords, normalizeText, stripGutenbergBoilerplate } from "@bp/analysis";

import { prisma } from "./db.js";
import { hashPassword } from "./password.js";
import { rebuildStructure } from "./ingest/structure.js";
import { extractProjectDialogue } from "./ingest/dialogue.js";

/**
 * Seeds a fully processed manuscript for development and demonstration.
 *
 * Every screen is empty until a manuscript has been uploaded, its chapters
 * confirmed, its cast approved and several hundred lines attributed, so a fresh
 * database shows nothing of what the tool does.
 *
 * Pride and Prejudice is the fixture: public domain, and a cast well known
 * enough that the measurements can be sanity-checked by eye. It is also a hard
 * case — crowded rooms, few speech tags, and inset letters that defeat naive
 * scene detection.
 *
 *   pnpm --filter @bp/api seed
 */

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "../../../fixtures/pride-and-prejudice.txt");

const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "demo@bluepencil.local";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "demo-pencil-2026";

async function main() {
  const raw = readFileSync(FIXTURE, "utf8");
  const text = normalizeText(stripGutenbergBoilerplate(raw));
  const wordCount = countWords(text);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, passwordHash: await hashPassword(DEMO_PASSWORD) },
  });

  // Re-seeding replaces the demo project rather than adding another, so this
  // can be run repeatedly without the account filling up with copies.
  await prisma.project.deleteMany({ where: { userId: user.id, title: "Pride and Prejudice" } });

  const project = await prisma.project.create({
    data: {
      userId: user.id,
      title: "Pride and Prejudice",
      author: "Jane Austen",
      sourceText: text,
      wordCount,
      sourceFormat: "txt",
      sourceFilename: "pride-and-prejudice.txt",
    },
  });

  process.stdout.write(`${wordCount.toLocaleString()} words\n`);

  const chapterCount = await rebuildStructure(project.id, text);
  process.stdout.write(`${chapterCount} chapters\n`);

  // Marked confirmed so the seeded project opens straight onto the analysis.
  // The structure and cast review screens remain reachable from the interface.
  await prisma.project.update({
    where: { id: project.id },
    data: { structureConfirmedAt: new Date() },
  });

  const dialogue = await extractProjectDialogue(project.id, text);
  process.stdout.write(
    `${dialogue.lineCount.toLocaleString()} lines of dialogue, ${dialogue.characterCount} characters proposed\n`,
  );
  process.stdout.write(
    `attributed: ${JSON.stringify(dialogue.byMethod)} (${Math.round((dialogue.attributedCount / dialogue.lineCount) * 100)}%)\n`,
  );

  await prisma.character.updateMany({
    where: { projectId: project.id },
    data: { isConfirmed: true },
  });

  process.stdout.write(`\nSign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}\n`);
}

main()
  .catch((error) => {
    process.exitCode = 1;
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  })
  .finally(() => prisma.$disconnect());
