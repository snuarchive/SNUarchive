// An in-process browser stand-in: keeps a cookie jar, sends the CSRF header
// and Origin on unsafe methods, and checks every response against the contract.
import type { MockApp } from "../src/app";
import type { Contract } from "./contract";

export interface Res {
  status: number;
  headers: Headers;
  bytes: Uint8Array;
  // Response bodies are asserted field by field in tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

export interface CallOptions {
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  /** Send `X-CSRF-Token` from the jar (default true on unsafe methods). */
  csrf?: boolean;
  /** Override the Origin header; null omits it. */
  origin?: string | null;
  /** Skip the contract check (for mock-only routes). */
  unchecked?: boolean;
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class Client {
  readonly jar = new Map<string, string>();

  constructor(
    private readonly mock: MockApp,
    private readonly contract: Contract | null,
  ) {}

  get csrfToken(): string | undefined {
    return this.jar.get("snu_csrf");
  }

  async call(
    method: string,
    path: string,
    opts: CallOptions = {},
  ): Promise<Res> {
    const url =
      path.startsWith("/__mock") || path.startsWith("/api/")
        ? path
        : `/api/v1${path}`;
    const headers = new Headers(opts.headers);
    if (this.jar.size)
      headers.set(
        "cookie",
        [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "),
      );
    if (UNSAFE.has(method)) {
      const origin =
        opts.origin === undefined
          ? this.mock.ctx.options.appOrigin
          : opts.origin;
      if (origin !== null && !headers.has("origin"))
        headers.set("origin", origin);
      if (opts.csrf !== false && this.csrfToken && !headers.has("x-csrf-token"))
        headers.set("x-csrf-token", this.csrfToken);
    }
    let body: string | FormData | undefined;
    if (opts.json !== undefined) {
      headers.set("content-type", "application/json");
      body =
        typeof opts.json === "string" ? opts.json : JSON.stringify(opts.json);
    } else if (opts.form) {
      body = opts.form;
    }

    const res = await this.mock.app.request(url, { method, headers, body });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair, ...attrs] = cookie.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired =
        attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === "";
      if (expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = res.headers.get("content-type") ?? "";
    let json: unknown = undefined;
    if (type.startsWith("application/json") && bytes.byteLength)
      json = JSON.parse(Buffer.from(bytes).toString("utf8"));

    if (this.contract && !opts.unchecked && url.startsWith("/api/v1")) {
      const errors = this.contract.check(method, url, {
        status: res.status,
        headers: res.headers,
        bytes,
      });
      if (errors.length) {
        throw new Error(
          `Contract violation for ${method} ${url}:\n  ${errors.join("\n  ")}\nbody: ${Buffer.from(bytes).toString("utf8").slice(0, 800)}`,
        );
      }
    }
    return { status: res.status, headers: res.headers, bytes, json };
  }

  get = (path: string, opts?: CallOptions) => this.call("GET", path, opts);
  post = (path: string, opts?: CallOptions) => this.call("POST", path, opts);
  put = (path: string, opts?: CallOptions) => this.call("PUT", path, opts);
  patch = (path: string, opts?: CallOptions) => this.call("PATCH", path, opts);
  del = (path: string, opts?: CallOptions) => this.call("DELETE", path, opts);

  async login(email: string, displayName?: string): Promise<this> {
    const res = await this.post("/auth/dev-login", {
      json: displayName ? { email, displayName } : { email },
    });
    if (res.status !== 204)
      throw new Error(`dev-login failed for ${email}: ${res.status}`);
    return this;
  }
}
