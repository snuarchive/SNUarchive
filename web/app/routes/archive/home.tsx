import { redirect } from "react-router";

import { lastCourseCookie, readCookie } from "~/lib/cookies.server";
import { requireMe } from "~/lib/viewer.server";
import type { Route } from "./+types/home";

// A fresh visit to / reopens the course seen last. Only whole-page loads
// count (typing the address, reloading, returning from sign-in); client-side
// navigations and searches (/?q=…) stay on the empty view, and the Archive
// link clears the cookie first.
export async function loader({ request, context }: Route.LoaderArgs) {
  await requireMe(context);
  const url = new URL(request.url);
  const fetchDest = request.headers.get("Sec-Fetch-Dest");
  const wholePage = fetchDest === null || fetchDest === "document";
  if (wholePage && url.search === "") {
    const courseId = await readCookie<number>(lastCourseCookie, request);
    if (courseId) throw redirect(`/courses/${courseId}`);
  }
  return null;
}

export default function ArchiveHome() {
  return null;
}
