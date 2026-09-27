import { type RouterContextProvider } from "react-router";

import { seoulParts } from "./time.server";
import { getConfig } from "./viewer.server";

/** The ?cursor= of a list page, for the API. */
export function cursorOf(request: Request): string | undefined {
  return new URL(request.url).searchParams.get("cursor") ?? undefined;
}

/** How many past years admin term pickers offer (see plan §5.2). */
const ADMIN_YEARS_BACK = 6;

/** Reference data the admin forms need to name sittings. */
export async function sittingOptions(context: Readonly<RouterContextProvider>) {
  const config = await getConfig(context);
  const { year } = seoulParts(new Date());
  return {
    kinds: config.assessmentKinds,
    semesters: config.semesters,
    years: Array.from({ length: ADMIN_YEARS_BACK + 2 }, (_, i) => year + 1 - i),
  };
}
