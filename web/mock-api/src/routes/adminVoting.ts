import { Hono } from "hono";
import type { Env } from "../auth";
import { clientIp, guard, me } from "../auth";
import type { Ctx } from "../domain";
import {
  bumpContent,
  fulfilRequests,
  getOrCreateSitting,
  iso,
  isVotingOpen,
  log,
  openVoting,
  requireCourse,
  requireSitting,
  votingClosedAt,
  votingState,
} from "../domain";
import { conflict, FieldErrors, malformed } from "../errors";
import type { Body } from "../input";
import {
  checkMaxLength,
  checkSittingKey,
  dateTime,
  optionalIdQuery,
  paginate,
  pathId,
  readJson,
  readSittingKey,
  str,
} from "../input";
import { LIMITS } from "../refdata";
import type { SittingRow } from "../state";
import * as v from "../views";

/** `adminListSittings` order, which depends on the `votingState` filter. */
function sittingOrder(state: string): (a: SittingRow, b: SittingRow) => number {
  switch (state) {
    case "open": // Soonest deadline first; open-ended last.
      return (a, b) =>
        (a.votingClosesAt ?? Infinity) - (b.votingClosesAt ?? Infinity) ||
        a.id - b.id;
    case "closed": // Most recently closed or ended first.
      return (a, b) =>
        (votingClosedAt(b) ?? 0) - (votingClosedAt(a) ?? 0) || b.id - a.id;
    default: // `never` and `any`: most recently created first.
      return (a, b) => b.createdAt - a.createdAt || b.id - a.id;
  }
}

/** Reads `VotingOpenInput`; the deadline must be in the future. */
function readClosesAt(
  ctx: Ctx,
  body: Body,
  fe: FieldErrors,
  field = "closesAt",
): number | null {
  if (!("closesAt" in body)) {
    fe.add(field, "REQUIRED");
    return null;
  }
  const closesAt = dateTime(body, "closesAt", { nullable: true }) ?? null;
  if (closesAt !== null && closesAt <= ctx.now())
    fe.add(field, "CLOSES_AT_IN_PAST");
  return closesAt;
}

export function adminVotingRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  r.post(
    "/admin/courses/:courseId/sittings",
    guard(ctx, "adminWrite"),
    async (c) => {
      const admin = me(c);
      const course = requireCourse(ctx, pathId(c, "courseId"));
      const body = await readJson(c);
      const fe = new FieldErrors();
      const key = checkSittingKey(readSittingKey(body), fe);
      let closesAt: number | null = null;
      const openInput = body.openVoting;
      if (openInput !== undefined) {
        if (
          typeof openInput !== "object" ||
          openInput === null ||
          Array.isArray(openInput)
        ) {
          throw malformed("openVoting은 객체여야 합니다.");
        }
        const extra = Object.keys(openInput).filter((k) => k !== "closesAt");
        if (extra.length)
          throw malformed(`알 수 없는 필드: ${extra.join(", ")}`);
        closesAt = readClosesAt(
          ctx,
          openInput as Body,
          fe,
          "openVoting.closesAt",
        );
      }
      fe.throwIfAny();
      const { sitting, created } = getOrCreateSitting(ctx, course.id, key!);
      if (created)
        log(
          ctx,
          admin.id,
          "sitting_create",
          { sittingId: sitting.id, courseId: course.id },
          clientIp(c),
        );
      if (openInput !== undefined && !isVotingOpen(ctx, sitting))
        openVoting(ctx, sitting, closesAt, admin);
      return c.json(v.adminSitting(ctx, sitting), created ? 201 : 200);
    },
  );

  r.get("/admin/sittings", guard(ctx, "admin"), (c) => {
    const state = c.req.query("votingState") ?? "open";
    if (!["open", "closed", "never", "any"].includes(state))
      throw malformed("votingState가 올바르지 않습니다.");
    const courseId = optionalIdQuery(c, "courseId");
    const now = ctx.now();
    const rows = ctx.state.sittings
      .filter(
        (s) =>
          (state === "any" || votingState(s, now) === state) &&
          (courseId === undefined || s.courseId === courseId),
      )
      .sort(sittingOrder(state));
    return c.json(paginate(c, rows, (s) => v.adminSitting(ctx, s)));
  });

  r.post(
    "/admin/sittings/:sittingId/voting",
    guard(ctx, "adminWrite"),
    async (c) => {
      const admin = me(c);
      const sitting = requireSitting(ctx, pathId(c, "sittingId"));
      const body = await readJson(c, ["closesAt"]);
      if (isVotingOpen(ctx, sitting)) throw conflict("VOTING_ALREADY_OPEN");
      const fe = new FieldErrors();
      const closesAt = readClosesAt(ctx, body, fe);
      fe.throwIfAny();
      openVoting(ctx, sitting, closesAt, admin);
      return c.json(v.voting(ctx, sitting));
    },
  );

  r.patch(
    "/admin/sittings/:sittingId/voting",
    guard(ctx, "adminWrite"),
    async (c) => {
      const admin = me(c);
      const sitting = requireSitting(ctx, pathId(c, "sittingId"));
      const body = await readJson(c, ["closesAt"]);
      if (!isVotingOpen(ctx, sitting)) throw conflict("VOTING_NOT_OPEN");
      const fe = new FieldErrors();
      const closesAt = readClosesAt(ctx, body, fe);
      fe.throwIfAny();
      sitting.votingClosesAt = closesAt;
      bumpContent(ctx);
      log(
        ctx,
        admin.id,
        "voting_update",
        { sittingId: sitting.id, closesAt: iso(closesAt) },
        clientIp(c),
      );
      return c.json(v.voting(ctx, sitting));
    },
  );

  r.post(
    "/admin/sittings/:sittingId/voting/close",
    guard(ctx, "adminWrite"),
    (c) => {
      const admin = me(c);
      const sitting = requireSitting(ctx, pathId(c, "sittingId"));
      if (!isVotingOpen(ctx, sitting)) throw conflict("VOTING_NOT_OPEN");
      sitting.votingEndedAt = ctx.now();
      bumpContent(ctx);
      log(
        ctx,
        admin.id,
        "voting_close",
        { sittingId: sitting.id },
        clientIp(c),
      );
      return c.json(v.voting(ctx, sitting));
    },
  );

  r.get("/admin/voting-requests", guard(ctx, "admin"), (c) => {
    const groups = new Map<number, typeof ctx.state.votingRequests>();
    for (const req of ctx.state.votingRequests) {
      if (req.status !== "open") continue;
      const list = groups.get(req.sittingId) ?? [];
      list.push(req);
      groups.set(req.sittingId, list);
    }
    const rows = [...groups.entries()].map(([sittingId, reqs]) => {
      const s = requireSitting(ctx, sittingId);
      const times = reqs.map((x) => x.createdAt);
      return {
        s,
        count: reqs.length,
        first: Math.min(...times),
        last: Math.max(...times),
        notes: reqs
          .filter((x) => x.note)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 20)
          .map((x) => ({ note: x.note!, createdAt: iso(x.createdAt) })),
      };
    });
    rows.sort(
      (a, b) => b.count - a.count || a.first - b.first || a.s.id - b.s.id,
    );
    return c.json(
      paginate(c, rows, (g) => ({
        sitting: v.sittingRef(g.s),
        course: v.courseRef(ctx.catalog.byId.get(g.s.courseId)!),
        openCount: g.count,
        firstRequestedAt: iso(g.first),
        lastRequestedAt: iso(g.last),
        notes: g.notes,
      })),
    );
  });

  r.post(
    "/admin/voting-requests/:sittingId/reject",
    guard(ctx, "adminWrite"),
    async (c) => {
      const admin = me(c);
      const sitting = requireSitting(ctx, pathId(c, "sittingId"));
      const body = await readJson(c, ["note"]);
      const note = str(body, "note", { nullable: true })?.trim() || null;
      const fe = new FieldErrors();
      checkMaxLength(note, LIMITS.reviewNoteMaxLength, "note", fe);
      fe.throwIfAny();
      const rejected = fulfilRequests(ctx, sitting.id, admin.id, "rejected");
      log(
        ctx,
        admin.id,
        "voting_request_reject",
        { sittingId: sitting.id, rejected, note },
        clientIp(c),
      );
      return c.json({ rejected });
    },
  );

  return r;
}
