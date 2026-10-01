import { Hono } from "hono";
import type { Env } from "../auth";
import { clientIp, guard, me } from "../auth";
import type { Ctx } from "../domain";
import { bumpContent, getOrCreateSitting, log, requireCourse } from "../domain";
import { conflict, FieldErrors, malformed, notFound } from "../errors";
import {
  bool,
  checkFigures,
  checkMaxLength,
  checkNickname,
  checkSittingKey,
  completeFigures,
  int,
  optionalIdQuery,
  optionalText,
  paginate,
  pathId,
  readFigures,
  readJson,
  readSittingKey,
  str,
  SITTING_KEY_FIELDS,
  FIGURE_FIELDS,
} from "../input";
import { LIMITS } from "../refdata";
import type { Figures, StatisticRow } from "../state";
import { nextId } from "../state";
import * as v from "../views";

export function adminModerationRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  const requireReport = (id: number) => {
    const row = ctx.state.reports.find((x) => x.id === id);
    if (!row) throw notFound("제보를 찾을 수 없습니다.");
    return row;
  };
  const requireStatistic = (id: number) => {
    const row = ctx.state.statistics.find((x) => x.id === id);
    if (!row) throw notFound("통계를 찾을 수 없습니다.");
    return row;
  };

  r.get("/admin/reports", guard(ctx, "admin"), (c) => {
    const status = c.req.query("status") ?? "pending";
    if (!["pending", "approved", "rejected", "all"].includes(status))
      throw malformed("status가 올바르지 않습니다.");
    const courseId = optionalIdQuery(c, "courseId");
    const rows = ctx.state.reports
      .filter(
        (x) =>
          (status === "all" || x.status === status) &&
          (courseId === undefined || x.courseId === courseId),
      )
      .sort((a, b) =>
        status === "pending"
          ? a.createdAt - b.createdAt || a.id - b.id
          : b.createdAt - a.createdAt || b.id - a.id,
      );
    return c.json(paginate(c, rows, (x) => v.adminPendingReport(ctx, x)));
  });

  r.get("/admin/reports/:reportId/file", guard(ctx, "admin"), (c) => {
    const report = requireReport(pathId(c, "reportId"));
    const download = c.req.query("download") === "1";
    log(
      ctx,
      me(c).id,
      "report_file_view",
      { reportId: report.id, download },
      clientIp(c),
    );
    const name = encodeURIComponent(report.fileName);
    return c.body(report.bytes as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": report.contentType,
      "Content-Length": String(report.bytes.byteLength),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${name}`,
      "Content-Security-Policy":
        "sandbox; default-src 'none'; img-src 'self'; object-src 'self'",
      "X-Content-Type-Options": "nosniff",
    });
  });

  r.post(
    "/admin/reports/:reportId/approve",
    guard(ctx, "adminWrite"),
    async (c) => {
      const admin = me(c);
      // Precedence: 404, then 409, then 422.
      const report = requireReport(pathId(c, "reportId"));
      const body = await readJson(c, [
        ...SITTING_KEY_FIELDS,
        ...FIGURE_FIELDS,
        "nickname",
        "reviewNote",
      ]);
      if (report.status !== "pending")
        throw conflict("REPORT_ALREADY_REVIEWED");
      const fe = new FieldErrors();
      const override = readSittingKey(body);
      const key = checkSittingKey(
        {
          kindId: override.kindId ?? report.kindId,
          // An omitted number keeps the claimed one; only an explicit null
          // clears it. So quiz 2 → midterm needs `number: null`, or it is 422.
          number: "number" in body ? override.number : report.number,
          year: override.year ?? report.year,
          semester: override.semester ?? report.semester,
        },
        fe,
      );
      const figures = completeFigures(readFigures(body));
      checkFigures(figures, fe);
      const rawNick = str(body, "nickname", { nullable: true });
      const nickname =
        rawNick === undefined ? report.nickname : checkNickname(rawNick, fe);
      const reviewNote =
        str(body, "reviewNote", { nullable: true })?.trim() || null;
      checkMaxLength(reviewNote, LIMITS.reviewNoteMaxLength, "reviewNote", fe);
      fe.throwIfAny();

      const { sitting } = getOrCreateSitting(ctx, report.courseId, key!);
      const now = ctx.now();
      const stat: StatisticRow = {
        id: nextId(ctx.state, "statistics"),
        sittingId: sitting.id,
        contributorId: report.uploaderId,
        ...figures,
        nickname,
        source: "transcribed",
        sourceReportId: report.id,
        createdAt: now,
        updatedAt: now,
        hiddenAt: null,
        hiddenReason: null,
      };
      ctx.state.statistics.push(stat);
      Object.assign(report, {
        status: "approved",
        reviewerId: admin.id,
        reviewedAt: now,
        reviewNote,
        linkedStatisticId: stat.id,
      });
      bumpContent(ctx);
      log(
        ctx,
        admin.id,
        "pending_report_approve",
        { reportId: report.id, statisticId: stat.id },
        clientIp(c),
      );
      return c.json(
        {
          statistic: v.statistic(stat),
          sitting: v.sittingRef(sitting),
          report: v.adminPendingReport(ctx, report),
        },
        201,
      );
    },
  );

  r.post(
    "/admin/reports/:reportId/reject",
    guard(ctx, "adminWrite"),
    async (c) => {
      const admin = me(c);
      const report = requireReport(pathId(c, "reportId"));
      const body = await readJson(c, ["reviewNote"]);
      if (report.status !== "pending")
        throw conflict("REPORT_ALREADY_REVIEWED");
      const reviewNote =
        str(body, "reviewNote", { nullable: true })?.trim() || null;
      const fe = new FieldErrors();
      checkMaxLength(reviewNote, LIMITS.reviewNoteMaxLength, "reviewNote", fe);
      fe.throwIfAny();
      Object.assign(report, {
        status: "rejected",
        reviewerId: admin.id,
        reviewedAt: ctx.now(),
        reviewNote,
      });
      log(
        ctx,
        admin.id,
        "pending_report_reject",
        { reportId: report.id },
        clientIp(c),
      );
      return c.json(v.adminPendingReport(ctx, report));
    },
  );

  r.get("/admin/statistics", guard(ctx, "admin"), (c) => {
    const courseId = optionalIdQuery(c, "courseId");
    const hiddenQ = c.req.query("hidden");
    if (hiddenQ !== undefined && hiddenQ !== "true" && hiddenQ !== "false")
      throw malformed("hidden은 true 또는 false입니다.");
    const courseOf = new Map(ctx.state.sittings.map((s) => [s.id, s.courseId]));
    const rows = ctx.state.statistics
      .filter(
        (st) =>
          (courseId === undefined || courseOf.get(st.sittingId) === courseId) &&
          (hiddenQ === undefined ||
            (st.hiddenAt !== null) === (hiddenQ === "true")),
      )
      .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
    return c.json(paginate(c, rows, (st) => v.adminStatistic(ctx, st)));
  });

  r.patch(
    "/admin/statistics/:statisticId",
    guard(ctx, "adminWrite"),
    async (c) => {
      const admin = me(c);
      const stat = requireStatistic(pathId(c, "statisticId"));
      const body = await readJson(c, [...FIGURE_FIELDS, "nickname"]);
      const patch = readFigures(body);
      const rawNick = str(body, "nickname", { nullable: true });
      const fe = new FieldErrors();
      if (!Object.keys(patch).length && rawNick === undefined)
        fe.add("", "REQUIRED");
      const merged = completeFigures({ ...pickFigures(stat), ...patch });
      checkFigures(merged, fe);
      const nickname =
        rawNick === undefined ? stat.nickname : checkNickname(rawNick, fe);
      fe.throwIfAny();
      Object.assign(stat, merged, { nickname, updatedAt: ctx.now() });
      bumpContent(ctx);
      log(
        ctx,
        admin.id,
        "stat_report_update",
        { statisticId: stat.id, fields: Object.keys(patch) },
        clientIp(c),
      );
      return c.json(v.adminStatistic(ctx, stat));
    },
  );

  r.post(
    "/admin/statistics/:statisticId/move",
    guard(ctx, "adminWrite"),
    async (c) => {
      const admin = me(c);
      const stat = requireStatistic(pathId(c, "statisticId"));
      const body = await readJson(c, ["courseId", ...SITTING_KEY_FIELDS]);
      const courseId = int(body, "courseId");
      const fe = new FieldErrors();
      if (courseId === undefined) fe.add("courseId", "REQUIRED");
      const key = checkSittingKey(readSittingKey(body), fe);
      fe.throwIfAny();
      const course = requireCourse(ctx, courseId!);
      const from = stat.sittingId;
      const { sitting } = getOrCreateSitting(ctx, course.id, key!);
      stat.sittingId = sitting.id;
      stat.updatedAt = ctx.now();
      bumpContent(ctx);
      log(
        ctx,
        admin.id,
        "stat_report_move",
        { statisticId: stat.id, fromSittingId: from, toSittingId: sitting.id },
        clientIp(c),
      );
      return c.json(v.adminStatistic(ctx, stat));
    },
  );

  r.put(
    "/admin/statistics/:statisticId/hidden",
    guard(ctx, "adminWrite"),
    async (c) => {
      const admin = me(c);
      const stat = requireStatistic(pathId(c, "statisticId"));
      const body = await readJson(c, ["hidden", "reason"]);
      const hidden = bool(body, "hidden");
      const fe = new FieldErrors();
      if (hidden === undefined) fe.add("hidden", "REQUIRED");
      // Blank is stored as null; the reason is ignored when showing again.
      const reason = hidden
        ? optionalText(body, "reason", LIMITS.hiddenReasonMaxLength, fe)
        : null;
      fe.throwIfAny();
      if (hidden) {
        stat.hiddenAt = stat.hiddenAt ?? ctx.now();
        stat.hiddenReason = reason;
      } else {
        stat.hiddenAt = null;
        stat.hiddenReason = null;
      }
      bumpContent(ctx);
      log(
        ctx,
        admin.id,
        hidden ? "stat_report_hide" : "stat_report_unhide",
        { statisticId: stat.id, reason: stat.hiddenReason },
        clientIp(c),
      );
      return c.json(v.adminStatistic(ctx, stat));
    },
  );

  r.get("/admin/comments", guard(ctx, "admin"), (c) => {
    const courseId = optionalIdQuery(c, "courseId");
    const rows = ctx.state.comments
      .filter((x) => courseId === undefined || x.courseId === courseId)
      .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
    return c.json(paginate(c, rows, (x) => v.adminComment(ctx, x)));
  });

  r.delete("/admin/comments/:commentId", guard(ctx, "adminWrite"), (c) => {
    const admin = me(c);
    const id = pathId(c, "commentId");
    const row = ctx.state.comments.find((x) => x.id === id);
    if (!row) throw notFound("한줄평을 찾을 수 없습니다.");
    ctx.state.comments = ctx.state.comments.filter((x) => x.id !== id);
    log(
      ctx,
      admin.id,
      "comment_delete",
      { commentId: id, courseId: row.courseId, body: row.body },
      clientIp(c),
    );
    return c.body(null, 204);
  });

  return r;
}

function pickFigures(st: StatisticRow): Figures {
  return {
    q1: st.q1,
    q2: st.q2,
    q3: st.q3,
    q4: st.q4,
    average: st.average,
    maxScore: st.maxScore,
    note: st.note,
  };
}
