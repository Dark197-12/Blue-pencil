import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Demo mode is a substitution at the network boundary. These tests pin the two
 * halves of the contract: reads resolve to the recorded file for that URL, and
 * writes are refused rather than silently succeeding — a demo that appeared to
 * accept an edit and then lost it would be worse than one that declines.
 *
 * `isDemo` is read at module load, so each test imports the modules fresh with
 * the flag already set.
 */

const load = async (demo: boolean) => {
  vi.resetModules();
  vi.stubEnv("VITE_DEMO", demo ? "1" : "0");
  const api = await import("./api");
  const demoModule = await import("./demo");
  return { ...api, ...demoModule };
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("demo mode", () => {
  it("is off unless the flag is set", async () => {
    const { isDemo } = await load(false);
    expect(isDemo).toBe(false);
  });

  it("serves a read from the recorded file for that URL", async () => {
    const { api, isDemo } = await load(true);
    expect(isDemo).toBe(true);

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ user: { id: "u1", email: "demo@example.test" } }),
    } as Response);

    const result = await api.me();
    expect(result.user?.email).toBe("demo@example.test");

    const requested = vi.mocked(fetch).mock.calls[0]![0];
    expect(String(requested)).toContain("/demo/auth-me.json");
  });

  it("keeps the query string in the filename, since it changes the answer", async () => {
    const { api } = await load(true);
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ flags: [] }) } as Response);

    await api.getFlags("p1", "dismissed");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain("flags-status-dismissed.json");
  });

  it("refuses a write instead of pretending it worked", async () => {
    const { api, DEMO_WRITE_MESSAGE } = await load(true);

    await expect(api.dismissFlag("p1", "f1", true)).rejects.toMatchObject({
      status: 403,
      message: DEMO_WRITE_MESSAGE,
    });
    // Nothing was even attempted over the network.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses every write verb, not just POST", async () => {
    const { api } = await load(true);

    await expect(api.createProject({ title: "New" })).rejects.toMatchObject({ status: 403 });
    await expect(api.deleteProject("p1")).rejects.toMatchObject({ status: 403 });
    await expect(api.confirmStructure("p1")).rejects.toMatchObject({ status: 403 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("explains a missing recording rather than throwing a parse error", async () => {
    const { api } = await load(true);
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response);

    await expect(api.getArcs("p1")).rejects.toMatchObject({ status: 404 });
  });

  it("calls the real API when demo mode is off", async () => {
    const { api } = await load(false);
    vi.mocked(fetch).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ user: null }),
    } as Response);

    await api.me();
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain("/api/auth/me");
  });
});
