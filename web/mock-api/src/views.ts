// Serializers from internal rows to contract shapes.
import type { CatalogCourse } from "./catalog";
import { calendarBody } from "./calendar";
import type { Ctx } from "./domain";
import {
  adminSource,
  countedVotes,
  findUser,
  isAdmin,
  iso,
  maskName,
  suggestedAdmissionYear,
  visibleStatistics,
  votingState,
} from "./domain";
import { sittingLabel } from "./refdata";
import type {
  CommentRow,
  LogRow,
  ReportRow,
  SittingRow,
  StatisticRow,
  UserRow,
  VotingRequestRow,
} from "./state";
import type { S, Term } from "./types";

export function term(year: number, semester: number): Term {
  return { year, semester: semester as Term["semester"] };
}

export function me(ctx: Ctx, u: UserRow): S<"Me"> {
  return {
    id: u.id,
    email: u.email ?? "",
    displayName: u.displayName,
    isAdmin: isAdmin(ctx, u),
    college: u.college,
    admissionYear: u.admissionYear,
    suggestedAdmissionYear: suggestedAdmissionYear(u.email),
    calendar: calendarBody(ctx.now()),
  };
}

export function userRef(ctx: Ctx, id: number): S<"UserRef"> {
  const u = findUser(ctx, id);
  return {
    id,
    displayName: u?.deletedAt ? null : (u?.displayName ?? null),
    deleted: !u || u.deletedAt !== null,
  };
}

export function adminUser(ctx: Ctx, u: UserRow): S<"AdminUser"> {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    isAdmin: isAdmin(ctx, u),
    adminSource: adminSource(ctx, u),
    createdAt: iso(u.createdAt),
    lastSeenAt: iso(u.lastSeenAt),
    lastIp: u.lastIp,
    deletedAt: iso(u.deletedAt),
  };
}

// ---------------------------------------------------------------- catalog

export function courseRef(c: CatalogCourse): S<"CourseRef"> {
  return { id: c.id, title: c.title, instructor: c.instructor };
}

export function courseSummary(ctx: Ctx, c: CatalogCourse): S<"CourseSummary"> {
  const now = ctx.now();
  const sittings = ctx.state.sittings.filter((s) => s.courseId === c.id);
  const sittingIds = new Set(sittings.map((s) => s.id));
  let latestStatisticAt: number | null = null;
  for (const st of ctx.state.statistics) {
    if (st.hiddenAt === null && sittingIds.has(st.sittingId)) {
      latestStatisticAt = Math.max(latestStatisticAt ?? 0, st.createdAt);
    }
  }
  return {
    id: c.id,
    title: c.title,
    instructor: c.instructor,
    departments: c.departments.slice(0, 2),
    departmentCount: Math.max(1, c.departments.length),
    latestTerm: c.latestTerm,
    votingOpen: sittings.some((s) => votingState(s, now) === "open"),
    latestStatisticAt: iso(latestStatisticAt),
  };
}

// --------------------------------------------------------------- sittings

export function sittingRef(s: SittingRow): S<"SittingRef"> {
  return {
    id: s.id,
    kindId: s.kindId,
    number: s.number,
    label: sittingLabel(s.kindId, s.number),
    term: term(s.year, s.semester),
  };
}

export function voting(ctx: Ctx, s: SittingRow): S<"Voting"> {
  const state = votingState(s, ctx.now());
  return {
    state,
    isOpen: state === "open",
    openedAt: iso(s.votingOpenedAt),
    closesAt: iso(s.votingClosesAt),
    endedAt: iso(s.votingEndedAt),
    countedFrom: iso(s.votesCountedFrom),
  };
}

export function difficulty(ctx: Ctx, s: SittingRow): S<"Difficulty"> {
  const votes = countedVotes(ctx, s);
  const distribution = [0, 0, 0, 0, 0];
  let sum = 0;
  for (const v of votes) {
    distribution[v.rating - 1]++;
    sum += v.rating;
  }
  return {
    voteCount: votes.length,
    average: votes.length ? Math.round((sum / votes.length) * 10) / 10 : null,
    distribution,
  };
}

export function sitting(
  ctx: Ctx,
  s: SittingRow,
  viewer: UserRow,
): S<"Sitting"> {
  const mine = ctx.state.votes.find(
    (v) => v.sittingId === s.id && v.userId === viewer.id,
  );
  const open = ctx.state.votingRequests.filter(
    (r) => r.sittingId === s.id && r.status === "open",
  );
  const myRequest = open.find((r) => r.userId === viewer.id);
  return {
    ...sittingRef(s),
    voting: voting(ctx, s),
    difficulty: difficulty(ctx, s),
    myRating: mine ? mine.rating : null,
    statistics: visibleStatistics(ctx, s.id).map(statistic),
    votingRequests: {
      openCount: open.length,
      mine: myRequest ? votingRequest(ctx, myRequest) : null,
    },
  };
}

export function adminSitting(ctx: Ctx, s: SittingRow): S<"AdminSitting"> {
  return {
    ...sittingRef(s),
    course: courseRef(ctx.catalog.byId.get(s.courseId)!),
    voting: voting(ctx, s),
    difficulty: difficulty(ctx, s),
    statisticCount: ctx.state.statistics.filter(
      (st) => st.sittingId === s.id && st.hiddenAt === null,
    ).length,
    openRequestCount: ctx.state.votingRequests.filter(
      (r) => r.sittingId === s.id && r.status === "open",
    ).length,
  };
}

export function sittingSort(
  a: SittingRow,
  b: SittingRow,
  kindOrder: (id: number) => number,
): number {
  return (
    b.year - a.year ||
    b.semester - a.semester ||
    kindOrder(a.kindId) - kindOrder(b.kindId) ||
    (a.number ?? 0) - (b.number ?? 0) ||
    a.id - b.id
  );
}

export function votingRequest(
  ctx: Ctx,
  r: VotingRequestRow,
): S<"VotingRequest"> {
  const s = ctx.state.sittings.find((x) => x.id === r.sittingId)!;
  return {
    id: r.id,
    sitting: sittingRef(s),
    note: r.note,
    status: r.status,
    createdAt: iso(r.createdAt),
  };
}

// ------------------------------------------------------------- statistics

export function statistic(st: StatisticRow): S<"Statistic"> {
  return {
    id: st.id,
    q1: st.q1,
    q2: st.q2,
    q3: st.q3,
    q4: st.q4,
    average: st.average,
    maxScore: st.maxScore,
    note: st.note,
    nickname: st.nickname,
    source: st.source,
    createdAt: iso(st.createdAt),
    updatedAt: iso(st.updatedAt),
  };
}

export function adminStatistic(
  ctx: Ctx,
  st: StatisticRow,
): S<"AdminStatistic"> {
  const s = ctx.state.sittings.find((x) => x.id === st.sittingId)!;
  return {
    ...statistic(st),
    course: courseRef(ctx.catalog.byId.get(s.courseId)!),
    sitting: sittingRef(s),
    contributor: userRef(ctx, st.contributorId),
    sourceReportId: st.sourceReportId,
    hiddenAt: iso(st.hiddenAt),
    hiddenReason: st.hiddenReason,
  };
}

// ---------------------------------------------------------------- uploads

export function pendingReport(ctx: Ctx, r: ReportRow): S<"PendingReport"> {
  return {
    id: r.id,
    course: courseRef(ctx.catalog.byId.get(r.courseId)!),
    kindId: r.kindId,
    number: r.number,
    label: sittingLabel(r.kindId, r.number),
    term: term(r.year, r.semester),
    nickname: r.nickname,
    file: {
      name: r.fileName,
      contentType: r.contentType,
      bytes: r.bytes.byteLength,
    },
    status: r.status,
    createdAt: iso(r.createdAt),
  };
}

export function adminPendingReport(
  ctx: Ctx,
  r: ReportRow,
): S<"AdminPendingReport"> {
  return {
    ...pendingReport(ctx, r),
    uploader: userRef(ctx, r.uploaderId),
    reviewer: r.reviewerId === null ? null : userRef(ctx, r.reviewerId),
    reviewedAt: iso(r.reviewedAt),
    reviewNote: r.reviewNote,
    linkedStatisticId: r.linkedStatisticId,
    fileUrl: `/api/v1/admin/reports/${r.id}/file`,
  };
}

// --------------------------------------------------------------- comments

export function comment(ctx: Ctx, c: CommentRow): S<"Comment"> {
  return {
    id: c.id,
    body: c.body,
    author: maskName(findUser(ctx, c.userId)),
    createdAt: iso(c.createdAt),
  };
}

export function adminComment(ctx: Ctx, c: CommentRow): S<"AdminComment"> {
  return {
    ...comment(ctx, c),
    course: courseRef(ctx.catalog.byId.get(c.courseId)!),
    user: userRef(ctx, c.userId),
  };
}

// ------------------------------------------------------------------- logs

export function logEntry(ctx: Ctx, l: LogRow): S<"ActivityLogEntry"> {
  return {
    id: l.id,
    user: l.userId === null ? null : userRef(ctx, l.userId),
    action: l.action,
    metadata: l.metadata,
    ip: l.ip,
    createdAt: iso(l.createdAt),
  };
}
