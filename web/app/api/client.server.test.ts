// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiSession } from "./client.server";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

/** Makes one call through a session and returns the request the API saw. */
async function sent(headers: Record<string, string>, method = "GET") {
  const seen: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      seen.push(request);
      return new Response(null, { status: 204 });
    }),
  );
  const session = new ApiSession(new Request("http://web.test/", { headers }));
  if (method === "GET") await session.client.GET("/me");
  else await session.client.POST("/auth/logout");
  return seen[0];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiSession", () => {
  it("passes on the proxy's request id and client address", async () => {
    const request = await sent({
      "X-Request-ID": ID,
      "X-Forwarded-For": "203.0.113.7",
    });
    expect(request.headers.get("X-Request-ID")).toBe(ID);
    expect(request.headers.get("X-Forwarded-For")).toBe("203.0.113.7");
  });

  it("replaces a missing or malformed request id", async () => {
    const cases: Record<string, string>[] = [
      {},
      { "X-Request-ID": "has spaces" },
      { "X-Request-ID": "x".repeat(65) },
    ];
    for (const headers of cases) {
      const id = (await sent(headers)).headers.get("X-Request-ID");
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("keeps any id the Go server would accept, not only UUIDs", async () => {
    const id = "0123456789abcdef0123456789abcdef";
    const request = await sent({ "X-Request-ID": id });
    expect(request.headers.get("X-Request-ID")).toBe(id);
  });

  it("forwards only the API's cookies, with CSRF on unsafe calls", async () => {
    const request = await sent(
      { Cookie: "snu_session=s; snu_csrf=c; web_flash=f" },
      "POST",
    );
    expect(request.headers.get("Cookie")).toBe("snu_session=s; snu_csrf=c");
    expect(request.headers.get("X-CSRF-Token")).toBe("c");
    expect(request.headers.get("Origin")).toBe("http://localhost:5173");
  });

  it("gets a lost CSRF cookie back from /me before an unsafe call", async () => {
    const seen: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        seen.push(request);
        if (new URL(request.url).pathname.endsWith("/me")) {
          return new Response("{}", {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": "snu_csrf=fresh; Path=/; SameSite=Lax",
            },
          });
        }
        return new Response(null, { status: 204 });
      }),
    );
    const session = new ApiSession(
      new Request("http://web.test/", { headers: { Cookie: "snu_session=s" } }),
    );
    await session.client.POST("/auth/logout");
    expect(seen.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "GET /api/v1/me",
      "POST /api/v1/auth/logout",
    ]);
    expect(seen[1].headers.get("X-CSRF-Token")).toBe("fresh");
    expect(session.setCookies).toEqual([
      "snu_csrf=fresh; Path=/; SameSite=Lax",
    ]);
  });

  it("does not fetch /me for an unsafe call without a session", async () => {
    const request = await sent({}, "POST");
    expect(new URL(request.url).pathname).toBe("/api/v1/auth/logout");
  });
});
