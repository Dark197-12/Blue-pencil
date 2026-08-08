import { snapshotName } from "@bp/schema";

/**
 * Read-only demo mode.
 *
 * The read endpoints are pure functions of a stored manuscript, so their
 * answers can be recorded once and served as static files. This allows the
 * interface to be published without a server or a database.
 *
 * The substitution happens at the single point where the app talks to the
 * network, so every screen, query and component above that line is unchanged.
 * Building a separate cut-down interface instead would let the demo drift from
 * the application it is meant to represent.
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
 * Shown when an action would have written to the database. Names the affected
 * features explicitly, so it is clear they exist and are unavailable here
 * rather than unimplemented.
 */
export const DEMO_WRITE_MESSAGE =
  "This is a read-only demo — uploading, attributing and dismissing all need the server. Run it locally to try them.";
