import type { ApiError, CreateProject, Credentials, Project, User } from "@bp/schema";

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
    response = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: "include", // session cookie
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
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

  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
};
