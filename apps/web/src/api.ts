import type {
  ApiError,
  Cast,
  Chapter,
  CreateProject,
  Credentials,
  DialogueLine,
  Paragraph,
  Project,
  StructureEdit,
  User,
} from "@bp/schema";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

/**
 * Thrown for any non-2xx response. `fields` is present when the server rejected
 * specific inputs, so a form can show the message next to the offending field
 * instead of dumping everything into one banner.
 */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    // FormData must set its own Content-Type: the browser appends the multipart
    // boundary, and overriding it makes the body unparseable on the server.
    const isFormData = init?.body instanceof FormData;

    response = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: "include", // session cookie
      headers: {
        ...(init?.body && !isFormData ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new RequestError(0, "Can’t reach the server. Is the API running?");
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const body = payload as ApiError | null;
    throw new RequestError(
      response.status,
      body?.error?.message ?? `Request failed (${response.status}).`,
      body?.error?.fields,
    );
  }

  return payload as T;
}

export const api = {
  me: () => request<{ user: User | null }>("/api/auth/me"),

  signUp: (body: Credentials) =>
    request<{ user: User }>("/api/auth/signup", { method: "POST", body: JSON.stringify(body) }),

  signIn: (body: Credentials) =>
    request<{ user: User }>("/api/auth/signin", { method: "POST", body: JSON.stringify(body) }),

  signOut: () => request<void>("/api/auth/signout", { method: "POST" }),

  listProjects: () => request<{ projects: Project[] }>("/api/projects"),

  createProject: (body: CreateProject) =>
    request<{ project: Project }>("/api/projects", { method: "POST", body: JSON.stringify(body) }),

  getProject: (id: string) => request<{ project: Project }>(`/api/projects/${id}`),

  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),

  // ------------------------------------------------------------ manuscript --

  /** Multipart upload. Content-Type is left unset so the browser adds the boundary. */
  uploadManuscript: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{
      wordCount: number;
      chapterCount: number;
      format: string;
      detected: { title: string | null; author: string | null };
    }>(`/api/projects/${id}/upload`, { method: "POST", body: form });
  },

  getStructure: (id: string) =>
    request<{
      structureParsedAt: string | null;
      structureConfirmedAt: string | null;
      wordCount: number;
      chapters: Chapter[];
    }>(`/api/projects/${id}/structure`),

  editStructure: (id: string, edit: StructureEdit) =>
    request<{ ok: true }>(`/api/projects/${id}/structure`, {
      method: "PATCH",
      body: JSON.stringify(edit),
    }),

  redetectStructure: (id: string) =>
    request<{ chapterCount: number }>(`/api/projects/${id}/structure/redetect`, { method: "POST" }),

  confirmStructure: (id: string) =>
    request<{ structureConfirmedAt: string | null }>(`/api/projects/${id}/structure/confirm`, {
      method: "POST",
    }),

  getChapter: (projectId: string, chapterId: string) =>
    request<{ chapter: Chapter; paragraphs: Paragraph[] }>(
      `/api/projects/${projectId}/chapters/${chapterId}`,
    ),

  // ------------------------------------------------------------------ cast --

  extractDialogue: (id: string) =>
    request<{
      lineCount: number;
      characterCount: number;
      attributedCount: number;
      unresolvedNameTags: number;
      suggestions: Array<{ names: [string, string]; reason: string }>;
    }>(`/api/projects/${id}/dialogue/extract`, { method: "POST" }),

  getCast: (id: string) => request<Cast>(`/api/projects/${id}/cast`),

  renameCharacter: (id: string, characterId: string, name: string) =>
    request<{ character: { id: string; name: string; aliases: string[] } }>(
      `/api/projects/${id}/cast/${characterId}`,
      { method: "PATCH", body: JSON.stringify({ name }) },
    ),

  mergeCharacters: (id: string, fromId: string, intoId: string) =>
    request<{ ok: true }>(`/api/projects/${id}/cast/merge`, {
      method: "POST",
      body: JSON.stringify({ fromId, intoId }),
    }),

  deleteCharacter: (id: string, characterId: string) =>
    request<void>(`/api/projects/${id}/cast/${characterId}`, { method: "DELETE" }),

  confirmCast: (id: string) =>
    request<{ ok: true }>(`/api/projects/${id}/cast/confirm`, { method: "POST" }),

  getChapterDialogue: (projectId: string, chapterId: string) =>
    request<{ lines: DialogueLine[] }>(
      `/api/projects/${projectId}/chapters/${chapterId}/dialogue`,
    ),

  // ----------------------------------------------------------- attribution --

  getAttributionStats: (id: string) =>
    request<{
      total: number;
      tag: number;
      alternation: number;
      constraints: number;
      llm: number;
      manual: number;
      unattributed: number;
      uncertain: number;
    }>(`/api/projects/${id}/attribution/stats`),

  getAttributionQueue: (id: string, filter: "unattributed" | "uncertain" | "all", limit = 20) =>
    request<{
      total: number;
      offset: number;
      limit: number;
      filter: string;
      items: QueueItem[];
    }>(`/api/projects/${id}/attribution/queue?filter=${filter}&limit=${limit}`),

  assignSpeaker: (id: string, lineId: string, characterId: string | null) =>
    request<{ line: { id: string; character: { id: string; name: string } | null } }>(
      `/api/projects/${id}/dialogue/${lineId}`,
      { method: "PATCH", body: JSON.stringify({ characterId }) },
    ),
  getVoiceProfiles: (id: string, includeInferred = false) =>
    request<VoiceResponse>(`/api/projects/${id}/voice?includeInferred=${includeInferred}`),

  // ----------------------------------------------------------------- flags --

  getFlags: (id: string, status: "open" | "dismissed" | "all" = "open") =>
    request<FlagsResponse>(`/api/projects/${id}/flags?status=${status}`),

  recomputeFlags: (id: string) =>
    request<{ flagCount: number }>(`/api/projects/${id}/flags/recompute`, { method: "POST" }),

  dismissFlag: (id: string, flagId: string, dismissed: boolean) =>
    request<{ flag: { id: string; dismissedAt: string | null } }>(
      `/api/projects/${id}/flags/${flagId}`,
      { method: "PATCH", body: JSON.stringify({ dismissed }) },
    ),

  updateFlagSettings: (
    id: string,
    settings: { flagThreshold?: number; ignoredMetrics?: string[] },
  ) =>
    request<{
      settings: { flagThreshold: number; ignoredMetrics: string[] };
      flagCount: number;
    }>(`/api/projects/${id}/flags/settings`, { method: "PATCH", body: JSON.stringify(settings) }),

  // ------------------------------------------------------- arcs & context --

  getArcs: (id: string) => request<ArcsResponse>(`/api/projects/${id}/arcs`),
};

export interface QueueItem {
  id: string;
  startOffset: number;
  text: string;
  wordCount: number;
  speakerRaw: string | null;
  speakerKind: string | null;
  method: string | null;
  confidence: number | null;
  character: { id: string; name: string } | null;
  context: { before: string; after: string };
  candidates: Array<{ id: string; name: string; nearbyCount: number; totalLines: number }>;
}

export interface SignatureWord {
  word: string;
  count: number;
  rate: number;
  distinctiveness: number;
}

export interface VoiceResponse {
  basis: "all" | "reliable";
  linesUsed: number;
  metricLabels: Record<string, string>;
  metricKeys: string[];
  profiles: Array<{
    name: string;
    isReliable: boolean;
    metrics: Record<string, number | null>;
    z: Record<string, number | undefined>;
    signatureWords: SignatureWord[];
  }>;
  similarity: Array<{ name: string; against: Array<{ name: string; score: number }> }>;
}

export interface FlagEvidence {
  metric: string;
  label: string;
  /** What the character usually does, across their other scenes. */
  baseline: number;
  observed: number;
  z: number;
  direction: "higher" | "lower";
}

export interface VoiceFlag {
  id: string;
  severity: "notable" | "strong";
  peakZ: number;
  summary: string;
  evidence: FlagEvidence[];
  /** How much speech each side of the comparison rests on. */
  sceneWordCount: number;
  baselineWordCount: number;
  baselineSceneCount: number;
  dismissedAt: string | null;
  character: { id: string; name: string };
  scene: {
    id: string;
    index: number;
    startOffset: number;
    endOffset: number;
    chapter: { id: string; index: number; heading: string };
  };
}

export interface FlagsResponse {
  computedAt: string | null;
  settings: { flagThreshold: number; ignoredMetrics: string[] };
  metricLabels: Record<string, string>;
  metricKeys: string[];
  dismissedCount: number;
  flags: VoiceFlag[];
}

export interface ArcPoint {
  sceneId: string;
  chapterIndex: number;
  sceneIndex: number;
  wordCount: number;
  value: number;
}

export interface Arc {
  characterId: string;
  name: string;
  metric: string;
  label: string;
  direction: "rising" | "falling";
  /** Spearman's rho: how consistently the metric moves one way. */
  rho: number;
  startLevel: number;
  endLevel: number;
  change: number;
  sceneCount: number;
  wordCount: number;
  points: ArcPoint[];
  summary: string;
}

export interface ContextShift {
  speakerId: string;
  speakerName: string;
  addresseeId: string;
  addresseeName: string;
  peakZ: number;
  evidence: Array<{
    metric: string;
    label: string;
    /** How they speak to everyone else. */
    elsewhere: number;
    observed: number;
    z: number;
    direction: "higher" | "lower";
  }>;
  wordCount: number;
  elsewhereWordCount: number;
  summary: string;
}

export interface ArcsResponse {
  coverage: {
    linesTotal: number;
    linesMeasurable: number;
    linesAddressed: number;
    arcEligible: number;
    relationships: number;
    scenesWithDialogue: number;
    scenesFullyAttributed: number;
  };
  characters: Array<{ id: string; name: string; sceneCount: number; isArcEligible: boolean }>;
  arcs: Arc[];
  relationships: Array<{
    speakerId: string;
    speakerName: string;
    addresseeId: string;
    addresseeName: string;
    wordCount: number;
    lineCount: number;
    sceneCount: number;
  }>;
  shifts: ContextShift[];
}
