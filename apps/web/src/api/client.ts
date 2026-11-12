import type { Issue } from "./types.ts";

/** The API error shape { error: { code, message, details? } } as a throwable. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field issues by path, for inline form errors. Empty when details is not an issue list. */
  get issues(): Issue[] {
    return Array.isArray(this.details) ? (this.details as Issue[]) : [];
  }
}

const USER_KEY = "flowboard.user";
export const getUserHandle = () => localStorage.getItem(USER_KEY) ?? "alice";
export const setUserHandle = (handle: string) => localStorage.setItem(USER_KEY, handle);

/**
 * Every call sends the mock identity. The server decides the role and the permissions;
 * the client only chooses which seeded user to act as.
 */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "x-user-id": getUserHandle() };
  if (body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(`/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;

  const json = (await res.json().catch(() => null)) as {
    error?: { code: string; message: string; details?: unknown };
  } | null;
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(
      res.status,
      e?.code ?? "UNKNOWN",
      e?.message ?? `Request failed (${res.status})`,
      e?.details,
    );
  }
  return json as T;
}
