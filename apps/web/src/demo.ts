import { snapshotName } from "@bp/schema";

/**
 * Read-only demo mode.
 *
 * Blue Pencil's read endpoints are pure functions of a stored manuscript, so
 * their answers can be recorded once and served as files. That is what makes a
 * live demo possible with no server and no database behind it — which matters
 * because every free container host this project tried either wanted a card or
 * was shutting down, while static hosting is free everywhere.
 *
 * The substitution happens at the single point where the app talks to the
 * network. Every screen, query and component above that line is unchanged and
 * cannot tell the difference, which is the only reason this is worth doing:
 * a demo built from a separate cut-down copy of the interface would drift from
 * the real one and quietly stop being evidence of anything.
 */
export const isDemo = import.meta.env.VITE_DEMO === "1";

export interface DemoManifest {
  projectId: string;
  title: string;
  author: string | null;
  wordCount: number;
  chapterCount: number;
  capturedAt: string;
}

/** Where the recorded responses live, under whatever base path this is served from. */
const demoRoot = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/demo`;

export async function loadSnapshot<T>(url: string): Promise<T> {
  const response = await fetch(`${demoRoot}/${snapshotName(url)}`);
  if (!response.ok) throw new Error(`No recorded response for ${url}.`);
  return (await response.json()) as T;
}

/**
 * What the demo says when something would have written to the database.
 *
 * Deliberately specific about *what* is missing rather than a flat "not
 * available": a reviewer should be able to tell that the feature exists and is
 * absent for a hosting reason, not that it is unfinished.
 */
export const DEMO_WRITE_MESSAGE =
  "This is a read-only demo — uploading, attributing and dismissing all need the server. Run it locally to try them.";
