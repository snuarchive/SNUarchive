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

  app.notFound((c) =>
    c.json(
      errorBody(
        new ApiError(404, "NOT_FOUND"),
        c.get("requestId") ?? "req_unknown",
      ),
      404,
    ),
  );

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
