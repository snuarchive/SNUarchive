/**
 * The address the user is on. Client-side navigations reach loaders and
 * actions as single-fetch data requests (`/_.data`, `/courses/1.data`,
 * `?_routes=…`), and React Router passes that raw request through; this
 * undoes it the way React Router's own matching does, so redirects built
 * from it point at real pages.
 */
export function pageUrl(request: Request): URL {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/_.data")) {
    url.pathname = url.pathname.slice(0, -"_.data".length);
  } else if (url.pathname.endsWith(".data")) {
    url.pathname = url.pathname.slice(0, -".data".length);
  }
  url.searchParams.delete("_routes");
  return url;
}

/** pathname + search of the page, for redirects back to it. */
export function pagePath(request: Request): string {
  const url = pageUrl(request);
  return url.pathname + url.search;
}
