import { redirect } from "react-router";

import { apiContext } from "~/api/client.server";
import { bannerDismissedCookie } from "~/lib/cookies.server";
import { flashContext } from "~/lib/flash.server";
import { parseAdmissionYear } from "~/lib/profile";
import { safePath } from "~/lib/redirect.server";
import { seoulParts } from "~/lib/time.server";
import { requireMe } from "~/lib/viewer.server";
import type { Route } from "./+types/profile";

// Handles the profile banner and the profile form on /me.
export async function action({ request, context }: Route.ActionArgs) {
  const me = await requireMe(context);
  const form = await request.formData();
  const flash = context.get(flashContext);
  const to = safePath(form.get("redirectTo"), "/");

  if (form.get("intent") === "dismiss") {
    return redirect(to, {
      headers: {
        "Set-Cookie": await bannerDismissedCookie.serialize(me.email),
      },
    });
  }

  const college = String(form.get("college") ?? "").trim();
  const yearText = String(form.get("admissionYear") ?? "");
  const fromBanner = form.get("intent") === "banner";

  if (fromBanner && !college && !yearText.trim()) {
    flash.put("단과대학 또는 입학년도를 입력해주세요.", "error");
    return redirect(to);
  }
  const year = parseAdmissionYear(yearText, seoulParts(new Date()).year);
  if (!year.ok) {
    flash.put(year.message, "error");
    return redirect(to);
  }

  // The banner only fills in what was entered; the /me form sets both,
  // clearing a field left empty.
  const body = fromBanner
    ? {
        ...(college ? { college } : {}),
        ...(year.year !== null ? { admissionYear: year.year } : {}),
      }
    : { college: college || null, admissionYear: year.year };

  const { response } = await context
    .get(apiContext)
    .client.PATCH("/me", { body });
  if (!response.ok) {
    flash.put("프로필을 저장하지 못했습니다.", "error");
    return redirect(to);
  }
  flash.put(
    fromBanner ? "저장되었습니다. 감사합니다!" : "프로필을 저장했습니다.",
  );
  return redirect(to);
}

export function loader() {
  return redirect("/me");
}
