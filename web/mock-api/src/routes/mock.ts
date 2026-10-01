// Mock-only control endpoints, outside /api/v1: no session, no CSRF.
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { Env } from "../auth";
import { calendarBody } from "../calendar";
import type { Ctx } from "../domain";
import { iso } from "../domain";
import { ApiError, ERROR_CODES, malformed } from "../errors";
import type { ErrorCode } from "../types";

export interface Fault {
  method: string;
  path: string;
  status: number;
  code: ErrorCode;
  message?: string;
  details?: Record<string, unknown>;
}

const DEFAULT_CODE: Record<number, ErrorCode> = {
  400: "MALFORMED_REQUEST",
  401: "NOT_AUTHENTICATED",
  403: "CSRF_INVALID",
  404: "NOT_FOUND",
  409: "VOTING_NOT_OPEN",
  413: "FILE_TOO_LARGE",
  415: "FILE_TYPE_REJECTED",
  422: "VALIDATION_FAILED",
  428: "CONFIRMATION_REQUIRED",
};

const API_PREFIX = "/api/v1";

function normalizePath(p: string): string {
  const path = p.split("?")[0].replace(/\/+$/, "") || "/";
  return path.startsWith(API_PREFIX)
    ? path
    : `${API_PREFIX}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** `*` matches within one path segment, e.g. `/courses/*` or `/admin/reports/*` + `/approve`. */
function pathMatches(pattern: string, path: string): boolean {
  const re = new RegExp(
    `^${pattern
      .split("*")
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join("[^/]*")}$`,
  );
  return re.test(path);
}

export class FaultQueue {
  private faults: Fault[] = [];

  add(f: Fault): void {
    this.faults.push(f);
  }

  list(): Fault[] {
    return [...this.faults];
  }

  clear(): void {
    this.faults = [];
  }

  /** Removes and returns the first fault matching the request, if any. */
  take(method: string, path: string): Fault | undefined {
    const i = this.faults.findIndex(
      (f) =>
        (f.method === "*" || f.method === method) &&
        pathMatches(f.path, path.replace(/\/+$/, "") || "/"),
    );
    return i < 0 ? undefined : this.faults.splice(i, 1)[0];
  }

  middleware(): MiddlewareHandler<Env> {
    return async (c, next) => {
      const fault = this.take(c.req.method, new URL(c.req.url).pathname);
      if (fault) {
        const details =
          fault.details ??
          (fault.code === "VALIDATION_FAILED" ? { fields: [] } : undefined);
        throw new ApiError(fault.status, fault.code, fault.message, details);
      }
      await next();
    };
  }
}

export function mockRoutes(ctx: Ctx, faults: FaultQueue, reset: () => void) {
  const r = new Hono<Env>();

  r.get("/health", (c) =>
    c.json({
      ok: true,
      now: iso(ctx.now()),
      currentTerm: calendarBody(ctx.now()).currentTerm,
      courses: ctx.catalog.courses.length,
      users: ctx.state.users.length,
      pendingFaults: faults.list().length,
    }),
  );

  r.post("/reset", (c) => {
    reset();
    return c.json({ ok: true });
  });

  r.get("/faults", (c) => c.json({ items: faults.list() }));

  r.delete("/faults", (c) => {
    faults.clear();
    return c.body(null, 204);
  });

  r.post("/faults", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      throw malformed("JSON 본문이 필요합니다.");
    }
    const {
      method = "*",
      path,
      status,
      code,
      message,
      details,
    } = body as Record<string, unknown>;
    if (typeof method !== "string") throw malformed("method는 문자열입니다.");
    if (typeof path !== "string" || !path)
      throw malformed("path가 필요합니다.");
    if (
      typeof status !== "number" ||
      !Number.isInteger(status) ||
      status < 400 ||
      status > 599
    ) {
      throw malformed("status는 400~599 정수입니다.");
    }
    const resolved = (code ?? DEFAULT_CODE[status] ?? "INTERNAL") as ErrorCode;
    if (!ERROR_CODES.includes(resolved))
      throw malformed(`알 수 없는 code: ${String(code)}`);
    const fault: Fault = {
      method: method.toUpperCase(),
      path: normalizePath(path),
      status,
      code: resolved,
    };
    if (typeof message === "string") fault.message = message;
    if (details && typeof details === "object")
      fault.details = details as Record<string, unknown>;
    faults.add(fault);
    return c.json(fault, 201);
  });

  // Stand-in for Google's account chooser. Links go to the callback on the app
  // origin, where the real Google would send the browser. `state` (the `next`
  // path from /auth/google) is echoed back, as Google echoes OAuth state.
  r.get("/google", (c) => {
    const callback = `${ctx.options.appOrigin}/api/v1/auth/google/callback`;
    const state = c.req.query("state") ?? "";
    const stateParam = state ? `&state=${encodeURIComponent(state)}` : "";
    const accounts: [string, string, string][] = [
      ["admin@snu.ac.kr", "관리자", "admin (ADMIN_EMAILS)"],
      ["moderator@snu.ac.kr", "이운영", "admin (DB grant)"],
      ["student@snu.ac.kr", "김민수", "student with a profile"],
      ["newbie@snu.ac.kr", "박새내", "no profile yet"],
      [
        "2024-10001@snu.ac.kr",
        "신입생",
        "new account, suggested admission year",
      ],
      ["someone@gmail.com", "Someone", "non-SNU → auth=forbidden"],
    ];
    const esc = (s: string) =>
      s.replace(
        /[&<>"]/g,
        (ch) =>
          ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!,
      );
    const link = (email: string, name: string) =>
      `${callback}?mock_email=${encodeURIComponent(email)}&mock_name=${encodeURIComponent(name)}${stateParam}`;
    const items = accounts
      .map(
        ([email, name, note]) =>
          `<li><a href="${esc(link(email, name))}">${esc(email)}</a> <small>${esc(note)}</small></li>`,
      )
      .join("\n");
    return c.html(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>Mock Google sign-in</title>
<style>body{font:15px system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;background:#111;color:#eee}
a{color:#8ab4f8}li{margin:.5rem 0}small{color:#999}input{font:inherit}</style></head>
<body><h1>Mock Google sign-in</h1><p>Choose an account.</p><ul>
${items}
<li><a href="${esc(`${callback}?error=access_denied`)}">Cancel</a> <small>→ auth=error</small></li>
</ul>
<form method="get" action="${esc(callback)}"><input name="mock_email" type="email" placeholder="any@snu.ac.kr" required>
${state ? `<input type="hidden" name="state" value="${esc(state)}">` : ""}
<button>Sign in</button></form></body></html>`);
  });

  return r;
}
