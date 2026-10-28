import { redirect } from "react-router";

import { apiContext, failureOf } from "~/api/client.server";
import { errorMessage } from "~/lib/errors";
import { readFigures, readNickname } from "~/lib/figures";
import { flashContext } from "~/lib/flash.server";
import { back } from "~/lib/redirect.server";
import { readSittingKey } from "~/lib/sittings";
import { getConfig, requireAdmin } from "~/lib/viewer.server";
import type { Route } from "./+types/report-review";

// Approve (transcribe into a statistic) or reject an upload. Used by the
// review tab and by the course page's admin panel.
export async function action({ request, params, context }: Route.ActionArgs) {
  await requireAdmin(context);
  const form = await request.formData();
  const reportId = Number(params.reportId);
  const client = context.get(apiContext).client;
  const flash = context.get(flashContext);
  const path = { reportId };
  const reviewNote = String(form.get("reviewNote") ?? "").trim() || null;

  if (form.get("intent") === "reject") {
    const failure = failureOf(
      await client.POST("/admin/reports/{reportId}/reject", {
        params: { path },
        body: { reviewNote },
      }),
    );
    if (failure) flash.put(errorMessage(failure.error), "error");
    else flash.put("반려 처리했습니다.");
    return back(form, "/admin/review/reports");
  }

  const config = await getConfig(context);
  const key = readSittingKey(form, config.assessmentKinds);
  const { figures, invalid } = readFigures(form);
  if (!key || invalid.length) {
    flash.put("시험 정보와 숫자를 확인해주세요.", "error");
    return back(form, "/admin/review/reports");
  }
  const failure = failureOf(
    await client.POST("/admin/reports/{reportId}/approve", {
      params: { path },
      body: { ...key, ...figures, nickname: readNickname(form), reviewNote },
    }),
  );
  if (failure) flash.put(errorMessage(failure.error), "error");
  else flash.put("통계량으로 등록했습니다.");
  return back(form, "/admin/review/reports");
}

export function loader() {
  return redirect("/admin/review/reports");
}
