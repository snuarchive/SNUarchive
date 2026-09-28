import { randomBytes } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Ctx } from "./domain";
import { findUser, isAdmin } from "./domain";
import { adminRequired, csrfInvalid, unauthenticated } from "./errors";
import type { UserRow } from "./state";

export type Env = {
  Variables: {
    requestId: string;
    user: UserRow | null;
  };
};

export const SESSION_COOKIE = "snu_session";
export const CSRF_COOKIE = "snu_csrf";
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function secure(ctx: Ctx): boolean {
  return ctx.options.appOrigin.startsWith("https:");
}

/** Creates a session for the user and sets both cookies. */
export function startSession(c: Context<Env>, ctx: Ctx, user: UserRow): void {
  const token = randomBytes(24).toString("base64url");
  const maxAge = Math.floor(ctx.options.sessionTtlMs / 1000);
  ctx.sessions.set(token, {
    token,
    userId: user.id,
    email: user.email ?? "",
    epoch: user.sessionEpoch,
    expiresAt: ctx.now() + ctx.options.sessionTtlMs,
  });
  const base = {
    path: "/",
    sameSite: "Lax" as const,
    secure: secure(ctx),
    maxAge,
  };
  setCookie(c, SESSION_COOKIE, token, { ...base, httpOnly: true });
  setCookie(c, CSRF_COOKIE, randomBytes(18).toString("base64url"), base);
}

export function clearSessionCookies(c: Context<Env>, ctx: Ctx): void {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) ctx.sessions.delete(token);
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: secure(ctx) });
  deleteCookie(c, CSRF_COOKIE, { path: "/", secure: secure(ctx) });
}

/** Resolves the session cookie to a live user, or null. Runs on every API request. */
export function sessionMiddleware(ctx: Ctx): MiddlewareHandler<Env> {
  return async (c, next) => {
    c.set("user", resolveUser(c, ctx));
    await next();
  };
}

function resolveUser(c: Context<Env>, ctx: Ctx): UserRow | null {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const session = ctx.sessions.get(token);
  if (!session) return null;
  const user = findUser(ctx, session.userId);
  const now = ctx.now();
  if (
    !user ||
    user.deletedAt !== null ||
    user.email !== session.email ||
    user.sessionEpoch !== session.epoch ||
    session.expiresAt <= now
  ) {
    ctx.sessions.delete(token);
    return null;
  }
  user.lastSeenAt = now;
  user.lastIp = clientIp(c);
  return user;
}

export function clientIp(c: Context): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return c.req.header("x-real-ip") ?? "127.0.0.1";
}

export type GuardLevel = "user" | "write" | "admin" | "adminWrite";

/**
 * Checks, in order: a session (401), the CSRF token and Origin on unsafe
 * methods (403 CSRF_INVALID), then admin rights (403 ADMIN_REQUIRED).
 */
export function guard(ctx: Ctx, level: GuardLevel): MiddlewareHandler<Env> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) throw unauthenticated();
    if (level === "write" || level === "adminWrite" || UNSAFE.has(c.req.method))
      checkCsrf(c, ctx);
    if ((level === "admin" || level === "adminWrite") && !isAdmin(ctx, user))
      throw adminRequired();
    await next();
  };
}

function checkCsrf(c: Context<Env>, ctx: Ctx): void {
  const cookie = getCookie(c, CSRF_COOKIE);
  const header = c.req.header("x-csrf-token");
  const origin = c.req.header("origin");
  if (
    !cookie ||
    !header ||
    cookie !== header ||
    origin !== ctx.options.appOrigin
  )
    throw csrfInvalid();
}

/** The signed-in user; only call behind `guard`. */
export function me(c: Context<Env>): UserRow {
  const user = c.get("user");
  if (!user) throw unauthenticated();
  return user;
}

/** `POST /auth/dev-login` checks only Origin: there is no session, so no CSRF token. */
export function checkOrigin(c: Context<Env>, ctx: Ctx): void {
  if (c.req.header("origin") !== ctx.options.appOrigin) throw csrfInvalid();
}

// U+0000–U+001F, U+007F and space, as the contract lists them.
const UNSAFE_NEXT_CHAR = /[\u0000-\u001f\u007f ]/;

/**
 * The `next` rule of `GET /auth/google`: a same-origin path, or null when the
 * value must be ignored.
 */
export function safeNext(
  next: string | undefined,
  appOrigin: string,
): string | null {
  if (!next || next[0] !== "/") return null;
  if (next[1] === "/" || next[1] === "\\") return null;
  if (next.includes("\\") || UNSAFE_NEXT_CHAR.test(next)) return null;
  try {
    if (new URL(next, appOrigin).origin !== new URL(appOrigin).origin)
      return null;
  } catch {
    return null;
  }
  return next;
}

/** Adds `auth=ok` as a query parameter, keeping any query string and fragment. */
export function withAuthOk(next: string): string {
  const hash = next.indexOf("#");
  const path = hash < 0 ? next : next.slice(0, hash);
  const fragment = hash < 0 ? "" : next.slice(hash);
  const sep = !path.includes("?")
    ? "?"
    : path.endsWith("?") || path.endsWith("&")
      ? ""
      : "&";
  return `${path}${sep}auth=ok${fragment}`;
}
