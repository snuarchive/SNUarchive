import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./auth";
import { sessionMiddleware } from "./auth";
import type { MockOptions } from "./config";
import { defaultOptions } from "./config";
import type { Ctx } from "./domain";
import { createCtx } from "./domain";
import { ApiError, errorBody } from "./errors";
import { adminLogRoutes } from "./routes/adminLogs";
import { adminModerationRoutes } from "./routes/adminModeration";
import { adminVotingRoutes } from "./routes/adminVoting";
import { catalogRoutes } from "./routes/catalog";
import { consoleRoutes } from "./routes/console";
import { contributeRoutes } from "./routes/contribute";
import { internalRoutes } from "./routes/internal";
import { FaultQueue, mockRoutes } from "./routes/mock";
import { sessionRoutes } from "./routes/session";
import { seedState } from "./seed";

export interface MockApp {
  app: Hono<Env>;
  ctx: Ctx;
  faults: FaultQueue;
  reset(): void;
}

export function createApp(
  overrides: Partial<MockOptions> | MockOptions = {},
): MockApp {
  const options = defaultOptions(overrides);
  const ctx = createCtx(options, seedState);
  const faults = new FaultQueue();
  const reset = () => {
    ctx.state = seedState(ctx);
    faults.clear();
  };

  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    const id = `req_${randomBytes(8).toString("hex")}`;
    c.set("requestId", id);
    c.set("user", null);
    await next();
    c.res.headers.set("X-Request-ID", id);
  });

  app.onError((err, c) => {
    const requestId = c.get("requestId") ?? "req_unknown";
    let apiErr: ApiError;
    if (err instanceof ApiError) apiErr = err;
    else if (err instanceof HTTPException && err.status < 500)
      apiErr = new ApiError(err.status, "MALFORMED_REQUEST", err.message);
    else {
      console.error(`[${requestId}]`, err);
      apiErr = new ApiError(500, "INTERNAL");
    }
    const res = c.json(errorBody(apiErr, requestId), apiErr.status as 400);
    res.headers.set("X-Request-ID", requestId);
    return res;
  });

  // A known path with an unsupported method is 405 with Allow, as the
  // contract says; anything else is 404.
  app.notFound((c) => {
    const requestId = c.get("requestId") ?? "req_unknown";
    const allowed = allowedMethods(app.routes, c.req.path);
    if (allowed.length > 0) {
      const res = c.json(
        errorBody(new ApiError(405, "METHOD_NOT_ALLOWED"), requestId),
        405,
      );
      res.headers.set("Allow", allowed.join(", "));
      return res;
    }
    return c.json(errorBody(new ApiError(404, "NOT_FOUND"), requestId), 404);
  });

  app.route("/__mock", mockRoutes(ctx, faults, reset));

  const api = new Hono<Env>();
  api.use("*", faults.middleware(), sessionMiddleware(ctx));
  api.route("/", sessionRoutes(ctx));
  api.route("/", catalogRoutes(ctx));
  api.route("/", contributeRoutes(ctx));
  api.route("/", adminModerationRoutes(ctx));
  api.route("/", adminVotingRoutes(ctx));
  api.route("/", adminLogRoutes(ctx));
  api.route("/", consoleRoutes(ctx));
  api.route("/", internalRoutes(ctx));
  app.route("/api/v1", api);

  return { app, ctx, faults, reset };
}

/** Methods registered for a concrete path, ignoring middleware (`ALL`). */
export function allowedMethods(
  routes: readonly { method: string; path: string }[],
  path: string,
): string[] {
  const methods = new Set<string>();
  for (const route of routes) {
    if (route.method === "ALL" || route.path.includes("*")) continue;
    const pattern = new RegExp(
      `^${route.path
        .split("/")
        .map((part) =>
          part.startsWith(":")
            ? "[^/]+"
            : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"),
        )
        .join("/")}/?$`,
    );
    if (pattern.test(path)) methods.add(route.method);
  }
  if (methods.has("GET")) methods.add("HEAD");
  return [...methods].sort();
}
