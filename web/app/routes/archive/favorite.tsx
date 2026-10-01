import { redirect } from "react-router";

import { apiContext, failureOf } from "~/api/client.server";
import { errorMessage } from "~/lib/errors";
import { flashContext } from "~/lib/flash.server";
import { back } from "~/lib/redirect.server";
import { requireMe } from "~/lib/viewer.server";
import type { Route } from "./+types/favorite";

export async function action({ request, params, context }: Route.ActionArgs) {
  await requireMe(context);
  const form = await request.formData();
  const on = form.get("favorite") === "on";
  const courseId = Number(params.courseId);
  const client = context.get(apiContext).client;
  const options = { params: { path: { courseId } } };

  const failure = failureOf(
    on
      ? await client.PUT("/courses/{courseId}/favorite", options)
      : await client.DELETE("/courses/{courseId}/favorite", options),
  );

  const flash = context.get(flashContext);
  if (failure) flash.put(errorMessage(failure.error), "error");
  else
    flash.put(on ? "즐겨찾기에 추가했습니다." : "즐겨찾기에서 제거했습니다.");
  return back(form, `/courses/${courseId}`);
}

export function loader({ params }: Route.LoaderArgs) {
  return redirect(`/courses/${params.courseId}`);
}
