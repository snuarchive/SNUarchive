import { Form, Link, useLocation } from "react-router";

import { apiContext, failureOf, load } from "~/api/client.server";
import { MoreLink, pageEndpoint } from "~/components/admin/MoreLink";
import s from "~/components/admin/admin.module.css";
import { cursorOf } from "~/lib/admin.server";
import { cx } from "~/lib/cx";
import { errorMessage } from "~/lib/errors";
import { flashContext } from "~/lib/flash.server";
import { formatDate, formatDateTime, termLabel } from "~/lib/format";
import { back } from "~/lib/redirect.server";
import { fromSeoulInput } from "~/lib/seoulTime";
import { getConfig } from "~/lib/viewer.server";
import { usePagedList } from "~/lib/usePagedList";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/requests";

const PAGE_SIZE = 20;

export async function loader({ request, context }: Route.LoaderArgs) {
  const [page, config] = await Promise.all([
    load(
      context.get(apiContext).client.GET("/admin/voting-requests", {
        params: { query: { limit: PAGE_SIZE, cursor: cursorOf(request) } },
      }),
    ),
    getConfig(context),
  ]);
  return { page, semesters: config.semesters };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const client = context.get(apiContext).client;
  const flash = context.get(flashContext);
  const path = { sittingId: Number(form.get("sittingId")) };

  if (form.get("intent") === "open") {
    const failure = failureOf(
      await client.POST("/admin/sittings/{sittingId}/voting", {
        params: { path },
        body: { closesAt: fromSeoulInput(String(form.get("closesAt") ?? "")) },
      }),
    );
    if (failure) flash.put(errorMessage(failure.error), "error");
    else flash.put("투표를 열었습니다.");
  } else {
    const note = String(form.get("note") ?? "").trim() || null;
    const result = await client.POST(
      "/admin/voting-requests/{sittingId}/reject",
      {
        params: { path },
        body: { note },
      },
    );
    const failure = failureOf(result);
    if (failure) flash.put(errorMessage(failure.error), "error");
    else flash.put(`요청 ${result.data?.rejected ?? 0}건을 반려했습니다.`);
  }
  return back(form, "/admin/voting/requests");
}

export default function Requests({ loaderData }: Route.ComponentProps) {
  const { page, semesters } = loaderData;
  const location = useLocation();
  const here = location.pathname + location.search;
  const list = usePagedList(
    page,
    pageEndpoint(location.pathname, location.search),
    (data: typeof loaderData) => data.page,
  );

  return (
    <section
      className={cx(ui.panel, ui.sectionBlock)}
      aria-labelledby="requests-heading"
    >
      <div className={ui.sectionTitle}>
        <h2 id="requests-heading">투표 요청</h2>
        <span>
          {list.items.length}건{list.cursor ? "+" : ""}
        </span>
      </div>
      <div className={s.list}>
        {list.items.length === 0 ? (
          <div className={ui.emptySmall}>대기 중인 요청이 없습니다.</div>
        ) : (
          list.items.map((group) => (
            <article className={s.item} key={group.sitting.id}>
              <header>
                <div>
                  <h3>
                    <Link
                      to={`/courses/${group.course.id}?sitting=${group.sitting.id}`}
                    >
                      {group.course.title}
                    </Link>{" "}
                    · {group.sitting.label}
                  </h3>
                  <p>
                    {group.course.instructor} ·{" "}
                    {termLabel(group.sitting.term, semesters)} · 요청{" "}
                    {group.openCount}명
                  </p>
                  <p>
                    {formatDateTime(group.firstRequestedAt)} ~{" "}
                    {formatDateTime(group.lastRequestedAt)}
                  </p>
                </div>
              </header>
              {group.notes.length > 0 && (
                <ul className={ui.muted}>
                  {group.notes.map((note) => (
                    <li key={`${note.createdAt}${note.note}`}>
                      {note.note} ({formatDate(note.createdAt)})
                    </li>
                  ))}
                </ul>
              )}
              <div className={s.inline}>
                <Form method="post" className={s.inline} preventScrollReset>
                  <input type="hidden" name="redirectTo" value={here} />
                  <input
                    type="hidden"
                    name="sittingId"
                    value={group.sitting.id}
                  />
                  <label>
                    마감(서울 시간, 비우면 마감 없음)
                    <input name="closesAt" type="datetime-local" />
                  </label>
                  <button
                    className={cx(ui.button, ui.primary)}
                    type="submit"
                    name="intent"
                    value="open"
                  >
                    투표 열기
                  </button>
                </Form>
                <Form method="post" className={s.inline} preventScrollReset>
                  <input type="hidden" name="redirectTo" value={here} />
                  <input
                    type="hidden"
                    name="sittingId"
                    value={group.sitting.id}
                  />
                  <label>
                    반려 메모
                    <input name="note" maxLength={500} />
                  </label>
                  <button
                    className={cx(ui.button, ui.danger)}
                    type="submit"
                    name="intent"
                    value="reject"
                  >
                    반려
                  </button>
                </Form>
              </div>
            </article>
          ))
        )}
      </div>
      <MoreLink {...list} />
    </section>
  );
}
