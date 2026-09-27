import { Hono } from "hono";
import type { Env } from "../auth";
import {
  clearSessionCookies,
  clientIp,
  guard,
  me,
  startSession,
} from "../auth";
import type { Ctx } from "../domain";
import { log, signIn } from "../domain";
import { confirmationRequired, FieldErrors } from "../errors";
import { int, paginate, readJson, str } from "../input";
import { COLLEGES, configBody, LIMITS } from "../refdata";
import * as v from "../views";

const SNU_EMAIL = /^[^\s@]+@snu\.ac\.kr$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function sessionRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  r.get("/config", (c) => c.json(configBody()));

  // Google OAuth emulation: the "Google" page is served by the mock itself.
  r.get("/auth/google", (c) =>
    c.redirect(`${ctx.options.mockOrigin}/__mock/google`, 302),
  );

  r.get("/auth/google/callback", (c) => {
    const app = ctx.options.appOrigin;
    const email = (c.req.query("mock_email") ?? "").trim().toLowerCase();
    if (c.req.query("error") || !email)
      return c.redirect(`${app}/?auth=error`, 302);
    if (!EMAIL.test(email)) return c.redirect(`${app}/?auth=error`, 302);
    if (!SNU_EMAIL.test(email))
      return c.redirect(`${app}/?auth=forbidden`, 302);
    const name = c.req.query("mock_name") ?? null;
    const user = signIn(ctx, email, name, clientIp(c));
    startSession(c, ctx, user);
    return c.redirect(`${app}/?auth=ok`, 302);
  });

  r.post("/auth/logout", guard(ctx, "write"), (c) => {
    clearSessionCookies(c, ctx);
    return c.body(null, 204);
  });

  // Always enabled in the mock; the backend registers it only in development.
  r.post("/auth/dev-login", async (c) => {
    const body = await readJson(c, ["email", "displayName"]);
    const email = str(body, "email");
    const displayName = str(body, "displayName", { nullable: true });
    const fe = new FieldErrors();
    if (email === undefined) fe.add("email", "REQUIRED");
    else if (!EMAIL.test(email.trim()) || !SNU_EMAIL.test(email.trim()))
      fe.add("email", "INVALID_EMAIL");
    if (displayName && [...displayName].length > LIMITS.displayNameMaxLength)
      fe.add("displayName", "TOO_LONG");
    fe.throwIfAny();
    const user = signIn(
      ctx,
      email!.trim(),
      displayName?.trim() || undefined,
      clientIp(c),
    );
    startSession(c, ctx, user);
    return c.body(null, 204);
  });

  r.get("/me", guard(ctx, "user"), (c) => c.json(v.me(ctx, me(c))));

  r.patch("/me", guard(ctx, "write"), async (c) => {
    const user = me(c);
    const body = await readJson(c, ["college", "admissionYear"]);
    const college = str(body, "college", { nullable: true });
    const admissionYear = int(body, "admissionYear", { nullable: true });
    const fe = new FieldErrors();
    if (college === undefined && admissionYear === undefined)
      fe.add("", "REQUIRED");
    if (college != null && !COLLEGES.some((x) => x.name === college))
      fe.add("college", "INVALID_COLLEGE");
    if (
      admissionYear != null &&
      (admissionYear < LIMITS.admissionYearMin ||
        admissionYear > LIMITS.admissionYearMax)
    ) {
      fe.add("admissionYear", "INVALID_ADMISSION_YEAR");
    }
    fe.throwIfAny();
    if (college !== undefined) user.college = college;
    if (admissionYear !== undefined) user.admissionYear = admissionYear;
    log(
      ctx,
      user.id,
      "profile_update",
      { college: user.college, admissionYear: user.admissionYear },
      clientIp(c),
    );
    return c.json(v.me(ctx, user));
  });

  r.delete("/me", guard(ctx, "write"), (c) => {
    const user = me(c);
    if (c.req.header("x-confirm-delete") !== "true")
      throw confirmationRequired();
    log(ctx, user.id, "account_delete", {}, clientIp(c));
    // Scrub rather than delete; contributions stay attached to an anonymous row.
    Object.assign(user, {
      email: null,
      displayName: null,
      college: null,
      admissionYear: null,
      lastIp: null,
      dbAdmin: false,
      deletedAt: ctx.now(),
      sessionEpoch: user.sessionEpoch + 1,
    });
    clearSessionCookies(c, ctx);
    return c.body(null, 204);
  });

  r.post("/me/logout-all", guard(ctx, "write"), (c) => {
    const user = me(c);
    user.sessionEpoch++;
    log(ctx, user.id, "logout_all", {}, clientIp(c));
    clearSessionCookies(c, ctx);
    return c.body(null, 204);
  });

  r.get("/me/favorites", guard(ctx, "user"), (c) => {
    const user = me(c);
    const rows = ctx.state.favorites
      .filter((f) => f.userId === user.id)
      .sort((a, b) => b.createdAt - a.createdAt);
    return c.json(
      paginate(c, rows, (f) =>
        v.courseSummary(ctx, ctx.catalog.byId.get(f.courseId)!),
      ),
    );
  });

  r.get("/me/favorites/ids", guard(ctx, "user"), (c) => {
    const user = me(c);
    const ids = ctx.state.favorites
      .filter((f) => f.userId === user.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((f) => f.courseId);
    return c.json({ ids });
  });

  return r;
}
