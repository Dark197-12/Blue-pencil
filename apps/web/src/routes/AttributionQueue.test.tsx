import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AttributionQueue } from "./AttributionQueue";
import { api, type QueueItem } from "../api";

/**
 * The queue is worked by keyboard — a thousand lines is not a mouse job — so
 * the shortcuts are the feature, not a convenience. They live in a window-level
 * listener, which is exactly the kind of thing that breaks without any type or
 * build error to show for it.
 */

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      getAttributionQueue: vi.fn(),
      getAttributionStats: vi.fn(),
      assignSpeaker: vi.fn(),
      reinferSpeakers: vi.fn(),
    },
  };
});

const item = (id: string): QueueItem => ({
  id,
  startOffset: 0,
  text: `Line ${id}`,
  wordCount: 5,
  speakerRaw: null,
  speakerKind: null,
  method: null,
  confidence: null,
  character: null,
  context: { before: "before", after: "after" },
  candidates: [
    { id: "ada", name: "Ada", nearbyCount: 3, totalLines: 40 },
    { id: "bram", name: "Bram", nearbyCount: 1, totalLines: 20 },
  ],
});

function renderQueue() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AttributionQueue projectId="p1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Call records persist across tests otherwise, so "was not called" would pass
  // or fail depending on what ran before it.
  vi.clearAllMocks();

  vi.mocked(api.getAttributionQueue).mockResolvedValue({
    total: 2,
    offset: 0,
    limit: 20,
    filter: "unattributed",
    items: [item("l1"), item("l2")],
  });
  vi.mocked(api.getAttributionStats).mockResolvedValue({
    total: 100,
    tag: 20,
    alternation: 10,
    closure: 5,
    constraints: 5,
    llm: 0,
    manual: 0,
    unattributed: 60,
    uncertain: 10,
  });
  vi.mocked(api.assignSpeaker).mockResolvedValue({
    line: { id: "l1", character: { id: "ada", name: "Ada" } },
  });
});

describe("keyboard shortcuts", () => {
  it("assigns the nth candidate when the nth number key is pressed", async () => {
    renderQueue();
    await screen.findByText(/Line l1/);

    fireEvent.keyDown(window, { key: "2" });

    await waitFor(() =>
      // 2 is the second candidate in the displayed order, not an id or an index
      // into the whole cast.
      expect(api.assignSpeaker).toHaveBeenCalledWith("p1", "l1", "bram"),
    );
  });

  it("ignores a number with no candidate behind it", async () => {
    renderQueue();
    await screen.findByText(/Line l1/);

    fireEvent.keyDown(window, { key: "9" });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.assignSpeaker).not.toHaveBeenCalled();
  });

  it("clears the speaker on U rather than guessing one", async () => {
    renderQueue();
    await screen.findByText(/Line l1/);

    fireEvent.keyDown(window, { key: "u" });

    await waitFor(() => expect(api.assignSpeaker).toHaveBeenCalledWith("p1", "l1", null));
  });

  it("moves to the next line on J without assigning anything", async () => {
    renderQueue();
    await screen.findByText(/Line l1/);

    fireEvent.keyDown(window, { key: "j" });

    await screen.findByText(/Line l2/);
    expect(api.assignSpeaker).not.toHaveBeenCalled();
  });

  it("moves back on K", async () => {
    renderQueue();
    await screen.findByText(/Line l1/);

    fireEvent.keyDown(window, { key: "j" });
    await screen.findByText(/Line l2/);
    fireEvent.keyDown(window, { key: "k" });

    await screen.findByText(/Line l1/);
  });

  it("stays on the first line when K is pressed at the top", async () => {
    renderQueue();
    await screen.findByText(/Line l1/);

    fireEvent.keyDown(window, { key: "k" });

    await screen.findByText(/Line l1/);
  });

  it("leaves typing alone while a text field has focus", async () => {
    // Someone renaming a character must be able to type "u" and "2".
    renderQueue();
    await screen.findByText(/Line l1/);

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "2" });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.assignSpeaker).not.toHaveBeenCalled();
    input.remove();
  });

  it("stops listening once the queue is unmounted", async () => {
    const { unmount } = renderQueue();
    await screen.findByText(/Line l1/);

    unmount();
    fireEvent.keyDown(window, { key: "1" });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.assignSpeaker).not.toHaveBeenCalled();
  });
});
