import { type RouterContextProvider } from "react-router";

import { apiContext, load } from "~/api/client.server";
import { seoulParts } from "./time.server";
import { pageUrl } from "./url.server";
import { getConfig } from "./viewer.server";

/** The ?cursor= of a list page, for the API. */
export function cursorOf(request: Request): string | undefined {
  return pageUrl(request).searchParams.get("cursor") ?? undefined;
}

/**
 * Reference data the admin forms need to name sittings. Years are typed as
 * numbers there, so no year list; `currentYear` pre-fills new ones.
 */
export async function sittingOptions(context: Readonly<RouterContextProvider>) {
  const config = await getConfig(context);
  return {
    kinds: config.assessmentKinds,
    semesters: config.semesters,
    currentYear: seoulParts(new Date()).year,
  };
}

const PICKER_RESULTS = 10;

/**
 * Courses for the course pickers when JavaScript is off: the page reloads
 * with ?courseQ=… (the pickers' boxes share the name; the first filled one
 * counts).
 */
export async function courseSearch(
  request: Request,
  context: Readonly<RouterContextProvider>,
) {
  const q = pageUrl(request)
    .searchParams.getAll("courseQ")
    .map((value) => value.trim())
    .find(Boolean);
  if (!q) return [];
  const page = await load(
    context.get(apiContext).client.GET("/courses", {
      params: { query: { q: q.slice(0, 100), limit: PICKER_RESULTS } },
    }),
  );
  return page.items;
}
