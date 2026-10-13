import { replace } from "react-router";

const BASE = "http://same-origin.invalid";

/**
 * A same-site path from a form's redirectTo field, or the fallback. The
 * value is resolved the way a browser would, so `//host`, `/\host` and
 * embedded control characters cannot turn it into another site.
 */
export function safePath(
  value: FormDataEntryValue | null,
  fallback: string,
): string {
  const to = typeof value === "string" ? value : "";
  const suspicious =
    to.includes("\\") || [...to].some((ch) => ch.charCodeAt(0) < 0x20);
  if (!to.startsWith("/") || suspicious) return fallback;
  let url: URL;
  try {
    url = new URL(to, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  return url.pathname + url.search + url.hash;
}

/**
 * Sends the browser back where the form was. A replace, so toggles such as
 * favourites do not stack history entries when submitted by a fetcher.
 */
export function back(form: FormData, fallback: string): Response {
  return replace(safePath(form.get("redirectTo"), fallback));
}
