// Sign-in links bring the user back to the page they signed in from. The API
// checks `next` itself (same-origin paths only) and adds `auth=ok`, which the
// root loader turns into a toast.

const BASE = "http://same-origin.invalid";

/** The Google sign-in link for a page (its path and query). */
export function signInHref(path: string): string {
  const base = "/api/v1/auth/google";
  return path === "/" ? base : `${base}?next=${encodeURIComponent(path)}`;
}

/** A same-origin path with `auth=ok` added, as the OAuth callback does. */
export function withAuthOk(path: string): string {
  const url = new URL(path, BASE);
  url.searchParams.set("auth", "ok");
  return url.pathname + url.search + url.hash;
}
