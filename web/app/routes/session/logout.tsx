import { redirect } from "react-router";

import { apiContext } from "~/api/client.server";
import type { Route } from "./+types/logout";

export async function action({ context }: Route.ActionArgs) {
  // The API always answers 204 with cookie-clearing Set-Cookie headers, even
  // for a missing or broken session, and the root middleware passes them on.
  await context.get(apiContext).client.POST("/auth/logout");
  return redirect("/");
}

export function loader() {
  return redirect("/");
}
