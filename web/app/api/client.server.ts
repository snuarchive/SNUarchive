import createClient, { type Middleware } from "openapi-fetch";
import { createContext, data } from "react-router";

import { env } from "~/lib/env.server";
import type { components, paths } from "./schema";

export type Schemas = components["schemas"];
export type ApiError = Schemas["Error"]["error"];
export type FieldError = Schemas["FieldError"];

/** Cookies owned by the API; only these are forwarded to it. */
const API_COOKIES = ["snu_session", "snu_csrf"] as const;
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** The request ids the Go server accepts from a trusted proxy. */
const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

function parseCookieHeader(header: string | null): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of header?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return jar;
}

/**
 * One per incoming request. Calls the API as the browser's user: forwards the
 * API's cookies, adds the CSRF header and Origin on unsafe methods, and
 * collects Set-Cookie headers so the root middleware can pass them on to the
 * browser. Cookies the API sets are also used by later calls in the same
 * request (sign-in followed by /me, for example).
 */
export class ApiSession {
  readonly client;
  readonly setCookies: string[] = [];
  private readonly jar: Map<string, string>;
  private readonly forwardedFor: string | null;
  /** Ties this request's API calls to the proxy's log line for it. */
  readonly requestId: string;

  constructor(request: Request) {
    const incoming = parseCookieHeader(request.headers.get("Cookie"));
    this.jar = new Map(
      API_COOKIES.flatMap((name) =>
        incoming.has(name) ? [[name, incoming.get(name)!] as const] : [],
      ),
    );
    // The client address as the front proxy saw it. The Go server trusts it
    // only from Caddy and this app (see docs/frontend/plan.md, 1.6).
    this.forwardedFor = request.headers.get("X-Forwarded-For");
    // Caddy sets one; a missing value, or one the Go server would refuse,
    // gets a fresh one so every API log line still carries an id.
    const incomingId = request.headers.get("X-Request-ID");
    this.requestId =
      incomingId && REQUEST_ID.test(incomingId)
        ? incomingId
        : crypto.randomUUID();
    this.client = createClient<paths>({
      baseUrl: `${env.apiOrigin}/api/v1`,
    });
    this.client.use(this.middleware());
  }

  get signedIn(): boolean {
    return this.jar.has("snu_session");
  }

  private middleware(): Middleware {
    return {
      onRequest: ({ request }) => {
        const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
        if (cookie) request.headers.set("Cookie", cookie);
        if (this.forwardedFor) {
          request.headers.set("X-Forwarded-For", this.forwardedFor);
        }
        request.headers.set("X-Request-ID", this.requestId);
        if (UNSAFE.has(request.method)) {
          const csrf = this.jar.get("snu_csrf");
          if (csrf) request.headers.set("X-CSRF-Token", csrf);
          request.headers.set("Origin", env.appOrigin);
        }
        return request;
      },
      onResponse: ({ response }) => {
        for (const line of response.headers.getSetCookie()) {
          this.setCookies.push(line);
          this.remember(line);
        }
        return response;
      },
    };
  }

  private remember(setCookie: string) {
    const [pair, ...attributes] = setCookie.split(";");
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const expired = attributes.some((attr) => {
      const [key, val] = attr.trim().split("=");
      if (key.toLowerCase() === "max-age") return Number(val) <= 0;
      if (key.toLowerCase() === "expires") return Date.parse(val) <= Date.now();
      return false;
    });
    if (expired || value === "") this.jar.delete(name);
    else this.jar.set(name, value);
  }
}

export const apiContext = createContext<ApiSession>();

/** A non-2xx API answer, carried as a value so actions can show it. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError,
  ) {
    super(`${status} ${error.code}: ${error.message}`);
  }

  get fields(): FieldError[] {
    const fields = this.error.details?.fields;
    return Array.isArray(fields) ? (fields as FieldError[]) : [];
  }
}

type Result<T> = {
  data?: T;
  error?: unknown;
  response: Response;
};

/** The failure carried by a result, or null when it succeeded. */
export function failureOf(result: Result<unknown>): ApiFailure | null {
  return result.response.ok ? null : toFailure(result);
}

function toFailure(result: Result<unknown>): ApiFailure {
  const body = result.error as { error?: ApiError } | undefined;
  return new ApiFailure(
    result.response.status,
    body?.error ?? {
      code: "INTERNAL",
      message: `API ${result.response.status}`,
    },
  );
}

/**
 * Unwraps a result or throws an ApiFailure. Use in actions, where the failure
 * is caught and shown next to the form.
 */
export async function expectOk<T>(pending: Promise<Result<T>>): Promise<T> {
  const result = await pending;
  if (result.response.ok) return result.data as T;
  throw toFailure(result);
}

/**
 * Unwraps a result for a loader. Failures become route error responses: 401
 * renders the sign-in screen, 403 the permission page, others the error page.
 */
export async function load<T>(pending: Promise<Result<T>>): Promise<T> {
  const result = await pending;
  if (result.response.ok) return result.data as T;
  const failure = toFailure(result);
  throw data(failure.error, { status: failure.status });
}
