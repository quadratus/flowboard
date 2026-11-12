import type { FastifyInstance } from "fastify";

export type Issue = { path: string; issue: string };

/** Every error the API returns on purpose. The handler turns it into { error: { code, message, details? } }. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const unauthenticated = (message: string) => new AppError(401, "UNAUTHENTICATED", message);
export const forbidden = (message = "You do not have access to this resource") =>
  new AppError(403, "FORBIDDEN", message);
export const notFound = (what: string) => new AppError(404, "NOT_FOUND", `${what} not found`);
export const invalid = (details: Issue[], message?: string) =>
  new AppError(
    400,
    "VALIDATION_FAILED",
    message ??
      (details.length === 1
        ? `${details[0].path}: ${details[0].issue}`
        : `${details.length} values are not valid`),
    details,
  );
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);

const body = (code: string, message: string, details?: unknown) => ({
  error: details === undefined ? { code, message } : { code, message, details },
});

type AjvIssue = {
  instancePath: string;
  message?: string;
  params: { missingProperty?: string; additionalProperty?: string };
};

/** Ajv reports "/customFields/estimate"; the API reports "customFields.estimate". */
function toIssue(e: AjvIssue, context: string): Issue {
  const parts = e.instancePath.split("/").filter(Boolean);
  if (e.params.missingProperty) parts.push(e.params.missingProperty);
  if (e.params.additionalProperty) parts.push(e.params.additionalProperty);
  if (context !== "body") parts.unshift(context === "querystring" ? "query" : context);
  return {
    path: parts.join(".") || context,
    issue: e.params.additionalProperty ? "unknown property" : (e.message ?? "invalid"),
  };
}

type HandledError = Error & {
  statusCode?: number;
  code?: string;
  validation?: AjvIssue[];
  validationContext?: string;
  constraint_name?: string;
};

export function registerErrorHandling(app: FastifyInstance) {
  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send(body("NOT_FOUND", `Route ${req.method} ${req.url} not found`));
  });

  app.setErrorHandler((err: HandledError, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send(body(err.code, err.message, err.details));
    }
    if (err.validation) {
      const details = err.validation.map((e) => toIssue(e, err.validationContext ?? "body"));
      return reply.code(400).send(body("VALIDATION_FAILED", "Request is not valid", details));
    }
    // Postgres constraint errors: the API should catch these first, so they mean a race or a gap.
    if (err.code === "23505") {
      return reply
        .code(409)
        .send(body("CONFLICT", "A concurrent change conflicts with this request. Retry it."));
    }
    if (err.code === "23503" || err.code === "23514") {
      return reply
        .code(400)
        .send(body("VALIDATION_FAILED", `Constraint failed: ${err.constraint_name ?? "unknown"}`));
    }
    // Fastify's own client errors, for example malformed JSON or a body that is too large.
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send(body("BAD_REQUEST", err.message));
    }
    req.log.error(err);
    return reply.code(500).send(body("INTERNAL", "Unexpected server error"));
  });
}
