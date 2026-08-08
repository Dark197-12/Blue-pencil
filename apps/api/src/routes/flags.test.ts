import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { prisma } from "../db.js";
import { as, makeApp, seedManuscript, signUp, type TestUser } from "../test/helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
});

async function scene() {
  const user = await signUp(app);
  const seeded = await seedManuscript(user.id);
  return { user, seeded, projectId: seeded.project.id };
}

const flagsOf = (body: unknown) =>
  (body as { flags: Array<{ id: string; character: { name: string }; dismissedAt: string | null }> }).flags;

describe("flag detection", () => {
  it("finds the character who changes and leaves the consistent one alone", async () => {
    const { user, projectId } = await scene();

    const recompute = await as(app, user, {
      method: "POST",
      url: `/api/projects/${projectId}/flags/recompute`,
    });
    expect(recompute.statusCode).toBe(200);
    expect(recompute.json().flagCount).toBeGreaterThan(0);

    const list = await as(app, user, { method: "GET", url: `/api/projects/${projectId}/flags` });
    const flags = flagsOf(list.json());

    // Ada goes clipped in her last scene; Bram never changes.
    expect(flags.map((f) => f.character.name)).toContain("Ada");
    expect(flags.map((f) => f.character.name)).not.toContain("Bram");
  });

  it("runs detection on the first visit rather than showing an empty inbox", async () => {
    // An empty page behind a button reads as "nothing wrong" when it means
    // "nothing looked at".
    const { user, projectId } = await scene();

    const list = await as(app, user, { method: "GET", url: `/api/projects/${projectId}/flags` });

    expect(list.json().computedAt).not.toBeNull();
    expect(flagsOf(list.json()).length).toBeGreaterThan(0);
  });

  it("states what it measured and how much evidence sits behind it", async () => {
    const { user, projectId } = await scene();
    const list = await as(app, user, { method: "GET", url: `/api/projects/${projectId}/flags` });
    const flag = list.json().flags[0];

    expect(flag.summary).toContain("Ada");
    expect(flag.evidence.length).toBeGreaterThan(0);
    expect(flag.evidence[0].label).toBeTruthy();
    expect(flag.sceneWordCount).toBeGreaterThan(0);
    // The scene under judgement is excluded from what it is judged against.
    expect(flag.baselineSceneCount).toBe(7);
  });
});

describe("dismissal", () => {
  it("keeps a dismissal through a recompute", async () => {
    // The measurements are derived and may be rewritten freely. The author's
    // judgement that a difference is deliberate is not.
    const { user, projectId } = await scene();

    const before = await as(app, user, { method: "GET", url: `/api/projects/${projectId}/flags` });
    const flagId = flagsOf(before.json())[0]!.id;

    await as(app, user, {
      method: "PATCH",
      url: `/api/projects/${projectId}/flags/${flagId}`,
      payload: { dismissed: true },
    });

    await as(app, user, { method: "POST", url: `/api/projects/${projectId}/flags/recompute` });

    const after = await as(app, user, { method: "GET", url: `/api/projects/${projectId}/flags` });
    expect(flagsOf(after.json()).map((f) => f.id)).not.toContain(flagId);
    expect(after.json().dismissedCount).toBe(1);

    const dismissed = await as(app, user, {
      method: "GET",
      url: `/api/projects/${projectId}/flags?status=dismissed`,
    });
    expect(flagsOf(dismissed.json()).map((f) => f.id)).toContain(flagId);
  });

  it("can be taken back", async () => {
    const { user, projectId } = await scene();
    const before = await as(app, user, { method: "GET", url: `/api/projects/${projectId}/flags` });
    const flagId = flagsOf(before.json())[0]!.id;

    for (const dismissed of [true, false]) {
      await as(app, user, {
        method: "PATCH",
        url: `/api/projects/${projectId}/flags/${flagId}`,
        payload: { dismissed },
      });
    }

    const after = await as(app, user, { method: "GET", url: `/api/projects/${projectId}/flags` });
    expect(flagsOf(after.json()).map((f) => f.id)).toContain(flagId);
  });

  it("forgets a dismissed flag once the difference is gone", async () => {
    // A dismissal records a judgement about a difference. Remove the
    // difference and there is nothing left to have judged.
    const { user, seeded, projectId } = await scene();

    const before = await as(app, user, { method: "GET", url: `/api/projects/${projectId}/flags` });
    const flagId = flagsOf(before.json())[0]!.id;
    await as(app, user, {
      method: "PATCH",
      url: `/api/projects/${projectId}/flags/${flagId}`,
      payload: { dismissed: true },
    });

    // Make Ada's last scene sound like all the others.
    const lastScene = seeded.scenes[seeded.scenes.length - 1]!;
    await prisma.dialogueLine.updateMany({
      where: { sceneId: lastScene.id, characterId: seeded.characters.ada.id },
      data: {
        text: "I am aware of the circumstances, and I would be grateful if you would refrain from that observation.",
      },
    });

    await as(app, user, { method: "POST", url: `/api/projects/${projectId}/flags/recompute` });

    const after = await as(app, user, {
      method: "GET",
      url: `/api/projects/${projectId}/flags?status=all`,
    });
    expect(flagsOf(after.json()).map((f) => f.id)).not.toContain(flagId);
  });

  it("refuses a flag id from another manuscript", async () => {
    const { user, projectId } = await scene();
    const other = await seedManuscript(user.id, { title: "Another Manuscript" });
    await as(app, user, { method: "POST", url: `/api/projects/${other.project.id}/flags/recompute` });

    const otherFlag = await prisma.voiceFlag.findFirst({ where: { projectId: other.project.id } });
    const response = await as(app, user, {
      method: "PATCH",
      url: `/api/projects/${projectId}/flags/${otherFlag!.id}`,
      payload: { dismissed: true },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("sensitivity", () => {
  it("finds more at a lower threshold and less at a higher one", async () => {
    const { user, projectId } = await scene();

    const loose = await as(app, user, {
      method: "PATCH",
      url: `/api/projects/${projectId}/flags/settings`,
      payload: { flagThreshold: 2 },
    });
    const strict = await as(app, user, {
      method: "PATCH",
      url: `/api/projects/${projectId}/flags/settings`,
      payload: { flagThreshold: 4 },
    });

    expect(loose.json().flagCount).toBeGreaterThanOrEqual(strict.json().flagCount);
  });

  it("refuses a threshold outside the range where it means anything", async () => {
    // Below 2, fifteen metrics per scene raise about one false flag per scene
    // from noise alone. Above 4 nothing survives, which reads as a clean
    // manuscript and is the worse failure.
    const { user, projectId } = await scene();

    for (const flagThreshold of [0.5, 9]) {
      const response = await as(app, user, {
        method: "PATCH",
        url: `/api/projects/${projectId}/flags/settings`,
        payload: { flagThreshold },
      });
      expect(response.statusCode, String(flagThreshold)).toBe(400);
    }
  });

  it("drops a metric the author has switched off", async () => {
    const { user, projectId } = await scene();

    const before = await as(app, user, { method: "GET", url: `/api/projects/${projectId}/flags` });
    const measured: string[] = before
      .json()
      .flags.flatMap((f: { evidence: Array<{ metric: string }> }) => f.evidence.map((e) => e.metric));

    const response = await as(app, user, {
      method: "PATCH",
      url: `/api/projects/${projectId}/flags/settings`,
      payload: { ignoredMetrics: [measured[0]] },
    });
    expect(response.statusCode).toBe(200);

    const after = await as(app, user, { method: "GET", url: `/api/projects/${projectId}/flags` });
    const remaining: string[] = after
      .json()
      .flags.flatMap((f: { evidence: Array<{ metric: string }> }) => f.evidence.map((e) => e.metric));
    expect(remaining).not.toContain(measured[0]);
  });

  it("rejects a metric that does not exist", async () => {
    const { user, projectId } = await scene();
    const response = await as(app, user, {
      method: "PATCH",
      url: `/api/projects/${projectId}/flags/settings`,
      payload: { ignoredMetrics: ["vibes"] },
    });
    expect(response.statusCode).toBe(400);
  });
});
