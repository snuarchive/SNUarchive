import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Env } from "../auth";
import { clientIp, guard, me } from "../auth";
import type { Ctx } from "../domain";
import { iso, log } from "../domain";
import {
  ApiError,
  confirmationRequired,
  conflict,
  fieldError,
  FieldErrors,
  malformed,
} from "../errors";
import { encodeExport, EXPORT_CONTENT_TYPES } from "../export";
import type { Body } from "../input";
import {
  dateTime,
  int,
  paginate,
  parseDateTime,
  queryInt,
  readJson,
  str,
} from "../input";
import { LIMITS } from "../refdata";
import type { LogRow } from "../state";
import type { ActivityAction, ExportFormat } from "../types";
import * as v from "../views";

// Mirrors the ActivityAction enum; an unknown filter value is a malformed request.
const ACTIONS = new Set<string>([
  "login",
  "profile_update",
  "logout_all",
  "account_delete",
  "favorite_add",
  "favorite_remove",
  "comment_create",
  "comment_delete",
  "stat_report_create",
  "stat_report_update",
  "stat_report_move",
  "stat_report_hide",
  "stat_report_unhide",
  "pending_report_create",
  "pending_report_approve",
  "pending_report_reject",
  "report_file_view",
  "sitting_create",
  "voting_open",
  "voting_update",
  "voting_close",
  "vote_cast",
  "voting_request_create",
  "voting_request_cancel",
  "voting_request_reject",
  "admin_grant",
  "admin_revoke",
  "logs_export",
  "logs_delete",
  "logs_clear",
  "logs_retention_delete",
  "logs_archive",
] satisfies ActivityAction[]);

const FORMATS = Object.keys(EXPORT_CONTENT_TYPES) as ExportFormat[];
const EXTENSIONS: Record<ExportFormat, string> = {
  json: "json",
  jsonl: "jsonl",
  csv: "csv",
  xlsx: "xlsx",
  parquet: "parquet",
};

interface LogFilter {
  from?: number;
  until?: number;
  action?: ActivityAction[];
  userId?: number;
}

function matches(f: LogFilter, l: LogRow): boolean {
  return (
    (f.from === undefined || l.createdAt >= f.from) &&
    (f.until === undefined || l.createdAt < f.until) &&
    (f.action === undefined || f.action.includes(l.action)) &&
    (f.userId === undefined || l.userId === f.userId)
  );
}

function checkActions(actions: unknown[]): ActivityAction[] {
  for (const a of actions)
    if (typeof a !== "string" || !ACTIONS.has(a))
      throw malformed(`알 수 없는 action: ${String(a)}`);
  return [...new Set(actions as ActivityAction[])].sort();
}

function filterFromQuery(c: Context<Env>): LogFilter {
  const f: LogFilter = {};
  const from = c.req.query("from");
  const until = c.req.query("until");
  if (from !== undefined) f.from = parseDateTime(from, "from");
  if (until !== undefined) f.until = parseDateTime(until, "until");
  const actions = c.req.queries("action");
  if (actions?.length) f.action = checkActions(actions);
  const userId = queryInt(c, "userId");
  if (userId !== undefined) f.userId = userId;
  if (windowInverted(f)) throw fieldError("until", "WINDOW_INVERTED");
  return f;
}

/** `from >= until` is a rule error (422 WINDOW_INVERTED on `until`), not a shape error. */
function windowInverted(f: LogFilter): boolean {
  return f.from !== undefined && f.until !== undefined && f.from >= f.until;
}

const LOG_FILTER_FIELDS = ["from", "until", "action", "userId"];

function filterFromBody(body: Body): LogFilter {
  const f: LogFilter = {};
  const from = dateTime(body, "from");
  const until = dateTime(body, "until");
  if (from != null) f.from = from;
  if (until != null) f.until = until;
  if (body.action !== undefined) {
    if (!Array.isArray(body.action))
      throw malformed("action은 배열이어야 합니다.");
    f.action = checkActions(body.action);
  }
  const userId = int(body, "userId");
  if (userId != null) f.userId = userId;
  const fe = new FieldErrors();
  // At least one filter field; `token` alone is not a filter.
  if (!Object.keys(f).length) fe.add("", "REQUIRED");
  if (body.action !== undefined && !f.action?.length)
    fe.add("action", "REQUIRED");
  if (windowInverted(f)) fe.add("until", "WINDOW_INVERTED");
  fe.throwIfAny();
  return f;
}

function filterKey(f: LogFilter): string {
  return JSON.stringify([
    f.from ?? null,
    f.until ?? null,
    f.action ?? null,
    f.userId ?? null,
  ]);
}

function filterMetadata(f: LogFilter) {
  return {
    from: iso(f.from ?? null),
    until: iso(f.until ?? null),
    action: f.action ?? null,
    userId: f.userId ?? null,
  };
}

export function adminLogRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  r.get("/admin/logs", guard(ctx, "admin"), (c) => {
    const f = filterFromQuery(c);
    const rows = ctx.state.logs
      .filter((l) => matches(f, l))
      .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
    return c.json(paginate(c, rows, (l) => v.logEntry(ctx, l)));
  });

  r.delete("/admin/logs", guard(ctx, "adminWrite"), (c) => {
    const admin = me(c);
    if (c.req.header("x-confirm-delete") !== "true")
      throw confirmationRequired();
    const deleted = ctx.state.logs.length;
    ctx.state.logs = [];
    ctx.state.deletePreviews.clear();
    log(ctx, admin.id, "logs_clear", { deleted }, clientIp(c));
    return c.json({ deleted });
  });

  r.get("/admin/logs/export", guard(ctx, "admin"), (c) => {
    const admin = me(c);
    const format = c.req.query("format") as ExportFormat | undefined;
    if (!format || !FORMATS.includes(format))
      throw malformed("format이 올바르지 않습니다.");
    const f = filterFromQuery(c);
    const rows = ctx.state.logs
      .filter((l) => matches(f, l))
      .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
    if (rows.length > ctx.options.exportMaxRows) {
      throw new ApiError(413, "EXPORT_TOO_LARGE", undefined, {
        count: rows.length,
        limit: ctx.options.exportMaxRows,
      });
    }
    const bytes = encodeExport(
      format,
      rows.map((l) => v.logEntry(ctx, l)),
    );
    log(
      ctx,
      admin.id,
      "logs_export",
      { format, count: rows.length, filter: filterMetadata(f) },
      clientIp(c),
    );
    const stamp = new Date(ctx.now())
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, "");
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": EXPORT_CONTENT_TYPES[format],
      "Content-Disposition": `attachment; filename="activity-logs-${stamp}.${EXTENSIONS[format]}"`,
    });
  });

  r.post("/admin/logs/delete-preview", guard(ctx, "adminWrite"), async (c) => {
    const f = filterFromBody(await readJson(c, LOG_FILTER_FIELDS));
    const count = ctx.state.logs.filter((l) => matches(f, l)).length;
    const token = randomBytes(18).toString("base64url");
    const expiresAt = ctx.now() + LIMITS.deletePreviewTtlMs;
    ctx.state.deletePreviews.set(token, {
      filterKey: filterKey(f),
      count,
      expiresAt,
    });
    return c.json({ count, token, expiresAt: iso(expiresAt) });
  });

  r.post("/admin/logs/delete", guard(ctx, "adminWrite"), async (c) => {
    const admin = me(c);
    const body = await readJson(c, [...LOG_FILTER_FIELDS, "token"]);
    const token = str(body, "token");
    if (token === undefined) {
      const fe = new FieldErrors();
      fe.add("token", "REQUIRED");
      fe.throwIfAny();
    }
    const filterBody = { ...body };
    delete filterBody.token;
    const f = filterFromBody(filterBody);
    const preview = ctx.state.deletePreviews.get(token!);
    const matching = ctx.state.logs.filter((l) => matches(f, l));
    if (
      !preview ||
      preview.expiresAt <= ctx.now() ||
      preview.filterKey !== filterKey(f) ||
      preview.count !== matching.length
    ) {
      throw conflict("DELETE_PREVIEW_MISMATCH");
    }
    ctx.state.deletePreviews.delete(token!);
    const doomed = new Set(matching.map((l) => l.id));
    ctx.state.logs = ctx.state.logs.filter((l) => !doomed.has(l.id));
    log(
      ctx,
      admin.id,
      "logs_delete",
      { filter: filterMetadata(f), deleted: doomed.size },
      clientIp(c),
    );
    return c.json({ deleted: doomed.size });
  });

  r.get("/admin/logs/archive-runs", guard(ctx, "admin"), (c) => {
    const rows = [...ctx.state.archiveRuns].sort(
      (a, b) => b.startedAt - a.startedAt || b.id - a.id,
    );
    return c.json(
      paginate(c, rows, (a) => ({
        id: a.id,
        startedAt: iso(a.startedAt),
        finishedAt: iso(a.finishedAt),
        status: a.status,
        cutoff: iso(a.cutoff),
        format: a.format,
        rowCount: a.rowCount,
        driveFileId: a.driveFileId,
        error: a.error,
      })),
    );
  });

  return r;
}
