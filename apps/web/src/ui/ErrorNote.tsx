import { ApiError } from "../api/client.ts";

const ADVICE: Record<number, string> = {
  401: "Choose a user in the switcher.",
  403: "You do not have access. Ask an admin for a grant.",
  404: "It may be archived, or the link is old.",
};

/** One place that turns an API error into a direction for the user. */
export function ErrorNote({ error, tone = "light" }: { error: unknown; tone?: "light" | "dark" }) {
  const status = error instanceof ApiError ? error.status : 0;
  const message = error instanceof Error ? error.message : "Something failed.";
  return (
    <div className={`error-note error-note-${tone}`} role="alert">
      <strong>{message}</strong>
      {ADVICE[status] ? <p>{ADVICE[status]}</p> : null}
    </div>
  );
}
