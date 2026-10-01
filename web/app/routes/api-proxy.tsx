import { env } from "~/lib/env.server";
import type { Route } from "./+types/api-proxy";
import { pageUrl } from "~/lib/url.server";

// Same-origin passthrough to the API for the few browser-direct requests:
// OAuth redirects, admin file previews and log export downloads. In
// production the front proxy sends /api/v1 to the Go server before it
// reaches this app; this route covers development and E2E.

const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "transfer-encoding",
  "host",
  "content-length",
];

async function proxy(request: Request): Promise<Response> {
  // The Go server trusts this app's X-Forwarded-For and X-Request-ID, which
  // this route copies from the browser; it must never serve production.
  if (env.appEnv === "production") {
    throw new Response("Not Found", { status: 404 });
  }
  const url = pageUrl(request);
  const target = new URL(url.pathname + url.search, env.apiOrigin);

  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP) headers.delete(name);

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : request.body,
    redirect: "manual",
    // Required by Node's fetch to stream a request body.
    duplex: "half",
  } as RequestInit);

  const responseHeaders = new Headers(upstream.headers);
  for (const name of HOP_BY_HOP) responseHeaders.delete(name);
  // Node's fetch has already decoded the body.
  responseHeaders.delete("content-encoding");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export function loader({ request }: Route.LoaderArgs) {
  return proxy(request);
}

export function action({ request }: Route.ActionArgs) {
  return proxy(request);
}
