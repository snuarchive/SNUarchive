import { Hono } from "hono";
import type { Env } from "../auth";
import { DAY_MS } from "../calendar";
import type { Ctx } from "../domain";
import { iso, log } from "../domain";
import { conflict, notFound, unauthenticated } from "../errors";
import { nextId } from "../state";
import type { S } from "../types";

export function internalRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  r.post("/internal/jobs/:jobName", (c) => {
    // Like the backend, the route does not exist without a cron secret.
    const secret = ctx.options.cronSecret;
    if (!secret) throw notFound();
    if (c.req.header("authorization") !== `Bearer ${secret}`)
      throw unauthenticated();
    const job = ctx.state.jobs.find((j) => j.name === c.req.param("jobName"));
    if (!job) throw notFound("알 수 없는 작업입니다.");
    if (!job.enabled) throw conflict("JOB_DISABLED");

    const startedAt = ctx.now();
    let affected = 0;
    if (job.name === "retention") {
      const days = Number(job.settings.days ?? 365);
      const cutoff = startedAt - days * DAY_MS;
      const before = ctx.state.logs.length;
      ctx.state.logs = ctx.state.logs.filter((l) => l.createdAt >= cutoff);
      affected = before - ctx.state.logs.length;
      log(ctx, null, "logs_retention_delete", {
        deleted: affected,
        cutoff: iso(cutoff),
      });
    } else if (job.name === "archive") {
      const days = Number(job.settings.afterDays ?? 90);
      const cutoff = startedAt - days * DAY_MS;
      const archived = ctx.state.logs.filter((l) => l.createdAt < cutoff);
      affected = archived.length;
      ctx.state.logs = ctx.state.logs.filter((l) => l.createdAt >= cutoff);
      ctx.state.archiveRuns.push({
        id: nextId(ctx.state, "archiveRuns"),
        startedAt,
        finishedAt: ctx.now(),
        status: "succeeded",
        cutoff,
        format: (job.settings.format as "jsonl") ?? "jsonl",
        rowCount: affected,
        driveFileId: `1mockDrive${nextId(ctx.state, "driveFiles")}`,
        error: null,
      });
      log(ctx, null, "logs_archive", {
        rowCount: affected,
        cutoff: iso(cutoff),
      });
    }
    // upload-gc has nothing to collect in memory: uploads never leave orphans here.

    const result: S<"JobRunResult"> = {
      name: job.name,
      startedAt: iso(startedAt),
      finishedAt: iso(ctx.now()),
      status: "succeeded",
      affected,
      error: null,
    };
    job.lastRun = result;
    return c.json(result);
  });

  return r;
}
