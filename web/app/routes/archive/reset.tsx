import { redirect } from "react-router";

import { lastCourseCookie } from "~/lib/cookies.server";

// The top "Archive" link: forget the last course, then open an empty search.
export async function loader() {
  return redirect("/", {
    headers: {
      "Set-Cookie": await lastCourseCookie.serialize("", { maxAge: 0 }),
    },
  });
}
