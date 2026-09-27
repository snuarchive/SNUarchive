import { replace } from "react-router";

/** A same-site path from a form's redirectTo field, or the fallback. */
export function safePath(
  value: FormDataEntryValue | null,
  fallback: string,
): string {
  const to = typeof value === "string" ? value : "";
  return to.startsWith("/") && !to.startsWith("//") ? to : fallback;
}

/**
 * Sends the browser back where the form was. A replace, so toggles such as
 * favourites do not stack history entries when submitted by a fetcher.
 */
export function back(form: FormData, fallback: string): Response {
  return replace(safePath(form.get("redirectTo"), fallback));
}
