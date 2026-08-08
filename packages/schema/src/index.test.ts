import { describe, expect, it } from "vitest";
import { snapshotName } from "./index.js";

/**
 * Both the snapshot writer and the browser call this. If they ever disagreed
 * the demo would 404 on one endpoint while every other page worked, so the
 * properties that matter are determinism and the absence of collisions between
 * requests that return different answers.
 */
describe("snapshotName", () => {
  it("is stable for the same URL", () => {
    expect(snapshotName("/api/projects/abc/voice")).toBe(snapshotName("/api/projects/abc/voice"));
  });

  it("produces a filename safe on any filesystem", () => {
    const name = snapshotName("/api/projects/abc/chapters/xyz/dialogue?limit=20");
    expect(name).toMatch(/^[a-z0-9-]+\.json$/);
  });

  it("keeps different paths apart", () => {
    expect(snapshotName("/api/projects/a")).not.toBe(snapshotName("/api/projects/b"));
    expect(snapshotName("/api/projects/a/voice")).not.toBe(snapshotName("/api/projects/a/arcs"));
  });

  it("keeps query strings apart, because they change the response", () => {
    // ?status=open and ?status=dismissed are different answers from one path.
    expect(snapshotName("/api/projects/a/flags?status=open")).not.toBe(
      snapshotName("/api/projects/a/flags?status=dismissed"),
    );
    expect(snapshotName("/api/projects/a/voice?includeInferred=true")).not.toBe(
      snapshotName("/api/projects/a/voice?includeInferred=false"),
    );
  });

  it("distinguishes a path from the same path with a query", () => {
    expect(snapshotName("/api/projects/a/flags")).not.toBe(
      snapshotName("/api/projects/a/flags?status=open"),
    );
  });

  it("drops the /api prefix every route shares", () => {
    expect(snapshotName("/api/auth/me")).toBe("auth-me.json");
  });

  it("never yields a name that is only an extension", () => {
    // A slug of nothing would collide with any other empty slug.
    expect(snapshotName("/api/")).toBe("root.json");
    expect(snapshotName("/")).toBe("root.json");
  });

  it("does not begin or end with a separator", () => {
    const name = snapshotName("/api/projects/a/");
    expect(name.startsWith("-")).toBe(false);
    expect(name).not.toContain("-.json");
  });

  it("is case-insensitive in a way that cannot collide on case-insensitive disks", () => {
    // Windows and macOS treat A.json and a.json as one file; lowercasing makes
    // that explicit rather than leaving it to the filesystem.
    expect(snapshotName("/api/projects/ABC")).toBe(snapshotName("/api/projects/ABC").toLowerCase());
  });
});
