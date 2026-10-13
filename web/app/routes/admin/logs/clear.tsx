import { Form, Link, redirect } from "react-router";

import { apiContext, failureOf } from "~/api/client.server";
import s from "~/components/admin/admin.module.css";
import { cx } from "~/lib/cx";
import { errorMessage } from "~/lib/errors";
import { flashContext } from "~/lib/flash.server";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/clear";

export async function action({ context }: Route.ActionArgs) {
  const result = await context.get(apiContext).client.DELETE("/admin/logs", {
    params: { header: { "X-Confirm-Delete": "true" } },
  });
  const flash = context.get(flashContext);
  const failure = failureOf(result);
  if (failure) {
    flash.put(errorMessage(failure.error), "error");
    return redirect("/admin/logs/clear");
  }
  flash.put("로그를 비웠습니다.");
  return redirect("/admin/logs/entries");
}

// Confirmation page; the legacy view asked with confirm().
export default function ClearLogs() {
  return (
    <section
      className={cx(ui.panel, ui.sectionBlock)}
      aria-labelledby="clear-heading"
    >
      <div className={ui.sectionTitle}>
        <h2 id="clear-heading">로그 비우기</h2>
      </div>
      <p>로그를 모두 비울까요? 이 작업은 되돌릴 수 없습니다.</p>
      <p className={ui.muted}>
        이주 전이라면 로그인 기록이 이메일과 기여를 다시 잇는 유일한 단서일 수
        있습니다.
      </p>
      <Form method="post" className={s.actions}>
        <button className={cx(ui.button, ui.danger)} type="submit">
          모두 비우기
        </button>
        <Link className={cx(ui.button, ui.subtle)} to="/admin/logs/entries">
          취소
        </Link>
      </Form>
    </section>
  );
}
