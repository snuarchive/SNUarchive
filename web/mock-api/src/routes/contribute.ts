import { Hono } from "hono";
import type { Env } from "../auth";
import { clientIp, guard, me } from "../auth";
import type { Ctx } from "../domain";
import {
  bumpContent,
  getOrCreateSitting,
  isVotingOpen,
  log,
  requireCourse,
  requireSitting,
} from "../domain";
import {
  ApiError,
  conflict,
  FieldErrors,
  malformed,
  notFound,
} from "../errors";
import { sniff } from "../files";
import {
  checkFigures,
  checkMaxLength,
  checkNickname,
  checkSittingKey,
  collapseWhitespace,
  completeFigures,
  cpLength,
  int,
  pathId,
  readFigures,
  readJson,
  readSittingKey,
  str,
} from "../input";
import { LIMITS } from "../refdata";
import type { StatisticRow, VoteRow } from "../state";
import { nextId } from "../state";
import * as v from "../views";

export function contributeRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  r.post("/courses/:courseId/comments", guard(ctx, "write"), async (c) => {
    const user = me(c);
    const course = requireCourse(ctx, pathId(c, "courseId"));
    const raw = str(await readJson(c, ["body"]), "body");
    const body = collapseWhitespace(raw ?? "");
    const fe = new FieldErrors();
    if (!body) fe.add("body", "REQUIRED");
    else if (cpLength(body) > LIMITS.commentMaxLength)
      fe.add("body", "TOO_LONG");
    fe.throwIfAny();
    const row = {
      id: nextId(ctx.state, "comments"),
      courseId: course.id,
      userId: user.id,
      body,
      createdAt: ctx.now(),
    };
    ctx.state.comments.push(row);
    log(
      ctx,
      user.id,
      "comment_create",
      { commentId: row.id, courseId: course.id },
      clientIp(c),
    );
    return c.json(v.comment(ctx, row), 201);
  });

  r.put("/courses/:courseId/favorite", guard(ctx, "write"), (c) => {
    const user = me(c);
    const course = requireCourse(ctx, pathId(c, "courseId"));
    if (
      !ctx.state.favorites.some(
        (f) => f.userId === user.id && f.courseId === course.id,
      )
    ) {
      ctx.state.favorites.push({
        userId: user.id,
        courseId: course.id,
        createdAt: ctx.now(),
      });
      log(ctx, user.id, "favorite_add", { courseId: course.id }, clientIp(c));
    }
    return c.body(null, 204);
  });

  r.delete("/courses/:courseId/favorite", guard(ctx, "write"), (c) => {
    const user = me(c);
    const course = requireCourse(ctx, pathId(c, "courseId"));
    const before = ctx.state.favorites.length;
    ctx.state.favorites = ctx.state.favorites.filter(
      (f) => !(f.userId === user.id && f.courseId === course.id),
    );
    if (ctx.state.favorites.length !== before) {
      log(
        ctx,
        user.id,
        "favorite_remove",
        { courseId: course.id },
        clientIp(c),
      );
    }
    return c.body(null, 204);
  });

  r.post("/courses/:courseId/statistics", guard(ctx, "write"), async (c) => {
    const user = me(c);
    const course = requireCourse(ctx, pathId(c, "courseId"));
    const body = await readJson(c);
    const fe = new FieldErrors();
    const key = checkSittingKey(readSittingKey(body), fe);
    const figures = completeFigures(readFigures(body));
    checkFigures(figures, fe);
    const nickname = checkNickname(
      str(body, "nickname", { nullable: true }),
      fe,
    );
    fe.throwIfAny();
    const { sitting } = getOrCreateSitting(ctx, course.id, key!);
    const now = ctx.now();
    const row: StatisticRow = {
      id: nextId(ctx.state, "statistics"),
      sittingId: sitting.id,
      contributorId: user.id,
      ...figures,
      nickname,
      source: "direct",
      sourceReportId: null,
      createdAt: now,
      updatedAt: now,
      hiddenAt: null,
      hiddenReason: null,
    };
    ctx.state.statistics.push(row);
    bumpContent(ctx);
    log(
      ctx,
      user.id,
      "stat_report_create",
      { statisticId: row.id, sittingId: sitting.id },
      clientIp(c),
    );
    return c.json(
      { statistic: v.statistic(row), sitting: v.sittingRef(sitting) },
      201,
    );
  });

  r.post("/courses/:courseId/reports", guard(ctx, "write"), async (c) => {
    const user = me(c);
    const course = requireCourse(ctx, pathId(c, "courseId"));
    let form: Record<string, string | File | (string | File)[]>;
    try {
      form = await c.req.parseBody();
    } catch {
      throw malformed("multipart/form-data 본문이 필요합니다.");
    }
    const field = (name: string): string | undefined => {
      const val = form[name];
      if (val === undefined) return undefined;
      if (typeof val !== "string")
        throw malformed(`${name}: 텍스트 필드여야 합니다.`);
      return val;
    };
    const intField = (name: string): number | null | undefined => {
      const s = field(name);
      if (s === undefined || s === "") return s === "" ? null : undefined;
      if (!/^-?\d+$/.test(s)) throw malformed(`${name}: 정수여야 합니다.`);
      return Number(s);
    };

    const file = form.file;
    if (file !== undefined && !(file instanceof File))
      throw malformed("file: 파일이어야 합니다.");
    if (file) {
      if (file.size > LIMITS.uploadMaxBytes) {
        throw new ApiError(413, "FILE_TOO_LARGE", undefined, {
          limit: LIMITS.uploadMaxBytes,
        });
      }
    }
    const bytes = file ? new Uint8Array(await file.arrayBuffer()) : null;
    const contentType = bytes && bytes.byteLength ? sniff(bytes) : null;
    if (bytes && bytes.byteLength && !contentType)
      throw new ApiError(415, "FILE_TYPE_REJECTED");

    const fe = new FieldErrors();
    if (!bytes || !bytes.byteLength) fe.add("file", "REQUIRED");
    const key = checkSittingKey(
      {
        kindId: intField("kindId"),
        number: intField("number"),
        year: intField("year"),
        semester: intField("semester"),
      },
      fe,
    );
    const nickname = checkNickname(field("nickname"), fe);
    fe.throwIfAny();

    const row = {
      id: nextId(ctx.state, "reports"),
      courseId: course.id,
      ...key!,
      uploaderId: user.id,
      nickname,
      fileName: (file as File).name || "upload",
      contentType: contentType!,
      bytes: bytes!,
      status: "pending" as const,
      reviewerId: null,
      reviewedAt: null,
      reviewNote: null,
      linkedStatisticId: null,
      createdAt: ctx.now(),
    };
    ctx.state.reports.push(row);
    log(
      ctx,
      user.id,
      "pending_report_create",
      { reportId: row.id, courseId: course.id },
      clientIp(c),
    );
    return c.json(v.pendingReport(ctx, row), 201);
  });

  r.post(
    "/courses/:courseId/voting-requests",
    guard(ctx, "write"),
    async (c) => {
      const user = me(c);
      const course = requireCourse(ctx, pathId(c, "courseId"));
      const body = await readJson(c);
      const fe = new FieldErrors();
      const key = checkSittingKey(readSittingKey(body), fe);
      const rawNote = str(body, "note", { nullable: true });
      const note = rawNote?.trim() || null;
      checkMaxLength(note, LIMITS.votingRequestNoteMaxLength, "note", fe);
      fe.throwIfAny();
      const { sitting } = getOrCreateSitting(ctx, course.id, key!);
      if (isVotingOpen(ctx, sitting)) throw conflict("VOTING_ALREADY_OPEN");
      if (
        ctx.state.votingRequests.some(
          (x) =>
            x.sittingId === sitting.id &&
            x.userId === user.id &&
            x.status === "open",
        )
      ) {
        throw conflict("VOTING_REQUEST_EXISTS");
      }
      const row = {
        id: nextId(ctx.state, "votingRequests"),
        sittingId: sitting.id,
        userId: user.id,
        note,
        status: "open" as const,
        createdAt: ctx.now(),
        resolvedAt: null,
        resolvedBy: null,
      };
      ctx.state.votingRequests.push(row);
      log(
        ctx,
        user.id,
        "voting_request_create",
        { requestId: row.id, sittingId: sitting.id },
        clientIp(c),
      );
      return c.json(v.votingRequest(ctx, row), 201);
    },
  );

  r.delete("/voting-requests/:requestId", guard(ctx, "write"), (c) => {
    const user = me(c);
    const id = pathId(c, "requestId");
    const row = ctx.state.votingRequests.find((x) => x.id === id);
    if (!row) throw notFound("투표 요청을 찾을 수 없습니다.");
    if (row.userId !== user.id) throw new ApiError(403, "NOT_REQUEST_OWNER");
    if (row.status !== "open") throw conflict("VOTING_REQUEST_NOT_OPEN");
    row.status = "cancelled";
    row.resolvedAt = ctx.now();
    row.resolvedBy = user.id;
    log(
      ctx,
      user.id,
      "voting_request_cancel",
      { requestId: row.id },
      clientIp(c),
    );
    return c.body(null, 204);
  });

  r.put("/sittings/:sittingId/vote", guard(ctx, "write"), async (c) => {
    const user = me(c);
    const sitting = requireSitting(ctx, pathId(c, "sittingId"));
    const rating = int(await readJson(c, ["rating"]), "rating");
    const fe = new FieldErrors();
    if (rating === undefined) fe.add("rating", "REQUIRED");
    else if (rating! < 1 || rating! > 5) fe.add("rating", "VALUE_OUT_OF_RANGE");
    fe.throwIfAny();
    if (!isVotingOpen(ctx, sitting)) throw conflict("VOTING_NOT_OPEN");
    const now = ctx.now();
    let vote = ctx.state.votes.find(
      (x) => x.sittingId === sitting.id && x.userId === user.id,
    );
    if (vote) {
      vote.rating = rating!;
      vote.updatedAt = now;
    } else {
      vote = {
        id: nextId(ctx.state, "votes"),
        sittingId: sitting.id,
        userId: user.id,
        rating: rating!,
        createdAt: now,
        updatedAt: now,
      } satisfies VoteRow;
      ctx.state.votes.push(vote);
    }
    log(
      ctx,
      user.id,
      "vote_cast",
      { sittingId: sitting.id, rating: vote.rating },
      clientIp(c),
    );
    return c.json({
      voting: v.voting(ctx, sitting),
      difficulty: v.difficulty(ctx, sitting),
      myRating: vote.rating,
    });
  });

  return r;
}
