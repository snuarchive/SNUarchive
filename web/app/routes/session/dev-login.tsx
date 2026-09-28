import { data, redirect } from "react-router";

import { apiContext } from "~/api/client.server";
import { env } from "~/lib/env.server";
import { flashContext } from "~/lib/flash.server";
import { safePath } from "~/lib/redirect.server";
import { withAuthOk } from "~/lib/signIn";
import type { Route } from "./+types/dev-login";

export async function action({ request, context }: Route.ActionArgs) {
  if (!env.devLogin) throw data(null, { status: 404 });

  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const next = safePath(form.get("next"), "/");
  const { response } = await context
    .get(apiContext)
    .client.POST("/auth/dev-login", { body: { email } });

  if (!response.ok) {
    context
      .get(flashContext)
      .put(
        "개발용 로그인에 실패했습니다. @snu.ac.kr 주소인지 확인하세요.",
        "error",
      );
    return redirect(next);
  }
  // Same landing as the OAuth callback (next plus auth=ok), so the toast and
  // redirects match.
  return redirect(withAuthOk(next));
}

export function loader() {
  return redirect("/");
}
