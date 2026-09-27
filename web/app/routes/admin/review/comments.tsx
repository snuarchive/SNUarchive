import { Form, Link, useLocation } from "react-router";

import { apiContext, failureOf, load } from "~/api/client.server";
import { MoreLink, pageEndpoint } from "~/components/admin/MoreLink";
import s from "~/components/admin/admin.module.css";
import { cursorOf } from "~/lib/admin.server";
import { cx } from "~/lib/cx";
import { errorMessage } from "~/lib/errors";
import { flashContext } from "~/lib/flash.server";
import { formatDate } from "~/lib/format";
import { back } from "~/lib/redirect.server";
import { usePagedList } from "~/lib/usePagedList";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/comments";

const PAGE_SIZE = 10;

export async function loader({ request, context }: Route.LoaderArgs) {
  const page = await load(
    context.get(apiContext).client.GET("/admin/comments", {
      params: { query: { limit: PAGE_SIZE, cursor: cursorOf(request) } },
    }),
  );
  return { page };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const commentId = Number(form.get("commentId"));
  const failure = failureOf(
    await context
      .get(apiContext)
      .client.DELETE("/admin/comments/{commentId}", {
        params: { path: { commentId } },
      }),
  );
  const flash = context.get(flashContext);
  if (failure) flash.put(errorMessage(failure.error), "error");
  else flash.put("후기를 삭제했습니다.");
  return back(form, "/admin/review/comments");
}

export default function Comments({ loaderData }: Route.ComponentProps) {
  const location = useLocation();
  const list = usePagedList(
    loaderData.page,
    pageEndpoint(location.pathname, location.search),
    (data: typeof loaderData) => data.page,
  );

  return (
    <section
      className={cx(ui.panel, ui.sectionBlock)}
      aria-labelledby="comments-heading"
    >
      <div className={ui.sectionTitle}>
        <h2 id="comments-heading">최근 한줄 후기</h2>
        <span>
          {list.items.length}건{list.cursor ? "+" : ""}
        </span>
      </div>
      <div className={s.list}>
        {list.items.length === 0 ? (
          <div className={ui.emptySmall}>후기가 없습니다.</div>
        ) : (
          list.items.map((comment) => (
            <article className={s.item} key={comment.id}>
              <header>
                <div>
                  <h3>{comment.body}</h3>
                  <p>
                    <Link to={`/courses/${comment.course.id}`}>
                      {comment.course.title}
                    </Link>{" "}
                    · {comment.author ?? "(탈퇴한 사용자)"} ·{" "}
                    {formatDate(comment.createdAt)}
                  </p>
                </div>
                <Form method="post" preventScrollReset>
                  <input
                    type="hidden"
                    name="redirectTo"
                    value={location.pathname + location.search}
                  />
                  <input type="hidden" name="commentId" value={comment.id} />
                  <button className={cx(ui.button, ui.danger)} type="submit">
                    삭제
                  </button>
                </Form>
              </header>
            </article>
          ))
        )}
      </div>
      <MoreLink {...list} />
    </section>
  );
}
