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
};
