import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { unauthenticated } from "../../shared/errors.ts";

export type User = { id: string; handle: string; name: string; role: "admin" | "member" };

/**
 * Auth boundary. Mock identity: the X-User-Id header holds a handle (alice|bob|carol).
 * The role always comes from the database, never from the request.
 * Production swap: verify an OIDC token here and look the user up by its `sub`. Nothing else changes.
 */
export const identity = fp(async (app: FastifyInstance) => {
  // The onRequest hook below sets it before any /v1 route runs.
  app.decorateRequest("user", null as unknown as User);

  app.addHook("onRequest", async (req) => {
    if (req.url === "/v1/health" || !req.url.startsWith("/v1/")) return;

    const handle = req.headers["x-user-id"];
    if (typeof handle !== "string" || handle === "") {
      throw unauthenticated("Send the X-User-Id header (alice, bob or carol)");
    }
    const [user] = await app.sql<
      User[]
    >`select id, handle, name, role from users where handle = ${handle}`;
    if (!user) throw unauthenticated(`Unknown user '${handle}'`);
    req.user = user;
  });

  app.get("/v1/me", async (req) => req.user);

  app.get("/v1/users", async () => ({
    data: await app.sql<User[]>`select id, handle, name, role from users order by handle`,
  }));
});

declare module "fastify" {
  interface FastifyRequest {
    user: User;
  }
}
