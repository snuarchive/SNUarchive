import { redirect } from "react-router";

import { apiContext } from "~/api/client.server";
import type { Route } from "./+types/logout";

export async function action({ context }: Route.ActionArgs) {
  // The API answers with cookie-clearing Set-Cookie headers, which the root
  // middleware passes on. A stale session (401) is signed out all the same.
  await context.get(apiContext).client.POST("/auth/logout");
  return redirect("/");
}

export function loader() {
  return redirect("/");
}
