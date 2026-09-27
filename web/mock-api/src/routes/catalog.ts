import { createHash } from "node:crypto";
import { Hono } from "hono";
import type { Env } from "../auth";
import { guard, me } from "../auth";
import type { CatalogCourse } from "../catalog";
import { searchCatalog } from "../catalog";
import type { Ctx } from "../domain";
import { requireCourse, votingState } from "../domain";
import { malformed } from "../errors";
import {
  decodeCursor,
  encodeCursor,
  paginate,
  pathId,
  readLimit,
} from "../input";
import { kindById } from "../refdata";
import type { SittingRow } from "../state";
import * as v from "../views";

const HOME_LIMIT = 10;

export function catalogRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  r.get("/courses", guard(ctx, "user"), (c) => {
    const q = c.req.query("q");
    if (q === undefined || q.length < 1 || [...q].length > 100)
      throw malformed("q는 1~100자입니다.");
    // Validate paging before the ETag so a bad cursor is never "not modified".
    readLimit(c);
    decodeCursor(c.req.query("cursor"));
    // No per-user data, so the tag depends only on content, the minute and the query.
    const minute = Math.floor(ctx.now() / 60_000);
    const etag = `"${createHash("sha1")
      .update(
        [
          ctx.catalog.version,
          ctx.state.contentVersion,
          minute,
          q,
          c.req.query("cursor") ?? "",
          c.req.query("limit") ?? "",
        ].join("\u0000"),
      )
      .digest("base64url")
      .slice(0, 20)}"`;
    const inm = c.req.header("if-none-match");
    if (
      inm &&
      inm.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)
    ) {
      return c.body(null, 304, { ETag: etag });
    }
    const page = paginate(c, searchCatalog(ctx.catalog, q), (course) =>
      v.courseSummary(ctx, course),
    );
    c.header("ETag", etag);
    return c.json(page);
  });

  r.get("/courses/home", guard(ctx, "user"), (c) => {
    const user = me(c);
    const now = ctx.now();
    const listed = (id: number) => {
      const course = ctx.catalog.byId.get(id);
      return course && course.listed ? course : undefined;
    };

    const favorites = ctx.state.favorites
      .filter((f) => f.userId === user.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((f) => listed(f.courseId))
      .filter((x): x is CatalogCourse => !!x)
      .slice(0, HOME_LIMIT);

    // Soonest deadline per course; open-ended sorts last.
    const deadline = new Map<number, number>();
    for (const s of ctx.state.sittings) {
      if (votingState(s, now) !== "open") continue;
      const d = s.votingClosesAt ?? Infinity;
      deadline.set(
        s.courseId,
        Math.min(deadline.get(s.courseId) ?? Infinity, d),
      );
    }
    const votingOpen = [...deadline.entries()]
      .sort((a, b) => a[1] - b[1] || a[0] - b[0])
      .map(([id]) => listed(id))
      .filter((x): x is CatalogCourse => !!x)
      .slice(0, HOME_LIMIT);

    const sittingCourse = new Map(
      ctx.state.sittings.map((s) => [s.id, s.courseId]),
    );
    const latestStat = new Map<number, number>();
    for (const st of ctx.state.statistics) {
      if (st.hiddenAt !== null) continue;
      const courseId = sittingCourse.get(st.sittingId)!;
      latestStat.set(
        courseId,
        Math.max(latestStat.get(courseId) ?? 0, st.createdAt),
      );
    }
    const recentlyUpdated = [...latestStat.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([id]) => listed(id))
      .filter((x): x is CatalogCourse => !!x)
      .slice(0, HOME_LIMIT);

    const requestCount = new Map<number, number>();
    const sittingById = new Map(ctx.state.sittings.map((s) => [s.id, s]));
    for (const req of ctx.state.votingRequests) {
      if (req.status !== "open") continue;
      const s = sittingById.get(req.sittingId)!;
      if (votingState(s, now) === "open") continue;
      requestCount.set(s.courseId, (requestCount.get(s.courseId) ?? 0) + 1);
    }
    const mostRequested = [...requestCount.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([id, n]) => {
        const course = listed(id);
        return course
          ? { ...v.courseSummary(ctx, course), openRequestCount: n }
          : undefined;
      })
      .filter((x) => !!x)
      .slice(0, HOME_LIMIT);

    return c.json({
      favorites: favorites.map((x) => v.courseSummary(ctx, x)),
      votingOpen: votingOpen.map((x) => v.courseSummary(ctx, x)),
      recentlyUpdated: recentlyUpdated.map((x) => v.courseSummary(ctx, x)),
      mostRequested,
    });
  });

  r.get("/courses/:courseId", guard(ctx, "user"), (c) => {
    const user = me(c);
    const course = requireCourse(ctx, pathId(c, "courseId"));
    const order = (id: number) => kindById(id)?.sortOrder ?? 0;
    const sittings = ctx.state.sittings
      .filter((s) => s.courseId === course.id)
      .sort((a: SittingRow, b: SittingRow) => v.sittingSort(a, b, order));
    const comments = commentsOf(ctx, course.id);
    const first = 20;
    return c.json({
      id: course.id,
      title: course.title,
      instructor: course.instructor,
      departments: course.departments,
      offerings: course.offerings,
      isFavorite: ctx.state.favorites.some(
        (f) => f.userId === user.id && f.courseId === course.id,
      ),
      sittings: sittings.map((s) => v.sitting(ctx, s, user)),
      comments: {
        items: comments.slice(0, first).map((x) => v.comment(ctx, x)),
        nextCursor: comments.length > first ? encodeCursor(first) : null,
      },
    });
  });

  r.get("/courses/:courseId/comments", guard(ctx, "user"), (c) => {
    const course = requireCourse(ctx, pathId(c, "courseId"));
    return c.json(
      paginate(c, commentsOf(ctx, course.id), (x) => v.comment(ctx, x)),
    );
  });

  return r;
}

function commentsOf(ctx: Ctx, courseId: number) {
  return ctx.state.comments
    .filter((x) => x.courseId === courseId)
    .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
}
