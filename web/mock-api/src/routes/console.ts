import { Hono } from "hono";
import type { Env } from "../auth";
import { clientIp, guard, me } from "../auth";
import { calendarBody, DAY_MS, seoulDayDiff, termStart } from "../calendar";
import type { Ctx } from "../domain";
import {
  adminSource,
  findUser,
  isAdmin,
  iso,
  liveUserByEmail,
  log,
  votingState,
} from "../domain";
import { conflict, malformed, notFound } from "../errors";
import { int, pathId, readJson } from "../input";
import { COLLEGES } from "../refdata";
import type { S } from "../types";
import * as v from "../views";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TREND_DAYS = 30;

export function catalogStatus(ctx: Ctx): S<"CatalogStatus"> {
  const last = [...ctx.state.catalogImports].sort(
    (a, b) => b.startedAt - a.startedAt,
  )[0];
  return {
    lastImport: last
      ? {
          id: last.id,
          startedAt: iso(last.startedAt),
          finishedAt: iso(last.finishedAt),
          status: last.status,
          sourceLabel: last.sourceLabel,
          coursesTotal: last.coursesTotal,
          coursesAdded: last.coursesAdded,
          coursesUnlisted: last.coursesUnlisted,
          offeringsTotal: last.offeringsTotal,
          sectionsTotal: last.sectionsTotal,
          error: last.error,
        }
      : null,
    listedCourses: ctx.catalog.courses.filter((c) => c.listed).length,
    totalCourses: ctx.catalog.courses.length,
  };
}

/** Distinct admin identities: DB grants on live accounts plus every env address. */
export function adminEntries(ctx: Ctx): S<"AdminEntry">[] {
  const out = new Map<string, S<"AdminEntry">>();
  for (const u of ctx.state.users) {
    if (u.deletedAt || !u.email || !isAdmin(ctx, u)) continue;
    out.set(u.email, {
      email: u.email,
      source: adminSource(ctx, u)!,
      user: v.adminUser(ctx, u),
    });
  }
  for (const email of ctx.options.adminEmails) {
    if (!out.has(email)) out.set(email, { email, source: "env", user: null });
  }
  return [...out.values()].sort((a, b) => (a.email < b.email ? -1 : 1));
}

export function consoleRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  r.get("/admin/dashboard", guard(ctx, "admin"), (c) => {
    const now = ctx.now();
    const { currentTerm } = calendarBody(now);
    const since = termStart(currentTerm);
    const st = ctx.state;
    const pending = st.reports.filter((x) => x.status === "pending");
    const openReqs = st.votingRequests.filter((x) => x.status === "open");
    const open = st.sittings.filter((s) => votingState(s, now) === "open");
    const courseOf = new Map(st.sittings.map((s) => [s.id, s.courseId]));
    const liveUsers = st.users.filter((u) => !u.deletedAt);

    const daily = (times: number[]) => {
      const counts = new Array<number>(TREND_DAYS).fill(0);
      for (const t of times) {
        const age = seoulDayDiff(t, now);
        if (age >= 0 && age < TREND_DAYS) counts[TREND_DAYS - 1 - age]++;
      }
      return counts;
    };
    const minOrNull = (xs: number[]) => (xs.length ? Math.min(...xs) : null);

    const body: S<"AdminDashboard"> = {
      term: currentTerm,
      queue: {
        pendingUploads: pending.length,
        oldestPendingUploadAt: iso(minOrNull(pending.map((x) => x.createdAt))),
        openVotingRequests: new Set(openReqs.map((x) => x.sittingId)).size,
        oldestVotingRequestAt: iso(minOrNull(openReqs.map((x) => x.createdAt))),
      },
      thisTerm: {
        statistics: st.statistics.filter((x) => x.createdAt >= since).length,
        votes: st.votes.filter((x) => x.createdAt >= since).length,
        comments: st.comments.filter((x) => x.createdAt >= since).length,
        uploads: st.reports.filter((x) => x.createdAt >= since).length,
      },
      voting: {
        openCount: open.length,
        openEndedCount: open.filter((s) => s.votingClosesAt === null).length,
        closingWithin24h: open.filter(
          (s) => s.votingClosesAt !== null && s.votingClosesAt - now <= DAY_MS,
        ).length,
      },
      coverage: {
        listedCourses: ctx.catalog.courses.filter((x) => x.listed).length,
        withStatistics: new Set(
          st.statistics
            .filter((x) => x.hiddenAt === null)
            .map((x) => courseOf.get(x.sittingId)),
        ).size,
        withVotes: new Set(st.votes.map((x) => courseOf.get(x.sittingId))).size,
      },
      users: {
        total: liveUsers.length,
        admins: adminEntries(ctx).length,
        activeThisTerm: liveUsers.filter(
          (u) => u.lastSeenAt !== null && u.lastSeenAt >= since,
        ).length,
      },
      trend: {
        days: TREND_DAYS,
        statistics: daily(st.statistics.map((x) => x.createdAt)),
        votes: daily(st.votes.map((x) => x.createdAt)),
        uploads: daily(st.reports.map((x) => x.createdAt)),
      },
      catalog: catalogStatus(ctx),
    };
    return c.json(body);
  });

  r.get("/admin/users/summary", guard(ctx, "admin"), (c) => {
    const live = ctx.state.users.filter((u) => !u.deletedAt);
    const byCollege = new Map<string, number>();
    const byYear = new Map<number, number>();
    for (const u of live) {
      if (u.college)
        byCollege.set(u.college, (byCollege.get(u.college) ?? 0) + 1);
      if (u.admissionYear)
        byYear.set(u.admissionYear, (byYear.get(u.admissionYear) ?? 0) + 1);
    }
    const order = (name: string) =>
      COLLEGES.find((x) => x.name === name)?.sortOrder ?? Infinity;
    return c.json({
      totalUsers: live.length,
      withProfile: live.filter(
        (u) => u.college !== null || u.admissionYear !== null,
      ).length,
      byCollege: [...byCollege.entries()]
        .sort((a, b) => order(a[0]) - order(b[0]))
        .map(([college, count]) => ({ college, count })),
      byAdmissionYear: [...byYear.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([year, count]) => ({ year, count })),
    });
  });

  r.get("/admin/users", guard(ctx, "admin"), (c) => {
    const email = c.req.query("email");
    if (email === undefined || !EMAIL.test(email))
      throw malformed("email이 올바르지 않습니다.");
    const user = liveUserByEmail(ctx, email);
    if (!user) throw notFound("계정을 찾을 수 없습니다.");
    return c.json(v.adminUser(ctx, user));
  });

  r.get("/admin/users/:userId", guard(ctx, "admin"), (c) => {
    const user = findUser(ctx, pathId(c, "userId"));
    if (!user) throw notFound("계정을 찾을 수 없습니다.");
    return c.json(v.adminUser(ctx, user));
  });

  r.get("/admin/admins", guard(ctx, "admin"), (c) =>
    c.json({ items: adminEntries(ctx) }),
  );

  r.post("/admin/admins", guard(ctx, "adminWrite"), async (c) => {
    const admin = me(c);
    const userId = int(await readJson(c, ["userId"]), "userId");
    if (userId === undefined) throw malformed("userId가 필요합니다.");
    const user = findUser(ctx, userId!);
    if (!user || user.deletedAt) throw notFound("계정을 찾을 수 없습니다.");
    if (!user.dbAdmin) {
      user.dbAdmin = true;
      log(ctx, admin.id, "admin_grant", { userId: user.id }, clientIp(c));
    }
    return c.json(v.adminUser(ctx, user));
  });

  r.delete("/admin/admins/:userId", guard(ctx, "adminWrite"), (c) => {
    const admin = me(c);
    const user = findUser(ctx, pathId(c, "userId"));
    if (!user || user.deletedAt) throw notFound("계정을 찾을 수 없습니다.");
    const source = adminSource(ctx, user);
    if (source === "env" || source === "both")
      throw conflict("ENV_ADMIN_PROTECTED");
    // Revoking a non-admin is a no-op, mirroring the idempotent grant.
    if (source === null) return c.body(null, 204);
    const remaining = adminEntries(ctx).filter((e) => e.email !== user.email);
    if (!remaining.length) throw conflict("LAST_ADMIN_PROTECTED");
    user.dbAdmin = false;
    user.sessionEpoch++;
    log(ctx, admin.id, "admin_revoke", { userId: user.id }, clientIp(c));
    return c.body(null, 204);
  });

  r.get("/admin/catalog", guard(ctx, "admin"), (c) =>
    c.json(catalogStatus(ctx)),
  );

  r.get("/admin/jobs", guard(ctx, "admin"), (c) =>
    c.json({
      schedulerEnabled: false,
      items: ctx.state.jobs.map((j) => ({
        name: j.name,
        enabled: j.enabled,
        settings: j.settings,
        lastRun: j.lastRun,
      })),
    }),
  );

  return r;
}
