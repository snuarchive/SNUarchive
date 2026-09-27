import type { Catalog, CatalogCourse } from "./catalog";
import { loadCatalog } from "./catalog";
import type { MockOptions } from "./config";
import { notFound } from "./errors";
import type { LogRow, SessionRow, SittingRow, State, UserRow } from "./state";
import { nextId } from "./state";
import type { ActivityAction } from "./types";

/** Everything a handler needs. `state` is swapped wholesale by `/__mock/reset`. */
export interface Ctx {
  catalog: Catalog;
  options: MockOptions;
  state: State;
  /** Kept outside `state` so seeded accounts stay signed in across a reset. */
  sessions: Map<string, SessionRow>;
  now(): number;
}

export function createCtx(
  options: MockOptions,
  seed: (ctx: Ctx) => State,
): Ctx {
  const ctx: Ctx = {
    catalog: loadCatalog(options.catalogDir),
    options,
    state: undefined as unknown as State,
    sessions: new Map(),
    now: () => options.now().getTime(),
  };
  ctx.state = seed(ctx);
  return ctx;
}

// ------------------------------------------------------------------ users

export function isEnvAdmin(ctx: Ctx, user: UserRow): boolean {
  return (
    !user.deletedAt &&
    !!user.email &&
    ctx.options.adminEmails.includes(user.email)
  );
}

export function isAdmin(ctx: Ctx, user: UserRow): boolean {
  return !user.deletedAt && (user.dbAdmin || isEnvAdmin(ctx, user));
}

export function adminSource(
  ctx: Ctx,
  user: UserRow,
): "db" | "env" | "both" | null {
  if (user.deletedAt) return null;
  const env = isEnvAdmin(ctx, user);
  if (user.dbAdmin && env) return "both";
  if (user.dbAdmin) return "db";
  if (env) return "env";
  return null;
}

export function findUser(ctx: Ctx, id: number): UserRow | undefined {
  return ctx.state.users.find((u) => u.id === id);
}

export function liveUserByEmail(ctx: Ctx, email: string): UserRow | undefined {
  const e = email.toLowerCase();
  return ctx.state.users.find((u) => !u.deletedAt && u.email === e);
}

/** Upsert on sign-in, as the OAuth callback and dev-login both do. */
export function signIn(
  ctx: Ctx,
  email: string,
  displayName: string | null | undefined,
  ip: string,
): UserRow {
  const now = ctx.now();
  let user = liveUserByEmail(ctx, email);
  if (!user) {
    user = {
      id: nextId(ctx.state, "users"),
      email: email.toLowerCase(),
      displayName: displayName ?? null,
      dbAdmin: false,
      college: null,
      admissionYear: null,
      lastIp: ip,
      sessionEpoch: 0,
      createdAt: now,
      lastSeenAt: now,
      deletedAt: null,
    };
    ctx.state.users.push(user);
  } else if (displayName !== undefined && displayName !== null) {
    user.displayName = displayName;
  }
  user.lastSeenAt = now;
  user.lastIp = ip;
  log(ctx, user.id, "login", { email: user.email }, ip);
  return user;
}

/** Guessed from a student-number local part such as `2021-12345@`. */
export function suggestedAdmissionYear(email: string | null): number | null {
  const m = /^(\d{4})-\d+@/.exec(email ?? "");
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1980 && y <= 2100 ? y : null;
}

/** Legacy rule (api/_utils.js maskDisplayName): keep the first and last character. */
export function maskName(user: UserRow | undefined): string | null {
  if (!user || user.deletedAt) return null;
  const source =
    (user.displayName ?? "").trim() || (user.email ?? "").split("@")[0];
  const chars = [...source];
  if (!chars.length) return null;
  if (chars.length === 1) return chars[0];
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${"*".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

// ---------------------------------------------------------------- catalog

export function requireCourse(ctx: Ctx, id: number): CatalogCourse {
  const course = ctx.catalog.byId.get(id);
  if (!course) throw notFound("강의를 찾을 수 없습니다.");
  return course;
}

// --------------------------------------------------------------- sittings

export interface SittingKey {
  kindId: number;
  number: number | null;
  year: number;
  semester: 1 | 2 | 3 | 4;
}

export function findSitting(
  ctx: Ctx,
  courseId: number,
  key: SittingKey,
): SittingRow | undefined {
  return ctx.state.sittings.find(
    (s) =>
      s.courseId === courseId &&
      s.kindId === key.kindId &&
      s.number === key.number &&
      s.year === key.year &&
      s.semester === key.semester,
  );
}

export function getOrCreateSitting(
  ctx: Ctx,
  courseId: number,
  key: SittingKey,
): { sitting: SittingRow; created: boolean } {
  const existing = findSitting(ctx, courseId, key);
  if (existing) return { sitting: existing, created: false };
  const sitting: SittingRow = {
    id: nextId(ctx.state, "sittings"),
    courseId,
    ...key,
    votingOpenedAt: null,
    votingClosesAt: null,
    votingEndedAt: null,
    votesCountedFrom: null,
    createdAt: ctx.now(),
  };
  ctx.state.sittings.push(sitting);
  return { sitting, created: true };
}

export function requireSitting(ctx: Ctx, id: number): SittingRow {
  const s = ctx.state.sittings.find((x) => x.id === id);
  if (!s) throw notFound("시험 회차를 찾을 수 없습니다.");
  return s;
}

export function votingState(
  s: SittingRow,
  now: number,
): "never" | "open" | "closed" {
  if (s.votingOpenedAt === null) return "never";
  if (
    s.votingEndedAt === null &&
    (s.votingClosesAt === null || s.votingClosesAt > now)
  )
    return "open";
  return "closed";
}

export function isVotingOpen(ctx: Ctx, s: SittingRow): boolean {
  return votingState(s, ctx.now()) === "open";
}

/** Opens or reopens voting and fulfils every open request on the sitting. */
export function openVoting(
  ctx: Ctx,
  s: SittingRow,
  closesAt: number | null,
  admin: UserRow,
): void {
  const now = ctx.now();
  s.votingOpenedAt = now;
  s.votingClosesAt = closesAt;
  s.votingEndedAt = null;
  const fulfilled = fulfilRequests(ctx, s.id, admin.id, "fulfilled");
  bumpContent(ctx);
  log(ctx, admin.id, "voting_open", {
    sittingId: s.id,
    closesAt: iso(closesAt),
    fulfilledRequests: fulfilled,
  });
}

export function fulfilRequests(
  ctx: Ctx,
  sittingId: number,
  adminId: number,
  status: "fulfilled" | "rejected",
): number {
  let n = 0;
  for (const r of ctx.state.votingRequests) {
    if (r.sittingId === sittingId && r.status === "open") {
      r.status = status;
      r.resolvedAt = ctx.now();
      r.resolvedBy = adminId;
      n++;
    }
  }
  return n;
}

export function countedVotes(ctx: Ctx, s: SittingRow) {
  // A vote's time is its latest change: re-rating after the cutoff counts again.
  return ctx.state.votes.filter(
    (v) =>
      v.sittingId === s.id &&
      (s.votesCountedFrom === null || v.updatedAt >= s.votesCountedFrom),
  );
}

export function visibleStatistics(ctx: Ctx, sittingId: number) {
  return ctx.state.statistics
    .filter((st) => st.sittingId === sittingId && st.hiddenAt === null)
    .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
}

// -------------------------------------------------------------------- log

export function log(
  ctx: Ctx,
  userId: number | null,
  action: ActivityAction,
  metadata: Record<string, unknown> = {},
  ip: string | null = userId === null ? null : "127.0.0.1",
): LogRow {
  const row: LogRow = {
    id: nextId(ctx.state, "logs"),
    userId,
    action,
    metadata,
    ip,
    createdAt: ctx.now(),
  };
  ctx.state.logs.push(row);
  return row;
}

export function bumpContent(ctx: Ctx): void {
  ctx.state.contentVersion++;
}

// ------------------------------------------------------------------ utils

export function iso(ms: number): string;
export function iso(ms: number | null): string | null;
export function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}
