import { Form, Link, redirect } from "react-router";

import { apiContext, failureOf, load } from "~/api/client.server";
import s from "~/components/admin/admin.module.css";
import { actionLabel } from "~/lib/activity";
import { cx } from "~/lib/cx";
import { errorMessage } from "~/lib/errors";
import { flashContext } from "~/lib/flash.server";
import { formatDateTime } from "~/lib/format";
import { filterQuery, isEmptyFilter, readLogFilter } from "~/lib/logFilter";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/delete";
import { pageUrl } from "~/lib/url.server";

// Confirmation page for a filtered delete: shows what the preview counted,
// then deletes with the preview's token.
export async function loader({ request, context }: Route.LoaderArgs) {
  const params = pageUrl(request).searchParams;
  const filter = readLogFilter(params);
  if (isEmptyFilter(filter)) throw redirect("/admin/logs/entries");
  const preview = await load(
    context
      .get(apiContext)
      .client.POST("/admin/logs/delete-preview", { body: filter }),
  );
  return { filter, preview, query: filterQuery(params) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const url = pageUrl(request);
  const filter = readLogFilter(url.searchParams);
  const token = String((await request.formData()).get("token") ?? "");
  const flash = context.get(flashContext);
  const result = await context
    .get(apiContext)
    .client.POST("/admin/logs/delete", { body: { ...filter, token } });
  const failure = failureOf(result);
  if (failure) {
    flash.put(errorMessage(failure.error), "error");
    // A changed count needs a fresh preview; stay on the confirmation page.
    return redirect(url.pathname + url.search);
  }
  flash.put(`로그 ${result.data?.deleted ?? 0}건을 삭제했습니다.`);
  return redirect(`/admin/logs/entries?${filterQuery(url.searchParams)}`);
}

export default function DeleteLogs({ loaderData }: Route.ComponentProps) {
  const { filter, preview, query } = loaderData;
  return (
    <section
      className={cx(ui.panel, ui.sectionBlock)}
      aria-labelledby="delete-heading"
    >
      <div className={ui.sectionTitle}>
        <h2 id="delete-heading">필터에 맞는 로그 삭제</h2>
      </div>
      <ul className={ui.muted}>
        {filter.from && <li>시작: {formatDateTime(filter.from)}</li>}
        {filter.until && <li>끝(미포함): {formatDateTime(filter.until)}</li>}
        {filter.action && (
          <li>활동: {filter.action.map(actionLabel).join(", ")}</li>
        )}
        {filter.userId && <li>사용자 ID: {filter.userId}</li>}
      </ul>
      <p>
        <strong>{preview.count}건</strong>을 삭제합니다. 되돌릴 수 없습니다. 이
        확인은 {formatDateTime(preview.expiresAt)}까지 유효합니다.
      </p>
      <Form method="post" className={s.actions}>
        <input type="hidden" name="token" value={preview.token} />
        <button
          className={cx(ui.button, ui.danger)}
          type="submit"
          disabled={preview.count === 0}
        >
          {preview.count}건 삭제
        </button>
        <Link
          className={cx(ui.button, ui.subtle)}
          to={`/admin/logs/entries?${query}`}
        >
          취소
        </Link>
      </Form>
    </section>
  );
}
